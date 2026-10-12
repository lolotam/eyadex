import { beforeEach, describe, expect, it } from "vitest";
import { scrubAuditText } from "@eyadex/observability/audit-text";
import { api, as, getState, PLATFORM, resetMockData } from "./mock-test-kit";

// Obviously fake values: a 12-digit run shaped like a civil ID and a phone no Kuwaiti line can have.
const CIVIL_ID = "123456789012";
const PHONE = "+965 0000 0123";
const typed = (label: string) => `${label} ${CIVIL_ID} ${PHONE}`;

/** The row may hold only what the API's shared scrub makes of the typed text, never the raw digits. */
function expectScrubbed(row: unknown, field: unknown, typedName: string) {
  expect(field).toBe(scrubAuditText(typedName));
  const text = JSON.stringify(row);
  expect(text).not.toContain(CIVIL_ID);
  expect(text).not.toContain("0000 0123");
}

function clinicRow(action: string) {
  const row = getState().clinicAudit.find((e) => e.action === action);
  if (!row?.after) throw new Error(`no ${action} row`);
  return { row, after: row.after };
}

describe("mock audit rows are scrubbed like the API's", () => {
  beforeEach(() => resetMockData());

  it("masks a civil ID and a phone typed into a service name", async () => {
    const name = typed("Laser");
    await api.scheduling.createService(
      as("clinic_admin"),
      { nameAr: name, nameEn: name, durationMinutes: 30 },
      crypto.randomUUID(),
    );
    const { row, after } = clinicRow("service.created");
    expectScrubbed(row, after["nameEn"], name);
    expectScrubbed(row, after["nameAr"], name);
  });

  it("masks a civil ID and a phone typed into a role name", async () => {
    const name = typed("Editor");
    await api.roles.create(
      as("clinic_admin"),
      { nameAr: name, nameEn: name, permissionKeys: ["view:users:clinic", "view:roles:clinic"] },
      crypto.randomUUID(),
    );
    const { row, after } = clinicRow("role.created");
    expectScrubbed(row, after["nameEn"], name);
  });

  it("masks a civil ID and a phone typed into a patient name", async () => {
    const branch = getState().branches.find((b) => b.clinicId === as("clinic_admin").clinicId);
    if (!branch) throw new Error("no branch");
    const name = typed("Visitor");
    await api.patients.create(
      as("clinic_admin"),
      {
        fullName: name,
        phone: "55501234",
        birthDate: "1990-04-01",
        gender: "male",
        registrationBranchId: branch.id,
        civilId: "",
        email: "",
        messageLanguage: "",
        notificationsOptOut: false,
      },
      crypto.randomUUID(),
    );
    const { row, after } = clinicRow("patient.created");
    expectScrubbed(row, after["fullName"], name);
  });

  it("masks them in a platform row, its summary included", async () => {
    const clinic = getState().clinics[0];
    if (!clinic) throw new Error("no clinic");
    const name = typed("Clinic");
    await api.platform.updateClinicDetails(PLATFORM, clinic.id, {
      nameAr: name,
      nameEn: name,
      specialty: clinic.specialty,
      defaultLanguage: clinic.defaultLanguage,
      timezone: clinic.timezone,
    });
    const row = getState().platformAudit.find((e) => e.action === "clinic.details_updated");
    if (!row?.after) throw new Error("no clinic.details_updated row");
    expectScrubbed(row, row.after["nameEn"], name);
    expect(row.summary).toBe(scrubAuditText(`Updated details of ${name}`));
  });
});
