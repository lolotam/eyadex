import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { patientWriteResultSchema } from "@eyadex/contracts/patients";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import {
  createPatient,
  fakeCivilId,
  fakePhone,
  patientAudit,
  patientBody,
  patientsClinic,
} from "./patient-fixtures.ts";

// Codex P1 (slice 9): identifiers typed INTO a name must not survive in the append-only audit row —
// glued to a word, in full-width digits, or in Arabic-Indic digits. Synthetic values only.
let h: Harness;
let C: Awaited<ReturnType<typeof patientsClinic>>;

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await patientsClinic(h);
});
afterAll(async () => {
  await closeHarness(h);
});

const fullWidth = (digits: string) =>
  digits.replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));
const arabicIndic = (digits: string) =>
  digits.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));

describe("the stored audit payload of a create", () => {
  const cases = [
    ["a civil ID glued to the name", () => fakeCivilId(), (v: string) => `Test${v}`],
    ["a full-width phone in the name", () => fakePhone(), (v: string) => `Test ${fullWidth(v)}`],
    [
      "an Arabic-Indic civil ID glued to the name",
      () => fakeCivilId(),
      (v: string) => `Test${arabicIndic(v)}`,
    ],
  ] as const;

  it.each(cases)("%s keeps none of its digits", async (_label, makeValue, nameOf) => {
    const value = makeValue();
    const fullName = nameOf(value);
    const res = await createPatient(h, C.admin.cookie, patientBody(C.branchR, { fullName }));
    expect(res.statusCode).toBe(201);
    const { id } = patientWriteResultSchema.parse(res.json());
    const [created] = await patientAudit(h, C.clinicId, id);
    const raw = created!["raw"] as string;
    for (const form of [value, fullWidth(value), arabicIndic(value), value.slice(-7)]) {
      expect(raw).not.toContain(form);
    }
    const after = (created!["details"] as { after: { fullName: string } }).after;
    // A civil ID goes whole; a phone keeps only its last 3 digits.
    expect(after.fullName.replace(/\D/g, "")).toBe(value.length === 12 ? "" : value.slice(-3));
  });
});
