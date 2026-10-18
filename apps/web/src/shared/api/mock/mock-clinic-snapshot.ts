import type { Clinic } from "@eyadex/contracts/clinics";

/** Allowlisted clinic fields for the platform log (names, settings, subscription). */
export function clinicDetails(c: Clinic) {
  return {
    nameAr: c.nameAr,
    nameEn: c.nameEn,
    specialty: c.specialty,
    defaultLanguage: c.defaultLanguage,
    timezone: c.timezone,
  };
}
export function clinicSubscription({ status, expiresAt, maxUsers, maxBranches }: Clinic) {
  return { status, expiresAt: expiresAt.slice(0, 10), maxUsers, maxBranches };
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}
