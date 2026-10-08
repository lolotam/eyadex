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
// An invisible character between the two halves of the number: it renders as nothing.
const splitBy = (mark: string) => (digits: string) =>
  `${digits.slice(0, 6)}${mark}${digits.slice(6)}`;

// Codex round 2 asks for the assertion on the deobfuscated payload: every invisible format/control
// character and JSON \u escape removed, full-width and Arabic-Indic digits folded to ASCII.
const deobfuscate = (raw: string) =>
  raw
    .replace(/\\u[0-9a-fA-F]{4}/g, "")
    .replace(/[\p{Cf}\p{Cc}]/gu, "")
    .normalize("NFKC")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));

// Written as code points so no invisible character sits in this source file.
const ZWJ = String.fromCharCode(0x200d);
const BIDI = String.fromCharCode(0x202e, 0x2066); // right-to-left override + left-to-right isolate
const SOFT_HYPHEN = String.fromCharCode(0x00ad);
const BELL = String.fromCharCode(0x0007);
const BOM = String.fromCharCode(0xfeff);

describe("the stored audit payload of a create", () => {
  const cases = [
    ["a civil ID glued to the name", fakeCivilId, (v: string) => `Test${v}`],
    ["a full-width phone in the name", fakePhone, (v: string) => `Test ${fullWidth(v)}`],
    [
      "an Arabic-Indic civil ID glued to the name",
      fakeCivilId,
      (v: string) => `Test${arabicIndic(v)}`,
    ],
    ["a ZWJ-split civil ID", fakeCivilId, (v: string) => `Test${splitBy(ZWJ)(v)}`],
    ["a ZWJ-split phone", fakePhone, (v: string) => `Test${splitBy(ZWJ)(v)}`],
    ["a bidi-control-split civil ID", fakeCivilId, (v: string) => `Test${splitBy(BIDI)(v)}`],
    ["a soft-hyphen-split phone", fakePhone, (v: string) => `Test${splitBy(SOFT_HYPHEN)(v)}`],
    ["a C0-control-split civil ID", fakeCivilId, (v: string) => `Test${splitBy(BELL)(v)}`],
  ] as const;

  it.each(cases)("%s keeps none of its digits", async (_label, makeValue, nameOf) => {
    const value = makeValue();
    const fullName = nameOf(value);
    const res = await createPatient(h, C.admin.cookie, patientBody(C.branchR, { fullName }));
    expect(res.statusCode).toBe(201);
    const { id } = patientWriteResultSchema.parse(res.json());
    const [created] = await patientAudit(h, C.clinicId, id);
    const clear = deobfuscate(created!["raw"] as string);
    expect(clear).not.toContain(value);
    expect(clear).not.toContain(value.slice(-7));
    const after = (created!["details"] as { after: { fullName: string } }).after;
    // A civil ID goes whole; a phone keeps only its last 3 digits.
    const digits = deobfuscate(after.fullName).replace(/\D/g, "");
    expect(digits).toBe(value.length === 12 ? "" : value.slice(-3));
  });

  it("the stored name itself carries no invisible control (contract normalization)", async () => {
    const fullName = `${BIDI}Noura${ZWJ} Al${SOFT_HYPHEN}Ali${BOM}`;
    const res = await createPatient(h, C.admin.cookie, patientBody(C.branchR, { fullName }));
    const { id, detail } = patientWriteResultSchema.parse(res.json());
    expect(detail?.fullName).toBe("Noura AlAli");
    const [row] = await h.owner`SELECT full_name FROM patients WHERE id = ${id}`;
    expect(row!["full_name"]).toBe("Noura AlAli");
  });
});
