import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  call,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import { platformStaff } from "./platform-staff.ts";

// P2-14 (owner decision): the medical module stands on the patients module, on the per-clinic switch
// as well as in the contracts the create form and the platform default use.
let h: Harness;
let staff: Awaited<ReturnType<typeof platformStaff>>;
let clinicId: string;

beforeAll(async () => {
  h = await openHarness({}, true);
  staff = await platformStaff(h);
  clinicId = (await clinicWithMembers(h)).admin.clinicId;
});

afterAll(async () => {
  await closeHarness(h);
});

const setModule = (module: string, enabled: boolean) =>
  call(h, {
    method: "PUT",
    url: `/v1/platform/clinics/${clinicId}/features/${module}`,
    host: PLATFORM,
    cookie: staff.cookie,
    body: { enabled },
  });
const featureAudits = async () =>
  (
    await h.owner`SELECT count(*)::int AS n FROM platform_audit_log
                  WHERE clinic_id = ${clinicId} AND action = 'clinic.feature_changed'`
  )[0]!["n"];

describe("P2-14: medical needs patients on the platform switch", () => {
  it("NEGATIVE: refuses medical without patients and patients off under medical; writes nothing", async () => {
    expect((await setModule("patients", false)).statusCode).toBe(200);
    const audited = await featureAudits();

    const medicalAlone = await setModule("medical", true);
    expect(medicalAlone.statusCode).toBe(400);
    expect(medicalAlone.json().code).toBe("validation");

    expect((await setModule("patients", true)).statusCode).toBe(200);
    expect((await setModule("medical", true)).json().modules).toMatchObject({
      patients: true,
      medical: true,
    });
    const orphaned = await setModule("patients", false);
    expect(orphaned.statusCode).toBe(400);
    expect(orphaned.json().code).toBe("validation");

    expect(await featureAudits()).toBe(audited + 2);
    const flags = await h.owner`SELECT module, enabled FROM clinic_features
                               WHERE clinic_id = ${clinicId} AND module IN ('patients', 'medical')
                               ORDER BY module`;
    expect(flags).toEqual([
      { module: "medical", enabled: true },
      { module: "patients", enabled: true },
    ]);
  });

  it("switches medical off first, then patients", async () => {
    expect((await setModule("medical", false)).statusCode).toBe(200);
    expect((await setModule("patients", false)).json().modules).toMatchObject({
      patients: false,
      medical: false,
    });
  });
});
