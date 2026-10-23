import { ApiError } from "../../../shared/errors.ts";

/**
 * المبلغ المدفوع اللي الموظف أكده على الشاشة لازم يبقى هو نفسه في الفاتورة وقت الإلغاء: لو اتسجلت
 * دفعة بعد آخر قراءة، الإلغاء هيرجّع فلوس المدفوع رصيداً للمراجع من غير ما الموظف شاف التحذير
 * (issue #113). القرار بيتبنّى جوه القفل، فما فيش سباق بين القراءة والإلغاء.
 *
 * @param paidMinor المبلغ المدفوع على الفاتورة دلوقتي (من الفاتورة المقروءة تحت القفل)
 * @param expectedPaidMinor المبلغ اللي الموظف أكده، أو `undefined` لو الطلب مابعتش حاجة
 * @returns مفيش قيمة؛ بترجع لو المبلغين زيّ بعض
 * @throws ApiError `invoice_paid_changed` لما المبلغ المدفوع اتغيّر بعد آخر قراءة
 */
export function requireExpectedPaid(paidMinor: string, expectedPaidMinor?: string): void {
  if (expectedPaidMinor === undefined) return;
  if (BigInt(expectedPaidMinor) === BigInt(paidMinor)) return;
  throw new ApiError("invoice_paid_changed");
}
