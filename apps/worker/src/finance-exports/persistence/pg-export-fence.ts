import { sql, type Database, type Tx } from "@eyadex/db";

import {
  abandonBackoffMinutes,
  failureOutcome,
  isExportFailureKind,
  type ExportFailureKind,
} from "../domain/export-failures.ts";
import type { ExportFence, FenceAnswer } from "../ports/export-store.ts";
import { fencedWrite } from "./export-sql.ts";

const answer = (kind: "applied" | "own_success" | "lost_lease"): FenceAnswer => ({ kind });

/**
 * يمدّد التأجير الحي فقط. `clock_timestamp()` بعد `FOR UPDATE`، فالمنتهي ما يحييش.
 *
 * @param db تجمع التطبيق
 * @param fence سياج المحاولة
 * @returns التمديد أو إعادة القراءة
 */
export async function heartbeatExport(db: Database, fence: ExportFence): Promise<FenceAnswer> {
  return answer(
    await fencedWrite(
      db,
      fence,
      (tx) =>
        tx.execute(sql`UPDATE finance_report_exports
            SET lease_until = clock_timestamp() + interval '60 seconds'
          WHERE clinic_id = ${fence.clinicId} AND id = ${fence.exportId}
            AND attempt = ${fence.attempt} AND lease_owner = ${fence.leaseOwner}
            AND status = 'running' AND lease_until > clock_timestamp()
          RETURNING id`) as Promise<{ id: string }[]>,
    ),
  );
}

/**
 * يكتب الفشل على تأجير جاري وحي لنفس المالك فقط. الخامس نهائي، والباقي يرجع `queued`.
 *
 * @param db تجمع التطبيق
 * @param fence سياج المحاولة
 * @param kind نوع الفشل
 * @returns الكتابة أو إعادة القراءة
 */
export async function failExport(
  db: Database,
  fence: ExportFence,
  kind: ExportFailureKind,
): Promise<FenceAnswer> {
  if (!isExportFailureKind(kind)) throw new TypeError("unknown export failure");
  const outcome = failureOutcome(fence.attempt, kind);
  return answer(
    await fencedWrite(db, fence, (tx) =>
      failureUpdate(tx, fence, outcome.final, outcome.backoffMinutes, kind),
    ),
  );
}

/**
 * يفك التأجير من غير تغيير الحالة. مالك جديد يحدّث صفر صفوف.
 *
 * @param db تجمع التطبيق
 * @param fence سياج المحاولة
 * @returns الفك أو إعادة القراءة
 */
export async function releaseExport(db: Database, fence: ExportFence): Promise<FenceAnswer> {
  return answer(
    await fencedWrite(
      db,
      fence,
      (tx) =>
        tx.execute(sql`UPDATE finance_report_exports
            SET lease_owner = NULL, lease_until = NULL
          WHERE clinic_id = ${fence.clinicId} AND id = ${fence.exportId}
            AND attempt = ${fence.attempt} AND lease_owner = ${fence.leaseOwner}
          RETURNING id`) as Promise<{ id: string }[]>,
    ),
  );
}

/**
 * يترك المحاولة `queued`. الترك الخامس من غير `next_attempt_at`، فالالتقاط الجاي نهائي.
 *
 * @param db تجمع التطبيق
 * @param fence سياج المحاولة
 * @returns الترك أو إعادة القراءة
 */
export async function abandonExport(db: Database, fence: ExportFence): Promise<FenceAnswer> {
  const minutes = abandonBackoffMinutes(fence.attempt);
  return answer(await fencedWrite(db, fence, (tx) => queuedRelease(tx, fence, minutes, null)));
}

function failureUpdate(
  tx: Tx,
  fence: ExportFence,
  final: boolean,
  minutes: number | null,
  kind: ExportFailureKind,
): Promise<{ id: string }[]> {
  if (final) {
    return tx.execute(sql`UPDATE finance_report_exports
          SET status = 'failed', error_code = ${kind}, next_attempt_at = NULL, lease_owner = NULL, lease_until = NULL
        WHERE clinic_id = ${fence.clinicId} AND id = ${fence.exportId}
          AND attempt = ${fence.attempt} AND lease_owner = ${fence.leaseOwner}
          AND status = 'running' AND lease_until > clock_timestamp()
        RETURNING id`) as Promise<{ id: string }[]>;
  }
  return queuedRelease(tx, fence, minutes, kind);
}

function queuedRelease(
  tx: Tx,
  fence: ExportFence,
  minutes: number | null,
  kind: ExportFailureKind | null,
): Promise<{ id: string }[]> {
  const next =
    minutes === null ? sql`NULL` : sql`clock_timestamp() + (${minutes} * interval '1 minute')`;
  const assignment =
    kind === null
      ? sql`status = 'queued', next_attempt_at = ${next}, lease_owner = NULL, lease_until = NULL`
      : sql`status = 'queued', error_code = ${kind}, next_attempt_at = ${next}, lease_owner = NULL, lease_until = NULL`;
  const liveFailure =
    kind === null ? sql`` : sql`AND status = 'running' AND lease_until > clock_timestamp()`;
  return tx.execute(sql`UPDATE finance_report_exports
        SET ${assignment}
      WHERE clinic_id = ${fence.clinicId} AND id = ${fence.exportId}
        AND attempt = ${fence.attempt} AND lease_owner = ${fence.leaseOwner}
        ${liveFailure}
      RETURNING id`) as Promise<{ id: string }[]>;
}
