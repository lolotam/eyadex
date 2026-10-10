import {
  decideClinicAccess,
  type ClinicAccess,
  type ClinicStatus,
} from "../domain/clinic-access.ts";
import { moduleMap, type ClinicModule } from "../domain/feature-flags.ts";
import { branchesUsage, usersUsage, type LimitUsage } from "../domain/limits.ts";
import type { ClinicReader } from "../ports/clinic-reader.ts";
import type { Clock } from "../ports/clock.ts";
import type { SeatUsageReader } from "../ports/seat-usage-reader.ts";

/** حالة الدخول والحدود والـ flags لعيادة واحدة. */
export interface ClinicAccessState {
  readonly clinicId: string;
  readonly status: ClinicStatus;
  readonly expiresAt: Date;
  readonly access: ClinicAccess;
  readonly users: LimitUsage;
  readonly branches: LimitUsage;
  readonly modules: Readonly<Record<ClinicModule, boolean>>;
}

/**
 * يقرا حالة العيادة ويحسب الدخول والاستهلاك بالـ domain، على نفس اللحظة من الـ Clock.
 *
 * @param reader قارئ العيادة
 * @param seats قارئ المقاعد — port بينفّذه `identity`، اللي بيملك العضويات والدعوات
 * @param clock مصدر الوقت
 * @param clinicId uuid العيادة
 * @returns الحالة، أو `null` لو العيادة مش ظاهرة
 */
export async function getClinicAccessState(
  reader: ClinicReader,
  seats: SeatUsageReader,
  clock: Clock,
  clinicId: string,
): Promise<ClinicAccessState | null> {
  const snapshot = await reader.readSnapshot(clinicId);
  if (snapshot === null) return null;
  const now = clock.now();
  const usage = await seats.readSeatUsage(clinicId, now);
  return {
    clinicId: snapshot.id,
    status: snapshot.status,
    expiresAt: snapshot.expiresAt,
    access: decideClinicAccess(snapshot, now),
    users: usersUsage(usage.activeMemberships, usage.livePendingInvitations, snapshot.maxUsers),
    branches: branchesUsage(snapshot.activeBranches, snapshot.maxBranches),
    modules: moduleMap(snapshot.features),
  };
}
