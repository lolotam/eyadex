import { instantToWall } from "@eyadex/contracts/clinic-time";
import { PAYMENT_METHODS, type PaymentMethod } from "@eyadex/contracts/finance-payments";
import { SettlementError } from "@eyadex/contracts/settlement";

import { ApiError } from "../../../shared/errors.ts";

/**
 * رقم الإيصال المعروض (FIN-16، R1-9): البادئة والسنة والتسلسل، والتسلسل بست خانات على الأقل والأرقام
 * الأطول بتفضل زي ما هي (نفس قاعدة 0066 `finance_check_number`).
 *
 * @param prefix بادئة الفرع
 * @param year سنة الإيصال بتوقيت العيادة
 * @param seq رقم التسلسل في الفرع والسنة
 * @returns مثلًا `SLM-R-2026-000045`
 */
export const formatReceiptNumber = (prefix: string, year: number, seq: number): string =>
  `${prefix}-R-${year}-${String(seq).padStart(6, "0")}`;

/**
 * رقم الاسترداد المعروض (F2-Q13): سلسلة مستقلة عن الإيصالات، بنفس قاعدة الست خانات.
 *
 * @param prefix بادئة الفرع
 * @param year سنة الاسترداد بتوقيت العيادة
 * @param seq رقم التسلسل في الفرع والسنة
 * @returns مثلًا `SLM-RF-2026-000045`
 */
export const formatRefundNumber = (prefix: string, year: number, seq: number): string =>
  `${prefix}-RF-${year}-${String(seq).padStart(6, "0")}`;

/** صف واحد من إعدادات طرق الدفع: الطريقة وهل هي شغالة. */
export interface PaymentMethodRow {
  readonly method: PaymentMethod;
  readonly enabled: boolean;
}

/**
 * إعدادات طرق الدفع الأربع بالترتيب الثابت (FIN-11): طريقة من غير صف بتعتبر شغالة، عشان العيادات الموجودة
 * محتاجةش backfill، والصف هو اللي بيقرر طريقة واحدة.
 *
 * @param rows صفوف الإعدادات المحفوظة
 * @returns الطرق الأربعة بالترتيب الثابت وكل واحدة وهل هي شغالة
 */
export function paymentMethodSettings(
  rows: readonly PaymentMethodRow[],
): { method: PaymentMethod; enabled: boolean }[] {
  return PAYMENT_METHODS.map((method) => {
    const row = rows.find((saved) => saved.method === method);
    return { method, enabled: row?.enabled ?? true };
  });
}

/**
 * طريقة الدفع مقفولة في إعدادات العيادة (§4.6).
 *
 * @param rows صفوف الإعدادات المحفوظة
 * @param method طريقة الدفع المطلوبة
 * @returns مفيش قيمة؛ بترجع لو القاعدة ماشية
 * @throws ApiError `payment_method_disabled` لما الطريقة مقفولة
 */
export function requireMethodEnabled(
  rows: readonly PaymentMethodRow[],
  method: PaymentMethod,
): void {
  const setting = paymentMethodSettings(rows).find((saved) => saved.method === method);
  if (setting?.enabled !== true) throw new ApiError("payment_method_disabled");
}

/**
 * لازم طريقة دفع واحدة على الأقل تفضل شغالة (FIN-11).
 *
 * @param settings إعدادات الطرق بعد التجميع
 * @returns مفيش قيمة؛ بترجع لو القاعدة ماشية
 * @throws ApiError `payment_methods_empty` لما كل الطرق مقفولة
 */
export function requireSomeMethodEnabled(settings: readonly { readonly enabled: boolean }[]): void {
  if (!settings.some((setting) => setting.enabled)) throw new ApiError("payment_methods_empty");
}

/**
 * يوم عمل العيادة: اليوم بتوقيتها هي والسنة بتاعته (R1-8). الوقت بيتقرا بعد الأقفال (§4.4).
 *
 * @param at لحظة الحركة
 * @param timeZone توقيت العيادة
 * @returns يوم العمل `YYYY-MM-DD` وسنته
 */
export function clinicBusinessDay(
  at: Date,
  timeZone: string,
): { businessDate: string; year: number } {
  const businessDate = instantToWall(at.toISOString(), timeZone).date;
  return { businessDate, year: Number(businessDate.slice(0, 4)) };
}

/**
 * ينفّذ خطة التسوية وبيحوّل خطاها لخطأ الـ API: مبلغ مش صالح = `validation`، وباقي الأكواد بتتحول لنفس
 * الكود (§4.6)، وأي خطأ تاني بيترمي زي ما هو.
 *
 * @param plan الخطة اللي بترجع الحركات اللي تتكتب
 * @returns نتيجة الخطة
 * @throws ApiError بكود خطأ التسوية
 */
export function settle<T>(plan: () => T): T {
  try {
    return plan();
  } catch (error) {
    if (!(error instanceof SettlementError)) throw error;
    if (error.code === "invalid_amount") {
      throw new ApiError("validation", [{ path: ["amountMinor"], code: "validation.amount" }]);
    }
    throw new ApiError(error.code);
  }
}
