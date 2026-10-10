import { beforeEach, describe, expect, it } from "vitest";
import { moduleSchema } from "@eyadex/contracts/clinics";
import { PLATFORM, api, as, clinicIdAt, resetMockData } from "@/shared/api/mock/mock-test-kit";

beforeEach(() => resetMockData());

// D-9: appointments is a per-clinic module the platform switches, exactly like patients.
describe("the appointments module flag", () => {
  it("is the second module of the catalogue (P2 adds medical third)", () => {
    expect(moduleSchema.options).toEqual(["patients", "appointments", "medical"]);
  });

  it("the platform switches it per clinic and the clinic session follows", async () => {
    const clinicId = clinicIdAt(0);
    await api.platform.setClinicFeature(PLATFORM, clinicId, "appointments", false);
    expect((await api.platform.getClinic(PLATFORM, clinicId)).features).toEqual({
      patients: true,
      appointments: false,
      medical: false,
    });
    expect((await api.session.getContext(as("clinic_admin"))).features.appointments).toBe(false);
    await api.platform.setClinicFeature(PLATFORM, clinicId, "appointments", true);
    expect((await api.session.getContext(as("clinic_admin"))).features.appointments).toBe(true);
  });
});
