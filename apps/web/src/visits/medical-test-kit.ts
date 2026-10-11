/** Shared helpers for the P2 medical mock tests (delay-free store, the doctor and its patients). */
import { vi } from "vitest";
import type { VisitDetail } from "@eyadex/contracts/visits";
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

type SectionWrite = (persona: Persona, visitId: string, input: unknown) => Promise<VisitDetail>;

/**
 * Holds the first call of a section save before it reaches the store, until `release()`; records each
 * input, how many ran together, and whether the held call has finished.
 */
export function holdFirst(method: "saveNote" | "saveDiagnoses" | "savePrescription") {
  const medical = api.medical as unknown as Record<typeof method, SectionWrite>;
  const real = medical[method].bind(api.medical);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((done) => (release = done));
  const sent: unknown[] = [];
  let running = 0;
  let most = 0;
  let firstDone = false;
  vi.spyOn(medical, method).mockImplementation(async (persona, visitId, input) => {
    const first = sent.length === 0;
    sent.push(input);
    running += 1;
    most = Math.max(most, running);
    try {
      if (first) await gate;
      return await real(persona, visitId, input);
    } finally {
      running -= 1;
      if (first) firstDone = true;
    }
  });
  return {
    sent,
    release,
    most: () => most,
    running: () => running,
    firstDone: () => firstDone,
  };
}
