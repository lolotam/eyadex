import { beforeEach, describe, expect, it } from "vitest";
import { as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, getState } from "./medical-test-kit";

// The API's `MedicineChanges.update`: a blank default is no default, and a save that changes no field
// answers the row as it stands, with no audit row.
beforeEach(() => resetMockData());

const admin = () => as("clinic_admin");
const SAVED = { name: "Testamine 5 mg", defaultDose: null, defaultFrequency: "daily" };

describe("updating a clinic medicine", () => {
  it.each([
    ["the same values", [], SAVED],
    ["a blank dose for no dose", [], { ...SAVED, defaultDose: "   " }],
    ["a new dose", ["medicine.updated"], { ...SAVED, defaultDose: "500 mg" }],
  ])("%s: audit %j", async (_case, actions, input) => {
    const created = await api.medical.createMedicine(admin(), SAVED, crypto.randomUUID());
    const before = getState().clinicAudit.length;
    const res = await api.medical.updateMedicine(admin(), created.id, input);
    const added = getState().clinicAudit.slice(0, getState().clinicAudit.length - before);
    expect(added.map((r) => r.action)).toEqual(actions);
    if (actions.length === 0) expect(res).toEqual(created);
  });
});
