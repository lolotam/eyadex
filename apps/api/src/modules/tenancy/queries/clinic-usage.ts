import { branchesUsage, usersUsage, type LimitUsage } from "../domain/limits.ts";
import type { ClinicReader } from "../ports/clinic-reader.ts";
import type { Clock } from "../ports/clock.ts";
import type { SeatUsageReader } from "../ports/seat-usage-reader.ts";

/** استهلاك العيادة مقابل حدودها، لعرض العدّادات بس — الكتابة بتقرر الحد جوه الـ transaction بتاعتها. */
export interface ClinicUsage {
  readonly users: LimitUsage;
  readonly branches: LimitUsage;
}

/**
 * يقرا استهلاك العيادة في سياقها (`withTenant`) بنفس قواعد `limits.ts` (ADR-0016): المستخدمين =
 * العضويات النشطة + الدعوات السارية، والفروع = النشطة بس.
 *
 * @param reader قارئ العيادة
 * @param seats قارئ المقاعد (port بينفّذه identity)
 * @param clock مصدر الوقت
 * @param clinicId عيادة السياق
 * @returns الاستهلاك، أو `null` لو العيادة مش ظاهرة في السياق ده
 */
export async function readClinicUsage(
  reader: ClinicReader,
  seats: SeatUsageReader,
  clock: Clock,
  clinicId: string,
): Promise<ClinicUsage | null> {
  const snapshot = await reader.readSnapshot(clinicId);
  if (snapshot === null) return null;
  const usage = await seats.readSeatUsage(clinicId, clock.now());
  return {
    users: usersUsage(usage.activeMemberships, usage.livePendingInvitations, snapshot.maxUsers),
    branches: branchesUsage(snapshot.activeBranches, snapshot.maxBranches),
  };
}
