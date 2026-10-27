import { sql, type Database, type Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/db";
import { reportExportSchema } from "@eyadex/contracts/finance-reports";

import { ownExportPatientsReachable } from "./pg-export-patients.ts";
import { auditCategory, exportAuditDetails } from "../domain/export-audit.ts";
import { financeExportKey } from "../domain/export-key.ts";
import type { ExportFence, PublishAnswer, PublishRefusal } from "../ports/export-store.ts";
import { FenceMiss, lockExport, rereadAttempt, type LockedExport } from "./export-sql.ts";

class PublishRefuse extends Error {
  constructor(readonly reason: PublishRefusal) {
    super(reason);
  }
}

/**
 * يحجز مفتاح المحاولة قبل أي رفع. التأجير لازم يكون حيًا بعد القفل.
 *
 * @param db تجمع التطبيق
 * @param ids مولّد معرّف صف الـ blob
 * @param fence سياج المحاولة
 * @returns المفتاح أو ضياع التأجير
 */
export async function allocateExportBlob(db: Database, ids: IdGenerator, fence: ExportFence) {
  return db.withTenant(fence.clinicId, async (tx) => {
    const row = await lockExport(tx, fence.clinicId, fence.exportId);
    if (row === undefined || !ownsLive(row, fence)) return { kind: "lost_lease" as const };
    const storageKey = financeExportKey({
      clinicId: fence.clinicId,
      exportId: fence.exportId,
      attempt: fence.attempt,
      extension: row.format,
    });
    if (storageKey === null) return { kind: "lost_lease" as const };
    const blobId = ids.newId();
    await tx.execute(sql`INSERT INTO finance_report_export_blobs (clinic_id, id, export_id, attempt, storage_key,
            state, deleted_at, created_at, updated_at)
          VALUES (${fence.clinicId}, ${blobId}, ${fence.exportId}, ${fence.attempt}, ${storageKey}, 'allocated',
            NULL, clock_timestamp(), clock_timestamp())`);
    return { kind: "allocated" as const, blobId, storageKey };
  });
}

/**
 * ينقل blob المحاولة من `allocated` إلى `uploaded`. صفر صفوف رفض، من غير حذف.
 *
 * @param db تجمع التطبيق
 * @param fence سياج المحاولة
 * @returns الانتقال أو الرفض
 */
export async function markExportUploaded(db: Database, fence: ExportFence) {
  return db.withTenant(fence.clinicId, async (tx) => {
    await lockExport(tx, fence.clinicId, fence.exportId);
    const updated = (await tx.execute(sql`UPDATE finance_report_export_blobs
            SET state = 'uploaded', updated_at = clock_timestamp()
          WHERE clinic_id = ${fence.clinicId} AND export_id = ${fence.exportId}
            AND attempt = ${fence.attempt} AND state = 'allocated'
          RETURNING id`)) as unknown as { id: string }[];
    return updated.length === 1 ? { kind: "uploaded" as const } : { kind: "refused" as const };
  });
}

/**
 * ينشر المحاولة. قفل التصدير الأول، ثم الـ blob، ثم التدقيق. تحديث الصف هو الأخير بعد انتظارهما،
 * عشان `clock_timestamp()` يشوف التأجير بعد الانتظار مش قبله. أي عدد غير 1 يتراجع كله.
 *
 * @param db تجمع التطبيق
 * @param ids مولّد صف التدقيق
 * @param fence سياج المحاولة
 * @param input الحجم والعدد ومجموعة `own`
 * @returns النشر أو إعادة القراءة أو رفض قبل الكتابة
 */
export async function publishExport(
  db: Database,
  ids: IdGenerator,
  fence: ExportFence,
  input: {
    readonly byteSize: number;
    readonly rowCount: number;
    readonly patientIds: readonly string[] | null;
    readonly patientSet?: "ledger" | null;
  },
): Promise<PublishAnswer> {
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1)
    return { kind: "refused", reason: "invalid_size" };
  if (!Number.isSafeInteger(input.rowCount) || input.rowCount < 0)
    return { kind: "refused", reason: "invalid_size" };
  try {
    await db.withTenant(fence.clinicId, (tx) => publishLocked(tx, ids, fence, input));
    return { kind: "published" };
  } catch (error) {
    if (error instanceof PublishRefuse) return { kind: "refused", reason: error.reason };
    if (error instanceof FenceMiss) return { kind: await rereadAttempt(db, fence) };
    throw error;
  }
}

async function publishLocked(
  tx: Tx,
  ids: IdGenerator,
  fence: ExportFence,
  input: {
    readonly byteSize: number;
    readonly rowCount: number;
    readonly patientIds: readonly string[] | null;
    readonly patientSet?: "ledger" | null;
  },
): Promise<void> {
  const row = await lockExport(tx, fence.clinicId, fence.exportId);
  if (row === undefined) throw new FenceMiss();
  const actor = await actorUserId(tx, fence.clinicId, row.requested_by);
  const details = exportAuditDetails({
    report: row.report,
    rowCount: input.rowCount,
    params: parseParams(row.params),
  });
  if (details === null) throw new PublishRefuse("params_incomplete");
  const patients = ownPatients(row.scope, input.patientIds);
  if (patients === "missing") throw new PublishRefuse("missing_patient_set");
  if (row.scope === "own" && input.patientSet === "ledger") {
    const complete = await tx.execute(sql`SELECT id FROM finance_report_export_patients
      WHERE clinic_id = ${fence.clinicId} AND export_id = ${fence.exportId}
        AND attempt = ${fence.attempt} AND is_complete`);
    if (complete.length !== 1 || !(await ownExportPatientsReachable(tx, fence, row.requested_by)))
      throw new PublishRefuse("missing_patient_set");
  }
  const storageKey = financeExportKey({
    clinicId: fence.clinicId,
    exportId: fence.exportId,
    attempt: fence.attempt,
    extension: row.format,
  });
  if (storageKey === null) throw new PublishRefuse("params_incomplete");
  const blob = (await tx.execute(sql`UPDATE finance_report_export_blobs
          SET state = 'published', updated_at = clock_timestamp()
        WHERE clinic_id = ${fence.clinicId} AND export_id = ${fence.exportId}
          AND attempt = ${fence.attempt} AND state = 'uploaded' AND storage_key = ${storageKey}
        RETURNING id`)) as unknown as { id: string }[];
  if (blob.length !== 1) throw new FenceMiss();
  const audit =
    (await tx.execute(sql`INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category,
            entity_type, entity_id, branch_id, details, created_at)
          VALUES (${fence.clinicId}, ${ids.newId()}, ${actor}, 'finance_report.exported', ${auditCategory(row.report)},
            'finance_report_export', ${fence.exportId}, NULL, ${JSON.stringify(details)}::jsonb, clock_timestamp())
          RETURNING id`)) as unknown as { id: string }[];
  if (audit.length !== 1) throw new FenceMiss();
  const exported = (await tx.execute(sql`UPDATE finance_report_exports
          SET status = 'done', storage_key = ${storageKey}, byte_size = ${input.byteSize},
              row_count = ${input.rowCount}, patient_ids = ${patients === null ? sql`NULL` : uuidArray(patients)},
              patient_set_mode = ${row.scope === "own" && input.patientSet === "ledger" ? "ledger" : "array"},
              finished_at = clock_timestamp(), expires_at = clock_timestamp() + interval '24 hours',
              error_code = NULL, lease_owner = NULL, lease_until = NULL
        WHERE clinic_id = ${fence.clinicId} AND id = ${fence.exportId}
          AND attempt = ${fence.attempt} AND lease_owner = ${fence.leaseOwner}
          AND status = 'running' AND lease_until > clock_timestamp()
        RETURNING id`)) as unknown as { id: string }[];
  if (exported.length !== 1) throw new FenceMiss();
}

function ownsLive(row: LockedExport, fence: ExportFence): boolean {
  return (
    row.status === "running" &&
    row.lease_owner === fence.leaseOwner &&
    Number(row.attempt) === fence.attempt &&
    row.lease_live === true
  );
}

async function actorUserId(tx: Tx, clinicId: string, membershipId: string): Promise<string> {
  const found = (await tx.execute(sql`SELECT user_id FROM memberships
        WHERE clinic_id = ${clinicId} AND id = ${membershipId}`)) as unknown as {
    user_id: string;
  }[];
  const userId = found[0]?.user_id;
  if (userId === undefined) throw new PublishRefuse("actor_unresolved");
  return userId;
}

function ownPatients(
  scope: string,
  patientIds: readonly string[] | null,
): readonly string[] | null | "missing" {
  if (scope !== "own") return null;
  if (patientIds === null) return "missing";
  const ids: string[] = [];
  for (const patientId of patientIds) {
    const parsed = reportExportSchema.shape.id.safeParse(patientId);
    if (!parsed.success) throw new PublishRefuse("missing_patient_set");
    ids.push(parsed.data.toLowerCase());
  }
  return ids;
}

function uuidArray(ids: readonly string[]) {
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
}

function parseParams(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
