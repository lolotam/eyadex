import type { MockState } from "./mock-store";

const SERVICES: [string, string, number][] = [
  ["استشارة", "Consultation", 20],
  ["جلسة ليزر", "Laser session", 45],
  ["متابعة", "Follow-up", 15],
];
const DAYS = [0, 1, 2, 3, 4];
const SHIFTS: [string, string][] = [
  ["09:00", "13:00"],
  ["17:00", "21:00"],
];

/**
 * Demo data for the appointments settings: three services, and every active doctor of the seed
 * bookable, Sunday–Thursday 09:00–13:00 and 17:00–21:00 in its first branch. Which members are seeded
 * as bookable is demo content, not an access rule.
 */
export function seedScheduling(
  state: MockState,
  clinicId: string,
  makeId: () => string,
  createdAt: string,
): void {
  for (const [nameAr, nameEn, durationMinutes] of SERVICES) {
    state.services.push({
      id: makeId(),
      clinicId,
      nameAr,
      nameEn,
      durationMinutes,
      status: "active",
      createdAt,
    });
  }
  const doctorRoles = state.roles
    .filter((r) => r.clinicId === clinicId && r.systemKey === "doctor")
    .map((r) => r.id);
  const doctors = state.members.filter(
    (m) => m.clinicId === clinicId && m.status === "active" && doctorRoles.includes(m.roleId),
  );
  for (const member of doctors) {
    state.bookingProfiles[member.id] = { acceptsAppointments: true, defaultDurationMinutes: 20 };
    const branchId = member.branchIds[0];
    if (branchId === undefined) continue;
    for (const weekday of DAYS) {
      for (const [startsAt, endsAt] of SHIFTS) {
        state.scheduleRows.push({
          id: makeId(),
          clinicId,
          membershipId: member.id,
          branchId,
          weekday,
          startsAt,
          endsAt,
        });
      }
    }
  }
}
