import type { ReportId } from "@eyadex/contracts/finance-reports";
import type { PermissionScope } from "@eyadex/contracts/permissions";
import { sql, type Database, type Tx } from "@eyadex/db";

import { heartbeatMayRenew } from "../domain/export-failures.ts";
import type { ExportFence, LeasedExportJob } from "../ports/export-store.ts";
import { attemptOf, lockExport, type LockedExport } from "./export-sql.ts";

/**
 * نفس قراءة التأجير الحي جوّه معاملة المنادي. القفل ثم ساعة القاعدة في statement تانية.
 *
 * @param tx معاملة `withTenant`
 * @param fence سياج المحاولة
 * @returns الحقول الخمسة، أو `null` لو الصف مش التأجير الحي المملوك
 */
export async function readLockedLeasedExportJob(
  tx: Tx,
  fence: ExportFence,
): Promise<LeasedExportJob | null> {
  const row = await lockExport(tx, fence.clinicId, fence.exportId);
  if (row === undefined || !ownsLiveLease(row, fence)) return null;
  return leasedJob(row);
}

/**
 * يقرأ لقطة الطلب لتأجير جاري ومملوك وحي. القفل الأول، وساعة القاعدة بعد القفل جوّه
 * `lockExport`. مش تفويض: ما يقرأش عضوية ولا صفوف تقرير، وما يكتبش.
 *
 * @param db تجمع التطبيق
 * @param fence سياج المحاولة
 * @returns الحقول الخمسة المجمّدة، أو `null` لو الصف مش التأجير الحي المملوك
 */
export async function readLeasedExportJob(
  db: Database,
  fence: ExportFence,
): Promise<LeasedExportJob | null> {
  return db.withTenant(fence.clinicId, (tx) => readLockedLeasedExportJob(tx, fence));
}

/**
 * يقرأ سياجًا حيًا من غير قفل صف التصدير، عشان نبض المحاولة يقدر يجدد أثناء صفحات التقرير.
 * @param tx معاملة العيادة الحالية
 * @param fence سياج المحاولة
 * @returns الطلب المجمّد أو null؛ كل صفحة تعيد الفحص قبلها وبعدها
 */
export async function readCurrentLeasedExportJob(
  tx: Tx,
  fence: ExportFence,
): Promise<LeasedExportJob | null> {
  const rows =
    await tx.execute<LeasedExportJob>(sql`SELECT requested_by AS "requestedBy", report, format, scope, params
    FROM finance_report_exports WHERE clinic_id = ${fence.clinicId} AND id = ${fence.exportId}
      AND attempt = ${fence.attempt} AND lease_owner = ${fence.leaseOwner}
      AND status = 'running' AND lease_until > clock_timestamp()`);
  return rows[0] ?? null;
}

function ownsLiveLease(row: LockedExport, fence: ExportFence): boolean {
  return heartbeatMayRenew({
    status: row.status,
    leaseLive: row.lease_live === true,
    attemptMatches: attemptOf(row) === fence.attempt,
    ownerMatches: row.lease_owner === fence.leaseOwner,
  });
}

/** قيد 0068 يضمن report/format/scope. اللقطة ما تعيدش الكتالوج وما تفوّضش. */
function leasedJob(row: LockedExport): LeasedExportJob {
  return {
    requestedBy: row.requested_by,
    report: row.report as ReportId,
    format: row.format,
    scope: row.scope as PermissionScope,
    params: row.params,
  };
}
