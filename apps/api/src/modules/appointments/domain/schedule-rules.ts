import {
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
  | { readonly kind: "overlap" }
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
 * المتلاصقة مش تداخل، حتى عبر نص الليل (D-14). صفوف فرع مقدّم الخدمة مابقاش بيشتغل فيه أو فرع متعطّل
 * نايمة: مش ظاهرة ومابتمنعش ساعات في فروعه الشغّالة.
 *
 * @param current كل صفوف مقدّم الخدمة في كل الفروع، مقروءة تحت قفله
 * @param branchId الفرع اللي بيتحفظ
 * @param wanted الأسبوع المطلوب في الفرع ده
 * @param isLiveBranch هل فرع تاني لسه بيعدّ (مقدّم الخدمة بيشتغل فيه والفرع نشط)
 * @returns القرار
 */
export function decideBranchSchedule(
  current: readonly ScheduleRow[],
  branchId: string,
  wanted: readonly WallShift[],
  isLiveBranch: (branchId: string) => boolean,
): ScheduleDecision {
  const mine = sorted(current.filter((r) => r.branchId === branchId)).map(shiftLabel);
  const next = sorted(wanted);
  if (mine.length === next.length && next.every((s, i) => shiftLabel(s) === mine[i])) {
    return { kind: "same" };
  }
  const others = current.filter((r) => r.branchId !== branchId && isLiveBranch(r.branchId));
  if (findShiftOverlap([...others, ...next]) !== null) return { kind: "overlap" };
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
