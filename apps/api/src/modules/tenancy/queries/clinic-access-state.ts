import { decideClinicAccess, type ClinicAccess, type ClinicStatus } from "../domain/clinic-access.ts";
import { isModuleEnabled } from "../domain/feature-flags.ts";
import { branchesUsage, usersUsage, type LimitUsage } from "../domain/limits.ts";
import type { ClinicReader } from "../ports/clinic-reader.ts";
import type { Clock } from "../ports/clock.ts";

/** حالة الدخول والحدود والـ flags لعيادة واحدة. */
export interface ClinicAccessState {
  readonly clinicId: string;
  readonly status: ClinicStatus;
  readonly expiresAt: Date;
  readonly access: ClinicAccess;
  readonly users: LimitUsage;
  readonly branches: LimitUsage;
  readonly modules: { readonly patients: boolean };
}

/**
 * يقرا حالة العيادة ويحسب الدخول والاستهلاك بالـ domain، على نفس اللحظة من الـ Clock.
 *
 * @param reader قارئ العيادة
 * @param clock مصدر الوقت
 * @param clinicId uuid العيادة
 * @returns الحالة، أو `null` لو العيادة مش ظاهرة
 */
export async function getClinicAccessState(
  reader: ClinicReader,
  clock: Clock,
  clinicId: string,
): Promise<ClinicAccessState | null> {
  const snapshot = await reader.readSnapshot(clinicId);
  if (snapshot === null) return null;
  const now = clock.now();
  return {
    clinicId: snapshot.id,
    status: snapshot.status,
    expiresAt: snapshot.expiresAt,
    access: decideClinicAccess(snapshot, now),
    users: usersUsage(snapshot.activeMemberships, snapshot.pendingInvitations, snapshot.maxUsers, now),
    branches: branchesUsage(snapshot.activeBranches, snapshot.maxBranches),
    modules: { patients: isModuleEnabled(snapshot.features, "patients") },
  };
}
