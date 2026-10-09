import {
  findShiftClash,
  findShiftOverlap,
  minutesToWall,
  wallMinutes,
  type Shift,
} from "@eyadex/contracts/schedules";
import { scrubAuditText } from "@eyadex/observability";

/** صف أسبوعي متخزّن، بوقت الساعة في العيادة `HH:MM`. */
export interface ScheduleRow {
  readonly id: string;
  readonly branchId: string;
  readonly weekday: number;
  readonly startsAt: string;
  readonly endsAt: string;
}

type WallShift = Pick<Shift, "weekday" | "startsAt" | "endsAt">;

/** نتيجة حفظ أسبوع فرع. */
export type ScheduleDecision =
  | { readonly kind: "same" }
  | { readonly kind: "overlap"; readonly branchId: string }
  | { readonly kind: "replace"; readonly shifts: readonly WallShift[] };

/**
 * وقت PostgreSQL كنص (`08:30:00`، `24:00:00`) بشكل العقد `HH:MM`.
 *
 * @param value النص من الداتابيز
 * @returns `HH:MM`
 */
export function wallFromDb(value: string): string {
  return minutesToWall(wallMinutes(value));
}

/**
 * الصف كنص قصير للسجل والمقارنة: `"<يوم> <بداية>-<نهاية>"`.
 *
 * @param shift الصف
 * @returns النص
 */
export function shiftLabel(shift: WallShift): string {
  return `${shift.weekday} ${shift.startsAt}-${shift.endsAt}`;
}

const sorted = (shifts: readonly WallShift[]) =>
  [...shifts].sort(
    (a, b) => a.weekday - b.weekday || wallMinutes(a.startsAt) - wallMinutes(b.startsAt),
  );

/**
 * يقرر حفظ أسبوع مقدّم خدمة في فرع (D-6، D-13): نفس الصفوف = مفيش تغيير؛ أي تداخل مع صفوفه في أي فرع
 * تاني أو بين الصفوف المطلوبة نفسها = رفض؛ غير كده الصفوف الجديدة بتحل محل صفوف الفرع ده. الصفوف
 * المتلاصقة مش تداخل، حتى عبر نص الليل (D-14). كل صف بيعدّ، حتى الصفوف النايمة (فرع متعطّل أو فرع
 * مقدّم الخدمة مابقاش بيشتغل فيه): لو رجعت شغّالة بعدين ماينفعش تتداخل مع حاجة (ADR-0026 §4).
 *
 * @param current كل صفوف مقدّم الخدمة في كل الفروع، مقروءة تحت قفله
 * @param branchId الفرع اللي بيتحفظ
 * @param wanted الأسبوع المطلوب في الفرع ده
 * @returns القرار؛ في التداخل `branchId` هو فرع الصف اللي اتعارض (الفرع نفسه لو التداخل بين المطلوب)
 */
export function decideBranchSchedule(
  current: readonly ScheduleRow[],
  branchId: string,
  wanted: readonly WallShift[],
): ScheduleDecision {
  const mine = sorted(current.filter((r) => r.branchId === branchId)).map(shiftLabel);
  const next = sorted(wanted);
  if (mine.length === next.length && next.every((s, i) => shiftLabel(s) === mine[i])) {
    return { kind: "same" };
  }
  if (findShiftOverlap(next) !== null) return { kind: "overlap", branchId };
  const clash = findShiftClash(
    current.filter((r) => r.branchId !== branchId),
    next,
  );
  if (clash !== null) return { kind: "overlap", branchId: clash.branchId };
  return { kind: "replace", shifts: next };
}

/**
 * لقطة سجل أسبوع فرع: اسم مقدّم الخدمة بعد التنضيف، الفرع، والصفوف كنص.
 *
 * @param providerName اسم العضو
 * @param branchId الفرع
 * @param shifts الصفوف
 * @returns اللقطة
 */
export function scheduleAuditSnapshot(
  providerName: string,
  branchId: string,
  shifts: readonly WallShift[],
) {
  return {
    providerName: scrubAuditText(providerName),
    branchId,
    shifts: sorted(shifts).map(shiftLabel),
  };
}
