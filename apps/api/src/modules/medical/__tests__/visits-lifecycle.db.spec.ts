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
  startedVisit,
  type MedicalClinic,
} from "./medical-fixtures.ts";

// P2-3, P2-6, spec §3 and §4 (ADR-0028, ADR-0029): only the provider writes; a draft is saved, signed or
// cancelled; a signed visit only gains addenda; every clinical value is a sealed envelope and the log
// names fields only.
let h: Harness;
let C: MedicalClinic;

const COMPLAINT = "صداع نصفي منذ ثلاثة أيام";
const PLAN = "Paracetamol and rest";
const ADDENDUM = "تصحيح: الألم في الجهة اليسرى";
const CANCEL_NOTE = "opened on the wrong file";

const NOTE = { complaint: COMPLAINT, examination: null, assessment: null, plan: PLAN };
type Detail = {
  visit: { status: string; signedAt: string | null };
  content: {
    note: Record<string, string | null>;
    addenda: { body: string; authorName: string }[];
  } | null;
  can: Record<string, boolean>;
};
const detailOf = (res: { json: () => unknown }) => (res.json() as { visit: Detail }).visit;
const put = (cookie: string, id: string, body: unknown) =>
  send(h, cookie, "PUT", `/v1/visits/${id}/note`, body);
const post = (cookie: string, id: string, action: string, body: unknown = {}) =>
  send(h, cookie, "POST", `/v1/visits/${id}/${action}`, body);

async function walkIn(): Promise<string> {
  const patient = await patientIn(h, C, C.branchD);
  return startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
}

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await medicalClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
});

afterAll(() => closeHarness(h));

describe("the note (draft only)", () => {
  it("stores only envelopes, an empty section as NULL, and reads back the text", async () => {
    const id = await walkIn();
    const since = new Date();
    const res = await put(C.doctor.cookie, id, { ...NOTE, examination: "   " });
    expect(res.statusCode).toBe(200);
    expect(detailOf(res).content!.note).toEqual(NOTE);
    const [row] = await h.owner`SELECT n.*, row_to_json(n)::text AS raw FROM visit_notes n
                                WHERE n.visit_id = ${id}`;
    expect(row!["complaint_enc"]).toMatch(/^f1\.[0-9]+\./);
    expect(row!["plan_enc"]).toMatch(/^f1\.[0-9]+\./);
    expect(row!["examination_enc"]).toBeNull();
    expect(row!["raw"]).not.toContain(COMPLAINT);
    expect(row!["raw"]).not.toContain("Paracetamol");
    const audit = await medicalAudit(h, C.clinicId, since);
    expect(audit.map((r) => [r["action"], r["category"], r["details"]])).toEqual([
      [
        "visit.note_saved",
        "patient_access",
        { before: null, after: { changed: ["complaint", "plan"] } },
      ],
    ]);
    expect(audit[0]!["raw"]).not.toContain("صداع");
  });

  it("saving the same values again writes nothing, and the content it answers is logged as an open", async () => {
    const id = await walkIn();
    await put(C.doctor.cookie, id, NOTE);
    const since = new Date();
    expect((await put(C.doctor.cookie, id, NOTE)).statusCode).toBe(200);
    const audit = await medicalAudit(h, C.clinicId, since);
    expect(
      audit.map((r) => [r["action"], r["category"], r["entity_type"], r["entity_id"]]),
    ).toEqual([["visit.opened", "patient_access", "visit", id]]);
    expect(audit[0]!["details"]).toEqual({ before: null, after: null });
  });

  it("another doctor of the same patient is visit_not_provider; a stranger not_found", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const id = await startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
    expect(code(await put(C.doctorB.cookie, id, NOTE))).toBe("not_found");
    await appointmentFor(h, C, patient, "16:00", { providerMembershipId: C.doctorB.memberId });
    expect(code(await put(C.doctorB.cookie, id, NOTE))).toBe("visit_not_provider");
    expect((await put(C.reader.cookie, id, NOTE)).statusCode).toBe(403);
  });
});

describe("signing (P2-6)", () => {
  it("an empty draft is visit_empty; a written one signs and locks", async () => {
    const id = await walkIn();
    expect(code(await post(C.doctor.cookie, id, "sign"))).toBe("visit_empty");
    await put(C.doctor.cookie, id, NOTE);
    const since = new Date();
    const signed = await post(C.doctor.cookie, id, "sign");
    expect(signed.statusCode).toBe(200);
    expect(detailOf(signed).visit.status).toBe("signed");
    expect(detailOf(signed).can).toEqual({
      edit: false,
      sign: false,
      cancel: false,
      addAddendum: true,
    });
    const [row] = await h.owner`SELECT signed_by FROM visits WHERE id = ${id}`;
    expect(row!["signed_by"]).toBe(C.doctor.memberId);
    expect(code(await put(C.doctor.cookie, id, { ...NOTE, plan: "changed" }))).toBe("visit_signed");
    expect(code(await post(C.doctor.cookie, id, "sign"))).toBe("visit_signed");
    expect(code(await post(C.doctor.cookie, id, "cancel", { reason: "other", note: null }))).toBe(
      "visit_signed",
    );
    const actions = (await medicalAudit(h, C.clinicId, since)).map((r) => r["action"]);
    expect(actions).toEqual(["visit.signed"]);
  });

  it("addenda only on a signed visit, sealed, shown with their author", async () => {
    const id = await walkIn();
    expect(code(await post(C.doctor.cookie, id, "addenda", { body: ADDENDUM }))).toBe(
      "visit_not_signed",
    );
    await put(C.doctor.cookie, id, NOTE);
    await post(C.doctor.cookie, id, "sign");
    const since = new Date();
    const res = await post(C.doctor.cookie, id, "addenda", { body: ADDENDUM });
    expect(res.statusCode).toBe(201);
    const addenda = detailOf(res).content!.addenda;
    expect(addenda.map((a) => a.body)).toEqual([ADDENDUM]);
    expect(addenda[0]!.authorName).not.toBe("—");
    const [row] = await h.owner`SELECT row_to_json(a)::text AS raw FROM visit_addenda a
                                WHERE a.visit_id = ${id}`;
    expect(row!["raw"]).not.toContain("تصحيح");
    const audit = await medicalAudit(h, C.clinicId, since);
    expect(audit.map((r) => [r["action"], r["entity_type"], r["details"]])).toEqual([
      ["visit.addendum_added", "visit_addendum", { before: null, after: { changed: ["body"] } }],
    ]);
  });
});

describe("cancelling a draft", () => {
  it("keeps the visit with a reason and a sealed note; nothing more is accepted", async () => {
    const id = await walkIn();
    const res = await post(C.doctor.cookie, id, "cancel", {
      reason: "patient_left",
      note: CANCEL_NOTE,
    });
    expect(res.statusCode).toBe(200);
    expect(detailOf(res).visit.status).toBe("cancelled");
    const [row] =
      await h.owner`SELECT status, cancel_reason, cancel_note_enc FROM visits WHERE id = ${id}`;
    expect(row).toMatchObject({ status: "cancelled", cancel_reason: "patient_left" });
    expect(row!["cancel_note_enc"]).toMatch(/^f1\.[0-9]+\./);
    expect(code(await put(C.doctor.cookie, id, NOTE))).toBe("invalid_transition");
    expect(code(await post(C.doctor.cookie, id, "sign"))).toBe("invalid_transition");
    expect(code(await post(C.doctor.cookie, id, "addenda", { body: "x" }))).toBe(
      "invalid_transition",
    );
  });
});

describe("a save racing a sign (R3-6 b)", () => {
  async function waiters(n: number): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_locks
                                  WHERE locktype = 'advisory' AND NOT granted`;
      if ((row!["n"] as number) >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`fewer than ${n} lock waiters`);
  }

  it("the save queued after the sign is visit_signed and changes nothing", async () => {
    const id = await walkIn();
    await put(C.doctor.cookie, id, NOTE);
    const [before] = await h.owner`SELECT row_to_json(n)::text AS raw FROM visit_notes n
                                   WHERE n.visit_id = ${id}`;
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
    const signing = post(C.doctor.cookie, id, "sign");
    await waiters(1);
    const saving = put(C.doctor.cookie, id, { ...NOTE, plan: "late edit" });
    await waiters(2);
    release();
    await holder;
    const [signed, saved] = await Promise.all([signing, saving]);
    expect(signed.statusCode).toBe(200);
    expect(code(saved)).toBe("visit_signed");
    const [after] = await h.owner`SELECT row_to_json(n)::text AS raw FROM visit_notes n
                                  WHERE n.visit_id = ${id}`;
    expect(after!["raw"]).toBe(before!["raw"]);
  });
});
