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

/** A doctor (the second by default), moved to a custom role holding exactly `keys`. */
export function memberWithKeys(keys: string[], index = 1): Persona {
  const member = doctorMember(index);
  const base = getState().roles.find((r) => r.id === member.roleId)!;
  const role = { ...base, id: crypto.randomUUID(), systemKey: null, permissions: keys };
  getState().roles.push(role);
  member.roleId = role.id;
  return { kind: "custom", clinicId: member.clinicId, memberId: member.id };
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

// The leading bytes the upload sniffs (the API's `attachment-rules.ts`); any other type gets none.
const SIGNATURES: Readonly<Record<string, number[]>> = {
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": [...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBP")],
  "application/pdf": ascii("%PDF-1.7"),
};

/** A file declared as `type` whose bytes start as a `content` file does (the declared type by default). */
export const file = (type: string, size: number, name = "scan.png", content = type) => {
  const bytes = new Uint8Array(16);
  bytes.set(SIGNATURES[content] ?? []);
  const f = new File([bytes], name, { type });
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
