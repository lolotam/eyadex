import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, getState, memberWithKeys, ownAppointment } from "./medical-test-kit";

// Parity sweep: the API's access guard runs before the body pipe (NestJS guards, then pipes), and the
// Idempotency-Key is read after both, so a caller without the key never learns its body was malformed.
beforeEach(() => resetMockData());

const ID = crypto.randomUUID();
const bad = {} as never;
const CALLS: [string, (p: Persona) => Promise<unknown>][] = [
  ["listVisits", (p) => api.medical.listVisits(p, ID, { cursor: 7 } as never)],
  ["searchVisits", (p) => api.medical.searchVisits(p, ID, { q: "" })],
  ["walkInCandidates", (p) => api.medical.walkInCandidates(p, { branchId: "x", q: "" })],
  ["startVisit", (p) => api.medical.startVisit(p, bad, "")],
  ["saveNote", (p) => api.medical.saveNote(p, ID, bad)],
  ["saveDiagnoses", (p) => api.medical.saveDiagnoses(p, ID, bad)],
  ["savePrescription", (p) => api.medical.savePrescription(p, ID, bad)],
  ["cancelVisit", (p) => api.medical.cancelVisit(p, ID, bad)],
  ["addAddendum", (p) => api.medical.addAddendum(p, ID, bad)],
  ["saveMedicalProfile", (p) => api.medical.saveMedicalProfile(p, ID, bad)],
  ["searchIcd10", (p) => api.medical.searchIcd10(p, "")],
  ["listAttachments", (p) => api.medical.listAttachments(p, ID, { visitId: "x" })],
  ["createMedicine", (p) => api.medical.createMedicine(p, bad, "")],
  ["updateMedicine", (p) => api.medical.updateMedicine(p, ID, bad)],
];

describe("the guard answers before the body is read", () => {
  it.each(CALLS)("%s: no key is forbidden, not validation", async (_name, call) => {
    await expect(call(memberWithKeys([]))).rejects.toMatchObject({ code: "forbidden" });
  });

  it.each(CALLS)("%s: the module off is module_disabled, not validation", async (_name, call) => {
    getState().features[getState().clinics[0]!.id]!.medical = false;
    await expect(call(doctorAt(0))).rejects.toMatchObject({ code: "module_disabled" });
  });
});

describe("the Idempotency-Key, after the guard and the body", () => {
  it.each(["", "two words", "x".repeat(201)])("start with key %j is validation", async (key) => {
    const appt = ownAppointment("arrived");
    const before = getState().medical.visits.length;
    const start = api.medical.startVisit(doctorAt(0), { appointmentId: appt.id }, key);
    await expect(start).rejects.toMatchObject({ code: "validation" });
    expect(getState().medical.visits).toHaveLength(before);
  });

  it("a medicine with a blank key is validation, and none is created", async () => {
    const before = getState().medical.medicines.length;
    const input = { name: "Keyless", defaultDose: null, defaultFrequency: null };
    const created = api.medical.createMedicine(as("clinic_admin"), input, "");
    await expect(created).rejects.toMatchObject({ code: "validation" });
    expect(getState().medical.medicines).toHaveLength(before);
  });
});
