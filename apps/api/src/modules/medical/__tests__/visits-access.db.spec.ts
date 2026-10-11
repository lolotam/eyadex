import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import {
  appointmentFor,
  medicalAudit,
  medicalClinic,
  patientIn,
  startedVisit,
  type MedicalClinic,
} from "./medical-fixtures.ts";

// Spec §2, P2-4, P2-5, P2-K4, R3-2 (ADR-0029): who sees a visit, and who sees its content. A visit outside
// the caller's reach is not_found, like another clinic's.
let h: Harness;
let C: MedicalClinic;
let other: MedicalClinic;
let shared: string;
let walkInR: string;
let notB: string;

type Detail = {
  visit: { id: string; providerName: string; preview: string | null };
  patient: { fullName: string; fileNumber: number };
  branch: { nameAr: string; nameEn: string };
  content: { note: Record<string, unknown>; addenda: unknown[] } | null;
  can: Record<string, boolean>;
};
const open = (cookie: string, id: string) => send(h, cookie, "GET", `/v1/visits/${id}`);

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await medicalClinic(h, invalidate);
  other = await medicalClinic(h, invalidate);
  // A patient both doctors treat: doctor A's walk-in visit, doctor B's live appointment.
  const both = await patientIn(h, C, C.branchD);
  shared = await startedVisit(h, C.doctor.cookie, { patientId: both, branchId: C.branchD });
  await appointmentFor(h, C, both, "15:00", { providerMembershipId: C.doctorB.memberId });
  // A patient only doctor A saw.
  const onlyA = await patientIn(h, C, C.branchD);
  notB = await startedVisit(h, C.doctor.cookie, { patientId: onlyA, branchId: C.branchD });
  // A walk-in in branch R by a member working there, so the front desk (branch R) has one in its branch.
  const role = await customRole(h, C.clinicId, ["create:visits:own"]);
  const inRDoctor = await memberOn(h, C.admin, role, {
    allBranches: false,
    branchIds: [C.branchR],
  });
  const inR = await patientIn(h, C, C.branchR);
  walkInR = await startedVisit(h, inRDoctor.cookie, { patientId: inR, branchId: C.branchR });
});

afterAll(() => closeHarness(h));

describe("the provider", () => {
  it("reads its visit with content, identity and buttons; the open is audited", async () => {
    const since = new Date();
    const res = await open(C.doctor.cookie, shared);
    expect(res.statusCode).toBe(200);
    const detail = res.json() as Detail;
    expect(detail.content).toMatchObject({ note: { complaint: null, plan: null }, addenda: [] });
    expect(detail.patient.fullName).toMatch(/^Booked Patient /);
    expect(detail.branch.nameEn).not.toBe("—");
    expect(detail.can).toEqual({
      edit: true,
      sign: false,
      cancel: true,
      addAddendum: false,
      attach: true,
    });
    const rows = await medicalAudit(h, C.clinicId, since);
    expect(rows.map((r) => [r["action"], r["category"], r["entity_id"]])).toEqual([
      ["visit.opened", "patient_access", shared],
    ]);
  });
});

describe("own (P2-4)", () => {
  it("doctor B reads doctor A's visit of a patient B treats: no visit buttons, attachments as upload", async () => {
    const res = await open(C.doctorB.cookie, shared);
    expect(res.statusCode).toBe(200);
    const detail = res.json() as Detail;
    expect(detail.content).not.toBeNull();
    // The attachment rule is update:medical reaching the patient, not the provider's (uploadTarget).
    expect(detail.can).toEqual({
      edit: false,
      sign: false,
      cancel: false,
      addAddendum: false,
      attach: true,
    });
  });

  it("doctor B gets not_found for a patient it never saw", async () => {
    expect((await open(C.doctorB.cookie, notB)).statusCode).toBe(404);
  });
});

describe("no content without view:medical (P2-5, P2-K4)", () => {
  it("the front desk reads a visit of its branch with content null and no audit row", async () => {
    const since = new Date();
    const res = await open(C.front.cookie, walkInR);
    expect(res.statusCode).toBe(200);
    const detail = res.json() as Detail;
    expect(detail.content).toBeNull();
    expect(detail.visit.preview).toBeNull();
    expect(detail.patient.fileNumber).toBeGreaterThan(0);
    expect(detail.can["attach"]).toBe(false);
    expect(await medicalAudit(h, C.clinicId, since)).toEqual([]);
  });

  it("the front desk gets not_found for a visit of another branch", async () => {
    expect((await open(C.front.cookie, shared)).statusCode).toBe(404);
  });

  it("a view:visits:clinic reader without medical keys sees metadata only", async () => {
    const detail = (await open(C.reader.cookie, notB)).json() as Detail;
    expect(detail.content).toBeNull();
    expect(detail.visit.providerName).not.toBe("—");
  });

  it("the admin (view:visits:clinic since the release, no medical key) sees metadata only", async () => {
    const res = await open(C.admin.cookie, shared);
    expect(res.statusCode).toBe(200);
    expect((res.json() as Detail).content).toBeNull();
  });

  it("NEGATIVE: a member without keys is forbidden", async () => {
    expect((await open(C.noKeys.cookie, shared)).statusCode).toBe(403);
  });
});

describe("can.attach follows the attachment rule", () => {
  it("an archived file takes no attachment, so its visit offers none", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const id = await startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
    expect(((await open(C.doctor.cookie, id)).json() as Detail).can["attach"]).toBe(true);
    await h.owner`UPDATE patients SET status = 'archived' WHERE id = ${patient}`;
    expect(((await open(C.doctor.cookie, id)).json() as Detail).can["attach"]).toBe(false);
  });
});

describe("isolation", () => {
  it("another clinic's doctor gets not_found for the visit and the patient's list", async () => {
    expect((await open(other.doctor.cookie, shared)).statusCode).toBe(404);
    const [row] = await h.owner`SELECT patient_id FROM visits WHERE id = ${shared}`;
    const list = await send(
      h,
      other.doctor.cookie,
      "GET",
      `/v1/patients/${row!["patient_id"]}/visits`,
    );
    expect(list.statusCode).toBe(404);
  });

  it("a malformed id is not_found", async () => {
    expect((await open(C.doctor.cookie, "not-a-uuid")).statusCode).toBe(404);
  });
});
