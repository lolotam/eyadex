import type { PlatformClinicDetail } from "@eyadex/contracts/platform-clinics";
import type { Specialty } from "@eyadex/contracts/clinics";

import { decideClinicAccess } from "../domain/clinic-access.ts";
import { isModuleEnabled } from "../domain/feature-flags.ts";
import { branchesUsage, usersUsage } from "../domain/limits.ts";
import type { ClinicReader } from "../ports/clinic-reader.ts";
import type { Clock } from "../ports/clock.ts";
import type { SeatUsageReader } from "../ports/seat-usage-reader.ts";

/**
 * تفاصيل عيادة للمنصة (story 18): الحالة المخزّنة + الدخول المحسوب على الـ Clock + الموديولات +
 * الاستهلاك مقابل الحدود. مفيش أي بيانات مراجعين ولا عدّهم (PRD §4.5، PLAT-02).
 *
 * @param reader قارئ العيادة على pool المنصة
 * @param seats قارئ المقاعد على pool المنصة
 * @param clock مصدر الوقت
 * @param clinicId uuid العيادة
 * @returns التفاصيل، أو `null` لو العيادة مش موجودة
 */
export async function getPlatformClinicDetail(
  reader: ClinicReader,
  seats: SeatUsageReader,
  clock: Clock,
  clinicId: string,
): Promise<PlatformClinicDetail | null> {
  const snapshot = await reader.readSnapshot(clinicId);
  if (snapshot === null) return null;
  const now = clock.now();
  const usage = await seats.readSeatUsage(clinicId, now);
  return {
    id: snapshot.id,
    slug: snapshot.slug,
    nameAr: snapshot.nameAr,
    nameEn: snapshot.nameEn,
    specialty: snapshot.specialty as Specialty,
    status: snapshot.status,
    access: decideClinicAccess(snapshot, now),
    expiresAt: snapshot.expiresAt.toISOString(),
    defaultLanguage: snapshot.defaultLanguage,
    timezone: snapshot.timezone,
    createdAt: snapshot.createdAt.toISOString(),
    modules: { patients: isModuleEnabled(snapshot.features, "patients") },
    usage: {
      users: usersUsage(usage.activeMemberships, usage.livePendingInvitations, snapshot.maxUsers),
      branches: branchesUsage(snapshot.activeBranches, snapshot.maxBranches),
    },
  };
}
