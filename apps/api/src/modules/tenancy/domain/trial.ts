/** فرق المنطقة الزمنية عن UTC بالدقايق في لحظة معيّنة (القاهرة بتتغيّر مع التوقيت الصيفي). */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return Math.round((local - at.getTime()) / 60_000);
}

/**
 * نهاية فترة التجربة لعيادة جديدة (ADR-0016): N يوم بعد "النهارده" بتاع العيادة في منطقتها، لحد
 * 23:59:59 بالتوقيت المحلي لليوم ده. الحساب على الـ Clock المحقون، مش ساعة الجهاز.
 *
 * @param days عدد أيام التجربة، عدد صحيح من 1 لـ 365
 * @param timeZone منطقة العيادة (IANA)
 * @param now الوقت الحالي من الـ Clock
 * @returns لحظة الانتهاء بـ UTC
 */
export function trialEndsAt(days: number, timeZone: string, now: Date): Date {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new RangeError("days must be an integer from 1 to 365");
  }
  const local = new Date(now.getTime() + zoneOffsetMinutes(now, timeZone) * 60_000);
  const target = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + days,
    23,
    59,
    59,
  );
  // The offset of the target day, not today's: a DST change in between moves it by an hour.
  const guess = new Date(target - zoneOffsetMinutes(new Date(target), timeZone) * 60_000);
  const settled = target - zoneOffsetMinutes(guess, timeZone) * 60_000;
  return new Date(settled);
}
