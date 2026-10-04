/** استهلاك مقاعد المستخدمين في العيادة: العضويات النشطة والدعوات الـ pending السارية. */
export interface SeatUsage {
  readonly activeMemberships: number;
  readonly livePendingInvitations: number;
}

/**
 * Port بيعرّفه `tenancy` (المستهلك) وبينفّذه `identity` (اللي بيملك `memberships` و`invitations`)
 * — القراءة بين الموديولات بتعدّي على port، مش على جداول موديول تاني (CLAUDE.architecture.md §2.2).
 */
export interface SeatUsageReader {
  /**
   * يعدّ مقاعد العيادة في سياقها.
   *
   * @param clinicId uuid العيادة
   * @param now الوقت الحالي من الـ Clock: الدعوة سارية طول ما `expires_at > now`
   * @returns العدّين، صفر لو العيادة مالهاش أي حاجة في السياق ده
   */
  readSeatUsage(clinicId: string, now: Date): Promise<SeatUsage>;
}

export const SEAT_USAGE_READER = Symbol("tenancy.SeatUsageReader");
