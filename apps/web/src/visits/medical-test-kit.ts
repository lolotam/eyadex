/** Shared helpers for the P2 medical mock tests (delay-free store, the doctor and its patients). */
import type { Persona } from "@eyadex/contracts/session";
import { api, as, getState } from "@/shared/api/mock/mock-test-kit";

export { api, as, getState };

export function doctorMember(index = 0) {
  const db = getState();
  const clinicId = db.clinics[0]!.id;
  const roleIds = new Set(
    db.roles.filter((r) => r.clinicId === clinicId && r.systemKey === "doctor").map((r) => r.id),
  );
  const doctors = db.members.filter(
    (m) => m.clinicId === clinicId && m.status === "active" && roleIds.has(m.roleId),
  );
  const member = doctors[index];
  if (!member) throw new Error("no doctor");
  return member;
}

export const doctorAt = (index: number): Persona => ({
  kind: "doctor",
  clinicId: getState().clinics[0]!.id,
  memberId: doctorMember(index).id,
});

/** One of the doctor's live appointments, set to `status` (demo data, not an access rule). */
export function ownAppointment(status: "booked" | "arrived" = "arrived", index = 0) {
  const member = doctorMember(index);
  const appt = getState().appointments.find(
    (a) => a.providerMembershipId === member.id && a.status !== "cancelled",
  );
  if (!appt) throw new Error("no appointment");
  appt.status = status;
  return appt;
}

/** A draft visit started by the doctor from an arrived appointment of theirs. */
export async function startDraft(index = 0) {
  const appt = ownAppointment("arrived", index);
  return api.medical.startVisit(doctorAt(index), { appointmentId: appt.id }, crypto.randomUUID());
}

export const file = (type: string, size: number, name = "scan.png") => {
  const f = new File([new Uint8Array(Math.min(size, 16))], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};
