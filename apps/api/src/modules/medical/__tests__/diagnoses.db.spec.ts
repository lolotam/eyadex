import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import {
  appointmentFor,
  medicalAudit,
  medicalClinic,
  patientIn,
  seedIcd10,
  startedVisit,
  type MedicalClinic,
} from "./medical-fixtures.ts";

// P2-8, R1-13, R2-8 (ADR-0029): the draft's diagnoses are replaced whole by the provider; each code and
// text is a sealed envelope; a replaced row is archived and never shown; an unknown or header code is
// icd10_unknown; a diagnosis alone makes a visit signable; a replace queued behind a sign writes nothing;
// the same list again writes no row and is audited as the open it answers.
let h: Harness;
let C: MedicalClinic;

const GAD = { kind: "icd10", code: "F41.1", text: "Generalized anxiety disorder" } as const;
const FREE = { kind: "text", text: "أرق مزمن مع توتر" } as const;
const OTHER = { kind: "text", text: "Tension headache" } as const;

type Detail = {
  visit: { status: string };
  content: { diagnoses: { position: number; kind: string; code: string | null; text: string }[] };
  can: { sign: boolean };
};
const detailOf = (res: { json: () => unknown }) => (res.json() as { visit: Detail }).visit;
const save = (cookie: string, id: string, items: unknown[]) =>
  send(h, cookie, "PUT", `/v1/visits/${id}/diagnoses`, { items });
const rowsOf = (id: string) =>
  h.owner`SELECT position, kind, archived_at, row_to_json(d)::text AS raw FROM visit_diagnoses d
          WHERE d.visit_id = ${id} ORDER BY created_at, position`;

async function walkIn(): Promise<string> {
  const patient = await patientIn(h, C, C.branchD);
  return startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
}

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await medicalClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  await seedIcd10(h);
});

afterAll(() => closeHarness(h));

describe("PUT /v1/visits/:id/diagnoses (draft only)", () => {
  it("stores only envelopes, shows the list in order, and logs the field name only", async () => {
    const id = await walkIn();
    const since = new Date();
    const res = await save(C.doctor.cookie, id, [GAD, FREE]);
    expect(res.statusCode).toBe(200);
    expect(detailOf(res).content.diagnoses).toEqual([
      { position: 0, ...GAD },
      { position: 1, kind: "text", code: null, text: FREE.text },
    ]);
    const rows = await rowsOf(id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row["raw"]).not.toContain("F41");
      expect(row["raw"]).not.toContain("anxiety");
      expect(row["raw"]).not.toContain("أرق");
    }
    const audit = await medicalAudit(h, C.clinicId, since);
    expect(audit.map((r) => [r["action"], r["category"], r["entity_type"], r["details"]])).toEqual([
      [
        "visit.diagnoses_saved",
        "patient_access",
        "diagnosis",
        { before: null, after: { changed: ["items"] } },
      ],
    ]);
    expect(audit[0]!["entity_id"]).toBe(id);
    expect(audit[0]!["raw"]).not.toMatch(/F41|anxiety|أرق/);
  });

  it("the same list again writes nothing, and the content it answers is logged as an open", async () => {
    const id = await walkIn();
    await save(C.doctor.cookie, id, [GAD, FREE]);
    const since = new Date();
    expect((await save(C.doctor.cookie, id, [GAD, FREE])).statusCode).toBe(200);
    const audit = await medicalAudit(h, C.clinicId, since);
    expect(
      audit.map((r) => [r["action"], r["category"], r["entity_type"], r["entity_id"]]),
    ).toEqual([["visit.opened", "patient_access", "visit", id]]);
    expect(audit[0]!["details"]).toEqual({ before: null, after: null });
    expect(await rowsOf(id)).toHaveLength(2);
  });

  it("a replace archives the active rows; archived rows never show again (R1-13)", async () => {
    const id = await walkIn();
    await save(C.doctor.cookie, id, [GAD, FREE]);
    const res = await save(C.doctor.cookie, id, [OTHER]);
    expect(detailOf(res).content.diagnoses).toEqual([{ position: 0, code: null, ...OTHER }]);
    const rows = await rowsOf(id);
    expect(rows.filter((r) => r["archived_at"] === null)).toHaveLength(1);
    expect(rows.filter((r) => r["archived_at"] !== null)).toHaveLength(2);
    const opened = await send(h, C.doctor.cookie, "GET", `/v1/visits/${id}`);
    expect((opened.json() as Detail).content.diagnoses.map((d) => d.text)).toEqual([OTHER.text]);
    const emptied = await save(C.doctor.cookie, id, []);
    expect(detailOf(emptied).content.diagnoses).toEqual([]);
  });

  it("icd10_unknown for a code not in the table or a header row; nothing is written", async () => {
    const id = await walkIn();
    await save(C.doctor.cookie, id, [FREE]);
    const since = new Date();
    for (const code_ of ["Z99.9", "F41"]) {
      const res = await save(C.doctor.cookie, id, [{ kind: "icd10", code: code_, text: "x" }]);
      expect(res.statusCode).toBe(422);
      expect(code(res)).toBe("icd10_unknown");
      expect(res.body).not.toContain(code_);
    }
    expect(await medicalAudit(h, C.clinicId, since)).toEqual([]);
    expect((await rowsOf(id)).filter((r) => r["archived_at"] === null)).toHaveLength(1);
  });

  it("only the provider writes; a signed visit is visit_signed; a reader without medical is 403", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const id = await startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
    await appointmentFor(h, C, patient, "15:00", { providerMembershipId: C.doctorB.memberId });
    expect(code(await save(C.doctorB.cookie, id, [FREE]))).toBe("visit_not_provider");
    expect((await save(C.reader.cookie, id, [FREE])).statusCode).toBe(403);
    await save(C.doctor.cookie, id, [FREE]);
    expect((await send(h, C.doctor.cookie, "POST", `/v1/visits/${id}/sign`, {})).statusCode).toBe(
      200,
    );
    expect(code(await save(C.doctor.cookie, id, [OTHER]))).toBe("visit_signed");
    expect((await rowsOf(id)).map((r) => r["archived_at"])).toEqual([null]);
  });
});

describe("signing with diagnoses (spec §4)", () => {
  it("a visit with only a diagnosis is signable and signs", async () => {
    const id = await walkIn();
    const saved = await save(C.doctor.cookie, id, [GAD]);
    expect(detailOf(saved).can.sign).toBe(true);
    const signed = await send(h, C.doctor.cookie, "POST", `/v1/visits/${id}/sign`, {});
    expect(signed.statusCode).toBe(200);
    expect(detailOf(signed).visit.status).toBe("signed");
  });

  it("removing the last diagnosis makes an empty draft unsignable again", async () => {
    const id = await walkIn();
    await save(C.doctor.cookie, id, [GAD]);
    expect(detailOf(await save(C.doctor.cookie, id, [])).can.sign).toBe(false);
    const res = await send(h, C.doctor.cookie, "POST", `/v1/visits/${id}/sign`, {});
    expect(code(res)).toBe("visit_empty");
  });
});

describe("the note search reads diagnoses too (P2-F4)", () => {
  it("finds a visit by its diagnosis text", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const id = await startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
    await startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
    await save(C.doctor.cookie, id, [FREE]);
    const res = await send(h, C.doctor.cookie, "POST", `/v1/patients/${patient}/visits/search`, {
      q: "ارق",
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: { id: string }[] }).items.map((v) => v.id)).toEqual([id]);
  });
});

describe("a replace racing a sign (R3-6 b)", () => {
  async function waiters(n: number): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_locks
                                  WHERE locktype = 'advisory' AND NOT granted`;
      if ((row!["n"] as number) >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`fewer than ${n} lock waiters`);
  }

  it("the replace queued after the sign is visit_signed and the list stays as signed", async () => {
    const id = await walkIn();
    await save(C.doctor.cookie, id, [GAD]);
    const before = await rowsOf(id);
    const lock = `appointments:${C.clinicId}:${C.doctor.memberId}`;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const taken = new Promise<void>((resolve) => (locked = resolve));
    const holder = h.owner.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
      locked();
      await held;
    });
    await taken;
    const signing = send(h, C.doctor.cookie, "POST", `/v1/visits/${id}/sign`, {});
    await waiters(1);
    const replacing = save(C.doctor.cookie, id, [OTHER]);
    await waiters(2);
    release();
    await holder;
    const [signed, replaced] = await Promise.all([signing, replacing]);
    expect(signed.statusCode).toBe(200);
    expect(code(replaced)).toBe("visit_signed");
    expect(await rowsOf(id)).toEqual(before);
  });
});
