import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { addPatient } from "../../appointments/__tests__/appointment-fixtures.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { addBranch } from "../../patients/__tests__/patient-fixtures.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import {
  DOCTOR_KEYS,
  medicalAudit,
  medicalClinic,
  patientIn,
  setModule,
  startedVisit,
  type MedicalClinic,
} from "./medical-fixtures.ts";

// Spec §2 and §5, R3-1, Task 11 (ADR-0029): every route answers module_disabled while the module is off;
// the walk-in picker's branches and candidates; the patient's visit list.
let h: Harness;
let C: MedicalClinic;
let invalidate: AuthorizationInvalidator;

const ID = randomUUID();
const ROUTES: [method: "GET" | "POST" | "PUT", url: string, body?: unknown][] = [
  ["GET", `/v1/patients/${ID}/visits`],
  ["POST", `/v1/patients/${ID}/visits/search`, { q: "x" }],
  ["GET", "/v1/visits/walk-in-branches"],
  ["POST", "/v1/visits/walk-in-candidates", { branchId: ID, q: "xx" }],
  ["POST", "/v1/visits", { patientId: ID, branchId: ID }],
  ["GET", `/v1/visits/${ID}`],
  [
    "PUT",
    `/v1/visits/${ID}/note`,
    { complaint: null, examination: null, assessment: null, plan: null },
  ],
  ["POST", `/v1/visits/${ID}/sign`, {}],
  ["POST", `/v1/visits/${ID}/cancel`, { reason: "other", note: null }],
  ["POST", `/v1/visits/${ID}/addenda`, { body: "x" }],
  ["GET", `/v1/patients/${ID}/medical-profile`],
  [
    "PUT",
    `/v1/patients/${ID}/medical-profile`,
    {
      allergies: null,
      chronicConditions: null,
      currentMedications: null,
      surgicalHistory: null,
      familyHistory: null,
    },
  ],
  ["PUT", `/v1/visits/${ID}/diagnoses`, { items: [] }],
  ["PUT", `/v1/visits/${ID}/prescription`, { items: [] }],
  ["GET", `/v1/visits/${ID}/prescription/print`],
  ["POST", "/v1/icd10/search", { q: "F41" }],
  ["GET", "/v1/medicines"],
  ["POST", "/v1/medicines", { name: "x", defaultDose: null, defaultFrequency: null }],
  ["PUT", `/v1/medicines/${ID}`, { name: "x", defaultDose: null, defaultFrequency: null }],
  ["POST", `/v1/medicines/${ID}/deactivate`, {}],
  ["POST", `/v1/medicines/${ID}/reactivate`, {}],
  ["POST", `/v1/patients/${ID}/attachments`, {}],
  ["GET", `/v1/patients/${ID}/attachments`],
  ["GET", `/v1/attachments/${ID}`],
  ["POST", `/v1/attachments/${ID}/archive`, {}],
];

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await medicalClinic(h, invalidate);
});

afterAll(() => closeHarness(h));

describe("module flag (spec §2)", () => {
  it.each(ROUTES)("%s %s is module_disabled while medical is off", async (method, url, body) => {
    await setModule(h, invalidate, C.clinicId, "medical", false);
    try {
      const res = await send(h, C.doctor.cookie, method, url, body, randomUUID());
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "module_disabled", details: { module: "medical" } });
    } finally {
      await setModule(h, invalidate, C.clinicId, "medical", true);
    }
  });
});

describe("walk-in picker (R3-1)", () => {
  it("lists the active branches the caller works in", async () => {
    const res = await send(h, C.doctor.cookie, "GET", "/v1/visits/walk-in-branches");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: { id: string }[] }).items.map((b) => b.id)).toEqual([C.branchD]);
  });

  it("finds active files of the branch by name or file number, name and number only, audited", async () => {
    // "zz" is not hex, so the tag can never appear inside an id in the audit row by chance.
    const tag = `zz${randomUUID().slice(0, 4)}`;
    const ids: string[] = [];
    for (let i = 0; i < 22; i += 1) {
      const id = await addPatient(h, C.clinicId, C.branchD);
      await h.owner`UPDATE patients SET full_name = ${`Walk ${tag} ${i}`} WHERE id = ${id}`;
      ids.push(id);
    }
    const archived = await addPatient(h, C.clinicId, C.branchD, "archived");
    await h.owner`UPDATE patients SET full_name = ${`Walk ${tag} archived`} WHERE id = ${archived}`;
    const since = new Date();
    const res = await send(h, C.doctor.cookie, "POST", "/v1/visits/walk-in-candidates", {
      branchId: C.branchD,
      q: `Walk ${tag}`,
    });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(20);
    expect(
      items.every((i) => Object.keys(i).sort().join() === "fileNumber,fullName,patientId"),
    ).toBe(true);
    expect(items.some((i) => i["patientId"] === archived)).toBe(false);
    const rows = await medicalAudit(h, C.clinicId, since);
    expect(rows.map((r) => [r["action"], r["category"], r["branch_id"]])).toEqual([
      ["visit.walk_in_searched", "patient_access", C.branchD],
    ]);
    expect(rows[0]!["raw"]).not.toContain(tag);
    const [file] = await h.owner`SELECT file_number FROM patients WHERE id = ${ids[0]!}`;
    const byNumber = await send(h, C.doctor.cookie, "POST", "/v1/visits/walk-in-candidates", {
      branchId: C.branchD,
      q: String(file!["file_number"]).padStart(6, "0"),
    });
    expect(
      (byNumber.json() as { items: { patientId: string }[] }).items.map((i) => i.patientId),
    ).toContain(ids[0]);
  });

  it("the clinic audit log reads a medical row with no entity (the walk-in search)", async () => {
    const res = await send(h, C.admin.cookie, "GET", "/v1/clinic/audit?category=patient_access");
    expect(res.statusCode).toBe(200);
    const actions = (res.json() as { items: { action: string }[] }).items.map((i) => i.action);
    expect(actions).toContain("visit.walk_in_searched");
  });

  it("a branch outside the caller's is forbidden", async () => {
    const res = await send(h, C.doctor.cookie, "POST", "/v1/visits/walk-in-candidates", {
      branchId: C.branchR,
      q: "Booked",
    });
    expect(code(res)).toBe("forbidden");
  });

  it("a member of every branch: a closed branch is branch_inactive, an unknown one not_found, unaudited (Codex 4241493936)", async () => {
    const everyBranch = await memberOn(h, C.admin, await customRole(h, C.clinicId, DOCTOR_KEYS));
    const closed = await addBranch(h, C.clinicId, false);
    const filed = await addPatient(h, C.clinicId, closed);
    await h.owner`UPDATE patients SET full_name = ${"Closed branch file"} WHERE id = ${filed}`;
    const since = new Date();
    const search = (branchId: string) =>
      send(h, everyBranch.cookie, "POST", "/v1/visits/walk-in-candidates", {
        branchId,
        q: "Closed branch",
      });
    expect(code(await search(closed))).toBe("branch_inactive");
    expect((await search(randomUUID())).statusCode).toBe(404);
    expect(await medicalAudit(h, C.clinicId, since)).toEqual([]);
    const open = await search(C.branchD);
    expect(open.statusCode).toBe(200);
  });
});

describe("the patient's visits (Task 11)", () => {
  it("newest first, paged by cursor; previews only for content readers, no preview no audit", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const started: string[] = [];
    for (let i = 0; i < 22; i += 1) {
      const id = await startedVisit(h, C.doctor.cookie, {
        patientId: patient,
        branchId: C.branchD,
      });
      await h.owner`UPDATE visits SET status = 'cancelled', cancel_reason = 'other' WHERE id = ${id}`;
      started.push(id);
    }
    const since = new Date();
    const first = await send(h, C.doctor.cookie, "GET", `/v1/patients/${patient}/visits`);
    expect(first.statusCode).toBe(200);
    const page = first.json() as {
      items: { id: string; preview: string | null }[];
      nextCursor: string | null;
      can: { search: boolean; start: boolean };
    };
    expect(page.items).toHaveLength(20);
    expect(page.items[0]!.id).toBe(started.at(-1));
    expect(page.can).toEqual({ search: true, start: true });
    const next = await send(
      h,
      C.doctor.cookie,
      "GET",
      `/v1/patients/${patient}/visits?cursor=${page.nextCursor!}`,
    );
    const rest = (next.json() as { items: { id: string }[]; nextCursor: null }).items;
    expect(rest.map((v) => v.id)).toEqual([started[1], started[0]]);
    expect(await medicalAudit(h, C.clinicId, since)).toEqual([]);
  });

  it("the front desk sees its branch's visits only, with search off", async () => {
    const patient = await patientIn(h, C, C.branchR);
    const res = await send(h, C.front.cookie, "GET", `/v1/patients/${patient}/visits`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [], can: { search: false, start: false } });
  });

  it("an own-only doctor gets not_found for a patient it never saw; a bad cursor is validation", async () => {
    const stranger = await patientIn(h, C, C.branchD);
    const res = await send(h, C.doctorB.cookie, "GET", `/v1/patients/${stranger}/visits`);
    expect(res.statusCode).toBe(404);
    await startedVisit(h, C.doctor.cookie, { patientId: stranger, branchId: C.branchD });
    const bad = await send(h, C.doctor.cookie, "GET", `/v1/patients/${stranger}/visits?cursor=x`);
    expect(code(bad)).toBe("validation");
  });
});
