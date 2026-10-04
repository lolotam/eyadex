/** مصدر الوقت المحقون: مفيش `Date.now()` في الـ domain ولا الـ queries (CLAUDE.architecture.md §2.3). */
export interface Clock {
  /**
   * الوقت الحالي.
   *
   * @returns لحظة دلوقتي كـ `Date` جديد
   */
  now(): Date;
}

/** Token الـ DI للـ Clock. */
export const CLOCK = Symbol("tenancy.Clock");
