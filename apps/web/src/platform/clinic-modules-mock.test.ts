import { beforeEach, describe, expect, it } from "vitest";
import { moduleSchema } from "@eyadex/contracts/clinics";
import {
  PLATFORM,
  api,
  as,
  clinicIdAt,
  getState,
  resetMockData,
} from "@/shared/api/mock/mock-test-kit";

beforeEach(() => resetMockData());

// D-9: appointments is a per-clinic module the platform switches, exactly like patients.
describe("the appointments module flag", () => {
  it("is the second module of the catalogue (P2 adds medical third, F1 finance fourth)", () => {
    expect(moduleSchema.options).toEqual(["patients", "appointments", "medical", "finance"]);
  });

  it("the platform switches it per clinic and the clinic session follows", async () => {
    const clinicId = clinicIdAt(0);
    await api.platform.setClinicFeature(PLATFORM, clinicId, "appointments", false);
    expect((await api.platform.getClinic(PLATFORM, clinicId)).features).toEqual({
      patients: true,
      appointments: false,
      // The demo clinic shows the released medical module (P2 brief §3).
      medical: true,
      finance: false,
    });
    expect((await api.session.getContext(as("clinic_admin"))).features.appointments).toBe(false);
    await api.platform.setClinicFeature(PLATFORM, clinicId, "appointments", true);
    expect((await api.session.getContext(as("clinic_admin"))).features.appointments).toBe(true);
  });

  it("NEGATIVE: refuses removing patients under medical or enabling medical without patients; writes nothing", async () => {
    const clinicId = clinicIdAt(0);
    const before = structuredClone(getState());
    await expect(
      api.platform.setClinicFeature(PLATFORM, clinicId, "patients", false),
    ).rejects.toMatchObject({ code: "validation" });
    expect(getState()).toEqual(before);
    await api.platform.setClinicFeature(PLATFORM, clinicId, "medical", false);
    await api.platform.setClinicFeature(PLATFORM, clinicId, "patients", false);
    const disabled = structuredClone(getState());
    await expect(
      api.platform.setClinicFeature(PLATFORM, clinicId, "medical", true),
    ).rejects.toMatchObject({ code: "validation" });
    expect(getState()).toEqual(disabled);
  });
});
