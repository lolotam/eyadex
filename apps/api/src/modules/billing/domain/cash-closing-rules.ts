import { MAX_CASH_MINOR, MAX_MINOR } from "@eyadex/contracts/money";

import { ApiError } from "../../../shared/errors.ts";

/** حالة درج الفرع: آخر رقم نقدي اتسلم وآخر رقم اتقفل وآخر إقفال للفرع. */
export interface DrawerState {
  readonly lastCashSeq: bigint;
  readonly lastClosedSeq: bigint;
  readonly lastClosingId: string | null;
}

/** فترة الإقفال: من بعد آخر رقم مقفل لحد آخر رقم نقدي (الحد الأول مفتوح والتاني مقفول). */
export interface ClosingPeriod {
  readonly previousClosingId: string | null;
  readonly fromCashSeq: bigint;
  readonly throughCashSeq: bigint;
}

/** حركة نقدية واحدة في الدرج: دفعة أو استرداد. */
export interface DrawerMovement {
  readonly kind: "payment" | "refund";
  readonly cashSeq: bigint;
  readonly amountMinor: bigint;
}

/**
 * فترة الإقفال من حالة الدرج (§4.4): من بعد آخر إقفال لحد آخر رقم نقدي، أو فترة فاضية لو الدرج لسه
 * ما اتعملش.
 *
 * @param drawer حالة الدرج، أو `null` لو مفيش صف لسه
 * @returns الفترة: آخر إقفال قبلها، ورقمها الأول وآخرها
 */
export function closingPeriod(drawer: DrawerState | null): ClosingPeriod {
  if (drawer === null) return { previousClosingId: null, fromCashSeq: 0n, throughCashSeq: 0n };
  return {
    previousClosingId: drawer.lastClosingId,
    fromCashSeq: drawer.lastClosedSeq,
    throughCashSeq: drawer.lastCashSeq,
  };
}

/**
 * المتوقع في الإقفال: النقد الداخل ناقص النقد الخارج من الحركات جوه الفترة بس (F2-Q10: من غير متابعة
 * عهدة الدرج). المبلغ ممكن يبقى سالب لما الاسترداد يزيد عن التحصيل.
 *
 * @param period فترة الإقفال
 * @param movements حركات الدرج
 * @returns النقد الداخل والخارج والمتوقع
 */
export function expectedCash(
  period: ClosingPeriod,
  movements: readonly DrawerMovement[],
): { cashInMinor: bigint; cashOutMinor: bigint; expectedMinor: bigint } {
  let cashInMinor = 0n;
  let cashOutMinor = 0n;
  for (const movement of movements) {
    if (movement.cashSeq <= period.fromCashSeq) continue;
    if (movement.cashSeq > period.throughCashSeq) continue;
    if (movement.kind === "payment") cashInMinor += movement.amountMinor;
    else cashOutMinor += movement.amountMinor;
  }
  return { cashInMinor, cashOutMinor, expectedMinor: cashInMinor - cashOutMinor };
}

/**
 * مبالغ الفترة لازم تفضل جوه حدود العقد قبل ما تتعرض أو تتكتب: الداخل والخارج جوه `bigint`، والمتوقع
 * جوه ±`MAX_CASH_MINOR` عشان الفرق مع المعدود يفضل جوه `bigint` (الحد نفسه اللي في قيد قاعدة البيانات).
 *
 * @param sums النقد الداخل والخارج والمتوقع للفترة
 * @returns مفيش قيمة؛ بترجع لو القاعدة ماشية
 * @throws ApiError `cash_drawer_out_of_range` لما مبلغ منهم برا الحد
 */
export function requireCashInRange(sums: {
  readonly cashInMinor: bigint;
  readonly cashOutMinor: bigint;
  readonly expectedMinor: bigint;
}): void {
  if (sums.cashInMinor > MAX_MINOR || sums.cashOutMinor > MAX_MINOR)
    throw new ApiError("cash_drawer_out_of_range");
  if (sums.expectedMinor > MAX_CASH_MINOR || sums.expectedMinor < -MAX_CASH_MINOR)
    throw new ApiError("cash_drawer_out_of_range");
}

/**
 * المعاينة اللي قدام الموظف لازم تبقى صالحة: لو الدرج اتغير من وقتها (حركة نقدية جديدة أو إقفال تاني)
 * مينفعش يتقفل على فلوس المعاينة القديمة (R3-3).
 *
 * @param period الفترة الحالية
 * @param sent آخر إقفال وآخر رقم نقدي اللي بعتها المعاينة
 * @returns مفيش قيمة؛ بترجع لو القاعدة ماشية
 * @throws ApiError `cash_drawer_changed` لما الدرج اتغير
 */
export function requirePreviewCurrent(
  period: ClosingPeriod,
  sent: { readonly previousClosingId: string | null; readonly throughCashSeq: bigint },
): void {
  if (sent.previousClosingId !== period.previousClosingId)
    throw new ApiError("cash_drawer_changed");
  if (sent.throughCashSeq !== period.throughCashSeq) throw new ApiError("cash_drawer_changed");
}

/**
 * الفرع بيقفل صندوقه مرة في اليوم (F2-Q9): لو فيه إقفال لنفس يوم العمل، التقفل التاني مرفوض.
 *
 * @param lastClosingBusinessDate يوم عمل آخر إقفال، أو `null` لو مفيش
 * @param businessDate يوم عمل الإقفال الجديد
 * @returns مفيش قيمة؛ بترجع لو القاعدة ماشية
 * @throws ApiError `cash_closing_exists` لما نفس اليوم متقفل قبل كده
 */
export function requireNotClosedToday(
  lastClosingBusinessDate: string | null,
  businessDate: string,
): void {
  if (lastClosingBusinessDate === businessDate) throw new ApiError("cash_closing_exists");
}

/**
 * لو فيه فرق بين المعدود والمتوقع لازم ملاحظة (F2-Q11): الإقفال مش بيتعدل بعد كده، فرق من غير سبب
 * مش مفهوم.
 *
 * @param countedMinor المبلغ اللي الموظف عدّه
 * @param expectedMinor المبلغ المتوقع
 * @param note الملاحظة، أو `null`
 * @returns مفيش قيمة؛ بترجع لو القاعدة ماشية
 * @throws ApiError `closing_note_required` لما فيه فرق من غير ملاحظة
 */
export function requireNoteForDifference(
  countedMinor: bigint,
  expectedMinor: bigint,
  note: string | null,
): void {
  if (countedMinor === expectedMinor) return;
  if (note === null || note.trim() === "") throw new ApiError("closing_note_required");
}
