import type { Invoice } from "@eyadex/contracts/finance";
import { writeClinicAudit } from "./mock-audit";
import type { FinanceAccess } from "./mock-finance-access";
import type { MockState } from "./mock-store";

type Discount = NonNullable<Invoice["invoiceDiscount"]>;
const MINOR = /^\d{1,19}$/;
const NUMBER = /^[A-Z0-9]{2,6}-\d{4}-\d{6,}$/;

const discountSnapshot = (scope: "invoice" | "line", d: Discount) =>
  d.kind === "pct" ? { scope, kind: "pct", bp: d.bp } : { scope, kind: "amount", minor: d.minor };

/**
 * لقطة الفاتورة في السجل، نفس حقول الـ API بالظبط (`shared/finance-audit.ts`).
 *
 * @param invoice الفاتورة
 * @returns اللقطة اللي تتخزن من غير scrub
 */
export function invoiceAuditSnapshot(invoice: Invoice): Record<string, unknown> {
  const discounts = [
    ...invoice.lines.flatMap((l) =>
      l.discount === null ? [] : [discountSnapshot("line", l.discount)],
    ),
    ...(invoice.invoiceDiscount === null
      ? []
      : [discountSnapshot("invoice", invoice.invoiceDiscount)]),
  ];
  const amounts = [
    invoice.subtotalMinor,
    invoice.discountMinor,
    invoice.taxMinor,
    invoice.totalMinor,
  ];
  // Like the API: the scrub is skipped only because every string is checked against its shape.
  if (!NUMBER.test(invoice.number) || !amounts.every((x) => MINOR.test(x))) {
    throw new Error("finance audit snapshot holds a value outside its shape");
  }
  return {
    number: invoice.number,
    status: invoice.status,
    version: invoice.version,
    subtotalMinor: invoice.subtotalMinor,
    discountMinor: invoice.discountMinor,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    lineCount: invoice.lines.length,
    discounts,
  };
}

/**
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
  writeClinicAudit(db, {
    clinicId: a.clinic.id,
    actorName: a.actorName,
    action,
    entity: "invoice",
    entityId: after.id,
    exact: true,
    before: before ? invoiceAuditSnapshot(before) : null,
    after: invoiceAuditSnapshot(after),
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
