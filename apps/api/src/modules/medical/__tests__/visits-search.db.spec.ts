import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import {
  medicalAudit,
  medicalClinic,
  patientIn,
  startedVisit,
  type MedicalClinic,
} from "./medical-fixtures.ts";

// P2-F4, R2-1, R3-6 (a) (ADR-0029): the note search reads one patient's newest 500 visits, decrypted in
// memory, with Arabic and Latin folding; the query travels in the body and never reaches a log line or an
// audit row. The list's previews are an audited read too.
let h: Harness;
let C: MedicalClinic;
let patient: string;
const ids: Record<"anxious" | "headache" | "addendum", string> = {
  anxious: "",
  headache: "",
  addendum: "",
};

const ASSESSMENT = "القَلَق الشديد مع أرق";
const COMPLAINT = "Headache since Monday";
const ADDENDUM = "إضافة: نوبات قلق ليلية";
const QUERY = "قلق";

const note = (fields: Record<string, string>) => ({
  complaint: null,
  examination: null,
  assessment: null,
  plan: null,
  ...fields,
});
const search = (cookie: string, body: unknown, id = patient) =>
  send(h, cookie, "POST", `/v1/patients/${id}/visits/search`, body);
const itemIds = (res: { json: () => unknown }) =>
  (res.json() as { items: { id: string }[] }).items.map((v) => v.id);

async function visitWith(fields: Record<string, string>): Promise<string> {
  const id = await startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
  const res = await send(h, C.doctor.cookie, "PUT", `/v1/visits/${id}/note`, note(fields));
  if (res.statusCode !== 200) throw new Error(`note ${res.statusCode} ${res.body}`);
  return id;
}

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await medicalClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  patient = await patientIn(h, C, C.branchD);
  ids.anxious = await visitWith({ assessment: ASSESSMENT });
  ids.headache = await visitWith({ complaint: COMPLAINT });
  ids.addendum = await visitWith({ plan: "follow up" });
  await send(h, C.doctor.cookie, "POST", `/v1/visits/${ids.addendum}/sign`, {});
  await send(h, C.doctor.cookie, "POST", `/v1/visits/${ids.addendum}/addenda`, { body: ADDENDUM });
});

afterAll(() => closeHarness(h));

describe("search inside one patient's visits (P2-F4)", () => {
  it("matches folded note sections and addenda, newest first, audited without the query", async () => {
    const since = new Date();
    const res = await search(C.doctor.cookie, { q: QUERY });
    expect(res.statusCode).toBe(200);
    expect(itemIds(res)).toEqual([ids.addendum, ids.anxious]);
    expect((res.json() as { can: unknown }).can).toEqual({ search: true, start: true });
    const rows = await medicalAudit(h, C.clinicId, since);
    expect(rows.map((r) => [r["action"], r["category"], r["entity_type"], r["entity_id"]])).toEqual(
      [["visit.searched", "patient_access", "patient", patient]],
    );
    expect(rows[0]!["raw"]).not.toContain(QUERY);
  });

  it("Latin case folds", async () => {
    expect(itemIds(await search(C.doctor.cookie, { q: "HEADACHE" }))).toEqual([ids.headache]);
  });

  it("no log line holds the query, a note, an addendum or a preview (R3-6 a)", async () => {
    h.logs.length = 0;
    await search(C.doctor.cookie, { q: QUERY });
    await search(C.doctor.cookie, { q: "x".repeat(101) });
    await send(h, C.doctor.cookie, "GET", `/v1/patients/${patient}/visits`);
    await send(h, C.doctor.cookie, "GET", `/v1/visits/${ids.anxious}`);
    const logs = h.logs.join("\n");
    expect(logs).toContain("/visits/search");
    for (const text of [QUERY, "القلق", "Headache", "نوبات", "x".repeat(101)]) {
      expect(logs).not.toContain(text);
    }
  });

  it("needs view:medical (the front desk and a metadata reader are forbidden); a stranger not_found", async () => {
    expect((await search(C.front.cookie, { q: QUERY })).statusCode).toBe(403);
    expect((await search(C.reader.cookie, { q: QUERY })).statusCode).toBe(403);
    expect((await search(C.doctorB.cookie, { q: QUERY })).statusCode).toBe(404);
  });

  it("scans the 500 newest visits only", async () => {
    const old = await patientIn(h, C, C.branchD);
    const first = await startedVisit(h, C.doctor.cookie, { patientId: old, branchId: C.branchD });
    await send(h, C.doctor.cookie, "PUT", `/v1/visits/${first}/note`, note({ plan: "needle" }));
    expect(itemIds(await search(C.doctor.cookie, { q: "needle" }, old))).toEqual([first]);
    await h.owner`INSERT INTO visits (clinic_id, id, branch_id, patient_id, provider_membership_id,
                    status, started_at, created_at, updated_at)
                  SELECT ${C.clinicId}, gen_random_uuid(), ${C.branchD}, ${old}, ${C.doctor.memberId},
                    'draft', now() + make_interval(secs => g), now(), now()
                  FROM generate_series(1, 500) AS g`;
    expect(itemIds(await search(C.doctor.cookie, { q: "needle" }, old))).toEqual([]);
  });
});

describe("the list's previews", () => {
  it("show the assessment's start to a content reader, one audit row per request", async () => {
    const since = new Date();
    const res = await send(h, C.doctor.cookie, "GET", `/v1/patients/${patient}/visits`);
    const items = (res.json() as { items: { id: string; preview: string | null }[] }).items;
    expect(items.find((v) => v.id === ids.anxious)?.preview).toBe(ASSESSMENT);
    expect(items.find((v) => v.id === ids.headache)?.preview).toBeNull();
    const rows = await medicalAudit(h, C.clinicId, since);
    expect(rows.map((r) => [r["action"], r["entity_id"]])).toEqual([
      ["visit.previews_listed", patient],
    ]);
  });
});
