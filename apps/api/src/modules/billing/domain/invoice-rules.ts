import type { DiscountInput, InvoiceLineInput } from "@eyadex/contracts/finance";
import {
  computeInvoiceTotals,
  TotalsError,
  type Discount,
  type Totals,
} from "@eyadex/contracts/invoice-totals";

import { ApiError } from "../../../shared/errors.ts";
import type { MemberBranches } from "./billing-actor.ts";
import type { BillingActor } from "./billing-actor.ts";

/**
 * رقم الفاتورة المعروض (FIN-A4، spec §8 rule 8): البادئة والسنة والتسلسل بست خانات على الأقل.
 *
 * @param prefix بادئة الفرع
 * @param year سنة الإصدار بتوقيت العيادة
 * @param seq رقم التسلسل في الفرع والسنة
 * @returns مثلًا `SLM-2026-000123`
 */
export const formatInvoiceNumber = (prefix: string, year: number, seq: number): string =>
  `${prefix}-${year}-${String(seq).padStart(6, "0")}`;

const toTotalsDiscount = (discount: DiscountInput | null): Discount | null => {
  if (discount === null) return null;
  return discount.kind === "pct"
    ? { kind: "pct", bp: discount.bp }
    : { kind: "amount", minor: BigInt(discount.minor) };
};

/**
 * إجماليات الفاتورة بالدالة المشتركة (R1-1، R1-2). خصم أكبر من المبلغ = `discount_exceeds_total`، وأي
 * قاعدة تانية = `validation` بكود الدالة.
 *
 * @param lines السطور بترتيبها في الطلب
 * @param invoiceDiscount خصم الفاتورة كلها
 * @param taxRateBp نسبة الضريبة بتاعة العيادة
 * @returns مبالغ كل سطر والإجماليات
 */
export function invoiceTotals(
  lines: readonly InvoiceLineInput[],
  invoiceDiscount: DiscountInput | null,
  taxRateBp: number,
): Totals {
  try {
    return computeInvoiceTotals({
      lines: lines.map((line, position) => ({
        position,
        quantity: line.quantity,
        unitPriceMinor: BigInt(line.unitPriceMinor),
        discount: toTotalsDiscount(line.discount),
      })),
      invoiceDiscount: toTotalsDiscount(invoiceDiscount),
      taxRateBp,
    });
  } catch (error) {
    if (!(error instanceof TotalsError)) throw error;
    if (error.code === "discount_exceeds_total") throw new ApiError("discount_exceeds_total");
    throw new ApiError("validation", [{ path: ["lines"], code: error.code }]);
  }
}

/**
 * الفاعل يقدر يحط أو يغيّر خصم في الفرع ده (R1-14): `create:discounts:clinic` في أي فرع،
 * `create:discounts:branch` في فروعه بس.
 *
 * @param actor الفاعل
 * @param branchId فرع الفاتورة
 * @returns صح لو مسموح
 */
export function mayDiscount(actor: BillingActor, branchId: string): boolean {
  if (actor.permissions.includes("create:discounts:clinic")) return true;
  if (!actor.permissions.includes("create:discounts:branch")) return false;
  const member: MemberBranches = actor.member;
  return member.all || member.branchIds.includes(branchId);
}

/**
 * الطلب فيه أي خصم، على سطر أو على الفاتورة.
 *
 * @param lines السطور
 * @param invoiceDiscount خصم الفاتورة
 * @returns صح لو فيه خصم
 */
export const carriesDiscount = (
  lines: readonly InvoiceLineInput[],
  invoiceDiscount: DiscountInput | null,
): boolean => invoiceDiscount !== null || lines.some((line) => line.discount !== null);
