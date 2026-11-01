import { sql, type Database, type Tx } from "@eyadex/db";

import { financeExportKey, type ExportKeyExtension } from "../domain/export-key.ts";
import { rereadVerdict } from "../domain/export-failures.ts";
import type { ExportFence } from "../ports/export-store.ts";

/** كتابة مسوّرة ما لقيتش صفها. المعاملة تتراجع، وإعادة القراءة تحصل بعدها. */
export class FenceMiss extends Error {
  constructor() {
    super("export fence missed");
  }
}

export interface LockedExport {
  status: string;
  attempt: number | string;
  lease_owner: string | null;
  format: ExportKeyExtension;
  scope: string;
  report: string;
  requested_by: string;
  params: unknown;
  error_code: string | null;
  lease_until: string | null;
  next_attempt_at: string | null;
  lease_live: boolean | null;
  waiting: boolean | null;
}

/**
 * يقفل صف التصدير ثم يقرأ الساعة في statement تانية. مقارنة `clock_timestamp()` جوه
 * `SELECT FOR UPDATE` ممكن تتنفّذ قبل ما `LockRows` يستنى، فانتظار قفل من غير تعديل
 * يعدّي تأجيرًا خلّص.
 *
 * @param tx معاملة `withTenant`
 * @param clinicId العيادة
 * @param exportId التصدير
 * @returns الصف بعد القفل، أو `undefined`
 */
export async function lockExport(
  tx: Tx,
  clinicId: string,
  exportId: string,
): Promise<LockedExport | undefined> {
  const locked =
    (await tx.execute(sql`SELECT status, attempt, lease_owner, format, scope, report, requested_by, params,
              error_code
         FROM finance_report_exports
        WHERE clinic_id = ${clinicId} AND id = ${exportId}
        FOR UPDATE`)) as unknown as Omit<
      LockedExport,
      "lease_until" | "next_attempt_at" | "lease_live" | "waiting"
    >[];
  const row = locked[0];
  if (row === undefined) return undefined;
  const clock =
    (await tx.execute(sql`SELECT lease_until::text AS lease_until, next_attempt_at::text AS next_attempt_at,
              (lease_until > clock_timestamp()) AS lease_live,
              (next_attempt_at > clock_timestamp()) AS waiting
         FROM finance_report_exports
        WHERE clinic_id = ${clinicId} AND id = ${exportId}`)) as unknown as Pick<
      LockedExport,
      "lease_until" | "next_attempt_at" | "lease_live" | "waiting"
    >[];
  return { ...row, ...clock[0]! };
}

export const asDate = (value: string): Date => new Date(value);

export const attemptOf = (row: LockedExport): number => Number(row.attempt);

/**
 * إعادة القراءة بعد صفر صفوف. نجاح هذه المحاولة بس يحتفظ بالملف، ومن غير حذف.
 *
 * @param db تجمع التطبيق
 * @param fence سياج المحاولة
 * @returns الحكم
 */
export async function rereadAttempt(
  db: Database,
  fence: ExportFence,
): Promise<"own_success" | "lost_lease"> {
  return db.withTenant(fence.clinicId, async (tx) => {
    const found =
      (await tx.execute(sql`SELECT e.status, e.storage_key, e.format, b.state AS blob_state,
              b.storage_key AS blob_key
           FROM finance_report_exports e
           LEFT JOIN finance_report_export_blobs b
             ON b.clinic_id = e.clinic_id AND b.export_id = e.id AND b.attempt = ${fence.attempt}
          WHERE e.clinic_id = ${fence.clinicId} AND e.id = ${fence.exportId}`)) as unknown as {
        status: string;
        storage_key: string | null;
        format: ExportKeyExtension;
        blob_state: string | null;
        blob_key: string | null;
      }[];
    const row = found[0];
    if (row === undefined) return "lost_lease";
    const ownKey = financeExportKey({
      clinicId: fence.clinicId,
      exportId: fence.exportId,
      attempt: fence.attempt,
      extension: row.format,
    });
    if (ownKey === null) return "lost_lease";
    return rereadVerdict({
      status: row.status,
      storageKey: row.storage_key,
      ownKey,
      blobState: row.blob_state,
      blobKey: row.blob_key,
    });
  });
}

/**
 * ينفّذ الكتابة بعد القفل. صفر صفوف يتراجع ثم يُعاد قراءته.
 *
 * @param db تجمع التطبيق
 * @param fence سياج المحاولة
 * @param write الكتابة المسوّرة، وساعتها `clock_timestamp()` بعد القفل
 * @returns التطبيق أو إعادة القراءة
 */
export async function fencedWrite(
  db: Database,
  fence: ExportFence,
  write: (tx: Tx) => Promise<unknown[]>,
): Promise<"applied" | "own_success" | "lost_lease"> {
  try {
    await db.withTenant(fence.clinicId, async (tx) => {
      await lockExport(tx, fence.clinicId, fence.exportId);
      const updated = await write(tx);
      if (updated.length !== 1) throw new FenceMiss();
    });
    return "applied";
  } catch (error) {
    if (error instanceof FenceMiss) return rereadAttempt(db, fence);
    throw error;
  }
}
