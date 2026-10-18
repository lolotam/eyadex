import type { Invoice } from "@eyadex/contracts/finance";
import {
  assertInvoiceAuditSnapshotShape,
  invoiceAuditSnapshot,
} from "@eyadex/contracts/finance-audit-snapshot";
import { writeClinicAudit } from "./mock-audit";
import type { FinanceAccess } from "./mock-finance-access";
import type { MockState } from "./mock-store";

/**
 * اللقطة من حزمة العقود عشان الـ mock والـ API ما يختلفوش.
 * صف سجل لإصدار أو تعديل أو إلغاء فاتورة (patient_access زي الـ API).
 *
 * @param db الحالة
 * @param a الفاعل
 * @param action اسم الحدث
 * @param before الفاتورة قبل، أو `null`
 * @param after الفاتورة بعد
 * @returns لا شيء
 */
export function auditInvoice(
  db: MockState,
  a: FinanceAccess,
  action: "invoice.issued" | "invoice.edited" | "invoice.voided",
  before: Invoice | null,
  after: Invoice,
): void {
  const beforeSnapshot = before ? invoiceAuditSnapshot(before) : null;
  const afterSnapshot = invoiceAuditSnapshot(after);
  assertInvoiceAuditSnapshotShape(beforeSnapshot);
  assertInvoiceAuditSnapshotShape(afterSnapshot);
  writeClinicAudit(db, {
    clinicId: a.clinic.id,
    actorName: a.actorName,
    action,
    entity: "invoice",
    entityId: after.id,
    exact: true,
    before: beforeSnapshot ? { ...beforeSnapshot } : null,
    after: { ...afterSnapshot },
  });
}

/**
 * صف إداري من غير لقطة (الـ API بيسجل أسماء الحقول بس، والقارئ مابيعرضهاش).
 *
 * @param db الحالة
 * @param a الفاعل
 * @param action اسم الحدث
 * @param entity الكيان
 * @param entityId معرّفه
 * @param sides قبل/بعد لما الـ API بيسجلهم (بادئة الفرع)
 * @returns لا شيء
 */
export function auditFinanceSetting(
  db: MockState,
  a: FinanceAccess,
  action: string,
  entity: "clinic" | "clinic_service" | "branch",
  entityId: string,
  sides: { before: Record<string, unknown> | null; after: Record<string, unknown> | null } = {
    before: null,
    after: null,
  },
): void {
  writeClinicAudit(db, {
    clinicId: a.clinic.id,
    actorName: a.actorName,
    action,
    entity,
    entityId,
    ...sides,
  });
}
