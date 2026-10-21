import {
  paymentRefundable,
  planPaymentRefund,
  SettlementError,
  type PatientMoney,
  type Release,
} from "@eyadex/contracts/settlement";

/** الدفعة اللي الاسترداد بيرجّع منها: معرّفها وفاتورتها ومبلغها. */
export interface RefundedPayment {
  readonly id: string;
  readonly invoiceId: string;
  readonly amountMinor: bigint;
}

/**
 * اللي لسه ممكن يرجع من دفعة (issue #91): الحي من تخصيصاتها، ومش أكتر من مبلغها ناقص اللي اتحرر منها
 * قبل كده. التخصيص الواحد بيتعمل بكامل المبلغ (F2-Q1)، فالاتنين متساويين طول ما الفلوس سليمة؛ الحد
 * التاني بيضمن إن الاسترداد عمره ما يوعد بأكتر من اللي اتدفع حتى لو الحركات اتلخبطت.
 *
 * @param money حركات المراجع، مقرية بعد قفله
 * @param payment الدفعة
 * @returns المبلغ اللي ممكن يرجع، صفر أو أكتر
 */
export function refundableFromPayment(money: PatientMoney, payment: RefundedPayment): bigint {
  const ownAllocations = new Set(
    money.allocations
      .filter((allocation) => allocation.paymentId === payment.id)
      .map((allocation) => allocation.id),
  );
  const released = money.credits
    .filter((credit) => ownAllocations.has(credit.originAllocationId))
    .reduce((sum, credit) => sum + credit.amountMinor, 0n);
  const live = paymentRefundable(money, payment.id);
  const withinAmount = payment.amountMinor - released;
  const refundable = live < withinAmount ? live : withinAmount;
  return refundable > 0n ? refundable : 0n;
}

/**
 * خطة الاسترداد من دفعة (FIN-14، F2-Q4، issue #91): المبلغ لازم يبقى جوه اللي ممكن يرجع من الدفعة دي،
 * وبعدين تخصيصاتها على الفاتورة بتحرر المبلغ الأحدث الأول، والفاتورة بترجع عليها الفلوس دي تاني.
 *
 * @param money حركات المراجع، مقرية بعد قفله وقفل الفاتورة
 * @param payment الدفعة اللي الاسترداد منها
 * @param amountMinor مبلغ الاسترداد
 * @returns الحركات اللي هتتحرر لرصيد بسبب `refund`
 * @throws SettlementError `invalid_amount` لمبلغ مش موجب، و`refund_exceeds_available` لمبلغ أكبر من المتاح
 */
export function planRefundFromPayment(
  money: PatientMoney,
  payment: RefundedPayment,
  amountMinor: bigint,
): Release[] {
  if (amountMinor <= 0n) throw new SettlementError("invalid_amount");
  if (amountMinor > refundableFromPayment(money, payment)) {
    throw new SettlementError("refund_exceeds_available");
  }
  return planPaymentRefund(money, payment.invoiceId, payment.id, amountMinor);
}
