import { parseFrozenReportExportParams } from "@eyadex/contracts/finance-reports-export";
import type { PermissionScope } from "@eyadex/contracts/permissions";
import type { Database } from "@eyadex/db";

import { decideExportAccess } from "../domain/export-access.ts";
import type { ExportFence, PrepareExportAnswer } from "../ports/export-store.ts";
import { readExportAccess } from "./pg-export-access.ts";
import { readLockedLeasedExportJob } from "./pg-export-job.ts";

/**
 * يجهّز تأجيرًا حيًا قبل قراءة صفوف التقرير. القفل الأول، ثم اللقطة، ثم ساعة القاعدة تاني
 * بعد انتظار العضوية. مفيش تجديد ولا كتابة. مش تفويض مرضى `own`.
 *
 * @param db تجمع التطبيق
 * @param fence سياج المحاولة فقط
 * @returns جاهز أو ضياع التأجير أو رفض أو params فاسدة
 */
export async function prepareLeasedExportJob(
  db: Database,
  fence: ExportFence,
): Promise<PrepareExportAnswer> {
  return db.withTenant(fence.clinicId, async (tx) => {
    const leased = await readLockedLeasedExportJob(tx, fence);
    if (leased === null) return { kind: "lost_lease" };
    const params = parseFrozenReportExportParams(leased.report, leased.format, leased.params);
    if (params === null) return { kind: "invalid_params" };
    const snapshot = await readExportAccess(tx, fence.clinicId, leased.requestedBy);
    const still = await readLockedLeasedExportJob(tx, fence);
    if (still === null) return { kind: "lost_lease" };
    const storedScope = asScope(still.scope);
    if (storedScope === null) return { kind: "forbidden" };
    const decision = decideExportAccess({
      report: still.report,
      storedScope,
      branchIds: params.branchIds,
      snapshot,
    });
    if (decision.kind === "forbidden") return { kind: "forbidden" };
    return {
      kind: "ready",
      job: {
        requestedBy: still.requestedBy,
        report: still.report,
        format: still.format,
        scope: storedScope,
        params,
        userId: decision.userId,
      },
    };
  });
}

function asScope(value: string): PermissionScope | null {
  return value === "clinic" || value === "branch" || value === "own" ? value : null;
}
