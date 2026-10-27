import type { ReportId } from "@eyadex/contracts/finance-reports";
import type { PermissionScope } from "@eyadex/contracts/permissions";
import type { Database } from "@eyadex/db";

import { heartbeatMayRenew } from "../domain/export-failures.ts";
import type { ExportFence, LeasedExportJob } from "../ports/export-store.ts";
import { attemptOf, lockExport, type LockedExport } from "./export-sql.ts";

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
  return db.withTenant(fence.clinicId, async (tx) => {
    const row = await lockExport(tx, fence.clinicId, fence.exportId);
    if (row === undefined) return null;
    if (!ownsLiveLease(row, fence)) return null;
    return leasedJob(row);
  });
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
