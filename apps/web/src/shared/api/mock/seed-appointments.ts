import { wallToInstant } from "@eyadex/contracts/clinic-time";
import { todayInTimeZone } from "@eyadex/contracts/patients";
import type { AppointmentStatus } from "@eyadex/contracts/appointments";
import type { MockState } from "./mock-store";

// Demo bookings for the first clinic's day view (slice A2): on the next two working days (Sunday to
// Thursday, the seeded hours), inside each bookable member's hours in its first branch. Demo content,
// not an access rule.
const SLOTS: [string, string, AppointmentStatus][] = [
  ["09:00", "09:20", "arrived"],
  ["09:30", "09:50", "booked"],
  ["10:15", "11:00", "booked"],
  ["17:30", "17:50", "booked"],
];
const WORKING = [0, 1, 2, 3, 4];

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function workingDays(timezone: string, count: number): string[] {
  const out: string[] = [];
  for (let d = 0; out.length < count && d < 7; d += 1) {
    const date = addDays(todayInTimeZone(timezone), d);
    if (WORKING.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) out.push(date);
  }
  return out;
}

export function seedAppointments(
  state: MockState,
  clinicId: string,
  makeId: () => string,
  createdAt: string,
): void {
  const clinic = state.clinics.find((c) => c.id === clinicId);
  if (!clinic) return;
  const patients = state.patients.filter((p) => p.clinicId === clinicId && p.status === "active");
  const providers = state.members.filter(
    (m) => m.clinicId === clinicId && state.bookingProfiles[m.id]?.acceptsAppointments,
  );
  let next = 0;
  const today = todayInTimeZone(clinic.timezone);
  for (const date of workingDays(clinic.timezone, 2)) {
    for (const provider of providers) {
      const branchId = provider.branchIds[0];
      if (branchId === undefined) continue;
      for (const [from, to, status] of SLOTS) {
        const patient = patients[next % patients.length];
        next += 1;
        if (!patient) continue;
        state.appointments.push({
          id: makeId(),
          clinicId,
          branchId,
          patientId: patient.id,
          providerMembershipId: provider.id,
          serviceId: null,
          startsAt: wallToInstant(date, from, clinic.timezone),
          endsAt: wallToInstant(date, to, clinic.timezone),
          status: date === today ? status : "booked",
          overbooked: false,
          cancelReason: null,
          cancelNote: null,
          createdAt,
        });
      }
    }
  }
}
