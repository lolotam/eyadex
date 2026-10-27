import type { Database, Tx } from "@eyadex/db";

import { ExportReadRefused } from "../domain/export-read-refused.ts";
import type { ExportFence, PreparedExportJob } from "../ports/export-store.ts";
import { prepareExportInTransaction } from "./pg-export-prepare.ts";

/**
 * يشتق الطلب من السياج ويعيد التفويض قبل قراءة SQL وبعدها في نفس `withTenant`.
 * READ COMMITTED يشوف سحب الصلاحية الملتزم أثناء القراءة في الفحص الأخير؛ الصفوف
 * لا تخرج للبناء لو اترفض. الـ callback لقراءة SQL فقط، من غير ملفات أو شبكة تخزين.
 *
 * @param db تجمع التطبيق
 * @param fence سياج المحاولة، من غير لقطة تفويض سابقة
 * @param read قراءة التقرير ومجموعة `own` داخل المعاملة
 * @returns البيانات بعد آخر فحص للتفويض والتأجير الحي
 */
export async function readAuthorizedExport<T>(
  db: Database,
  fence: ExportFence,
  read: (tx: Tx, job: PreparedExportJob) => Promise<T>,
): Promise<T> {
  return db.withTenant(fence.clinicId, async (tx) => {
    const before = await prepareExportInTransaction(tx, fence);
    if (before.kind !== "ready") throw new ExportReadRefused(before.kind);
    const data = await read(tx, before.job);
    const after = await prepareExportInTransaction(tx, fence);
    if (after.kind !== "ready") throw new ExportReadRefused(after.kind);
    return data;
  });
}
