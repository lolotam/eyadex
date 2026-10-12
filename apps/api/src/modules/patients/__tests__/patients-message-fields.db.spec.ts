import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { patientDetailSchema, patientWriteResultSchema } from "@eyadex/contracts/patients";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import {
  createPatient,
  openPatient,
  patientAudit,
  patientBody,
  patientsClinic,
  updatePatient,
} from "./patient-fixtures.ts";

// Phase 3 N1 (N-2, ADR-0031): the patient file's email, message language and reminder opt-out. The
// address is personal data: it is stored and returned, never written to an audit row or a log line.
let h: Harness;
let C: Awaited<ReturnType<typeof patientsClinic>>;

const EMAIL = "message.fields.patient@example.test";

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await patientsClinic(h);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("patient message fields round-trip", () => {
  it("create stores the trimmed, lower-cased email, the language and the opt-out; open returns them", async () => {
    const body = patientBody(C.branchR, {
      email: `  ${EMAIL.toUpperCase()} `,
      messageLanguage: "en",
      notificationsOptOut: true,
    });
    const res = await createPatient(h, C.admin.cookie, body);
    expect(res.statusCode).toBe(201);
    const { id, detail } = patientWriteResultSchema.parse(res.json());
    expect(detail).toMatchObject({
      email: EMAIL,
      messageLanguage: "en",
      notificationsOptOut: true,
    });
    const opened = patientDetailSchema.parse((await openPatient(h, C.admin.cookie, id)).json());
    expect(opened).toMatchObject({
      email: EMAIL,
      messageLanguage: "en",
      notificationsOptOut: true,
    });
    const [row] = await h.owner`SELECT email, message_language, notifications_opt_out
                                FROM patients WHERE id = ${id}`;
    expect(row).toEqual({ email: EMAIL, message_language: "en", notifications_opt_out: true });
  });

  it("an empty email and language are stored and answered as null; update clears and sets them", async () => {
    const res = await createPatient(h, C.admin.cookie, patientBody(C.branchR));
    const { id, detail } = patientWriteResultSchema.parse(res.json());
    expect(detail).toMatchObject({
      email: null,
      messageLanguage: null,
      notificationsOptOut: false,
    });
    const set = patientBody(C.branchR, { email: EMAIL, messageLanguage: "ar" });
    const updated = await updatePatient(h, C.admin.cookie, id, set);
    expect(patientWriteResultSchema.parse(updated.json()).detail).toMatchObject({
      email: EMAIL,
      messageLanguage: "ar",
    });
    const cleared = await updatePatient(h, C.admin.cookie, id, { ...set, email: "" });
    expect(patientWriteResultSchema.parse(cleared.json()).detail).toMatchObject({
      email: null,
      messageLanguage: "ar",
    });
  });

  it("refuses an email that is not an address and a language outside ar/en", async () => {
    for (const extra of [{ email: "not-an-address" }, { messageLanguage: "fr" }]) {
      const res = await createPatient(h, C.admin.cookie, patientBody(C.branchR, extra));
      expect(res.statusCode, JSON.stringify(extra)).toBe(400);
    }
  });
});

describe("the email never reaches the audit log or the logs", () => {
  it("the snapshots say hasEmail only; no log line holds the address", async () => {
    const start = h.logs.length;
    const body = patientBody(C.branchR, { email: EMAIL, messageLanguage: "en" });
    const { id } = patientWriteResultSchema.parse(
      (await createPatient(h, C.admin.cookie, body)).json(),
    );
    await openPatient(h, C.admin.cookie, id);
    await updatePatient(h, C.admin.cookie, id, { ...body, notificationsOptOut: true });
    const rows = await patientAudit(h, C.clinicId, id);
    expect(rows.map((r) => r["action"])).toEqual([
      "patient.created",
      "patient.opened",
      "patient.updated",
    ]);
    for (const row of rows) expect(row["raw"] as string).not.toContain(EMAIL);
    const updated = rows[2]!["details"] as { before: object; after: object };
    expect(updated.before).toMatchObject({ hasEmail: true, notificationsOptOut: false });
    expect(updated.after).toMatchObject({
      hasEmail: true,
      messageLanguage: "en",
      notificationsOptOut: true,
    });
    expect(h.logs.slice(start).join("\n")).not.toContain(EMAIL);
  });
});
