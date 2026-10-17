import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { setPatientsModule } from "../../patients/__tests__/patient-fixtures.ts";
import { MemoryBlobStore } from "../../../shared/blob/memory-blob-store.ts";
import { filePart, pngBytes, uploaded, uploadParts } from "./attachment-fixtures.ts";
import {
  DOCTOR_KEYS,
  medicalAudit,
  medicalClinic,
  patientIn,
  startVisit,
  startedVisit,
  type MedicalClinic,
} from "./medical-fixtures.ts";

// Owner decision 2026-10-11 (Codex 4241606173): medical content stays inside the caller's patients view
// reach, judged by the patients module's own rule for GET /patients/:id. A file outside it answers
// not_found (or a visit without its content), whatever the medical key; the walk-in stays outside the
// check, and with the patients module off no medical content is reachable.
let h: Harness;
let C: MedicalClinic;
let invalidate: AuthorizationInvalidator;
type Member = Awaited<ReturnType<typeof memberOn>>;
let readIn: Member;
let readOut: Member;
let writeIn: Member;
let writeOut: Member;
let authorOut: Member;
let patient: string;
let visit: string;
let attachment: string;

const NOTE = { complaint: null, examination: null, assessment: "Reach check", plan: null };
const PROFILE = {
  allergies: "Penicillin",
  chronicConditions: null,
  currentMedications: null,
  surgicalHistory: null,
  familyHistory: null,
};
const png = () => [filePart("scan.png", "image/png", pngBytes(256))];

/** A member on `branchIds` (every branch when omitted) holding exactly `keys`. */
const member = async (keys: readonly string[], branchIds?: string[]) =>
  memberOn(
    h,
    C.admin,
    await customRole(h, C.clinicId, keys),
    branchIds === undefined ? {} : { allBranches: false, branchIds },
  );

beforeAll(async () => {
  h = await openHarness({}, true, { blobStore: new MemoryBlobStore() });
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await medicalClinic(h, invalidate);
  const readKeys = ["view:medical:clinic", "view:visits:clinic"];
  // In and out differ only by the patients view reach: the file is registered in branch R.
  readIn = await member([...readKeys, "view:patients:clinic"]);
  readOut = await member([...readKeys, "view:patients:branch"], [C.branchD]);
  writeIn = await member(["update:medical:clinic", "view:patients:clinic"]);
  writeOut = await member(["update:medical:clinic", "view:patients:branch"], [C.branchD]);
  // A doctor of every branch: its walk-in makes the file its own (R1-18), so `own` covers it.
  const author = await member(DOCTOR_KEYS);
  authorOut = await member(DOCTOR_KEYS.filter((k) => k !== "view:patients:own"));
  patient = await patientIn(h, C, C.branchR);
  visit = await startedVisit(h, author.cookie, { patientId: patient, branchId: C.branchR });
  await send(h, author.cookie, "PUT", `/v1/visits/${visit}/note`, NOTE);
  attachment = await uploaded(h, author.cookie, patient, png());
  await invalidate.clinicChanged(C.clinicId);
});

afterAll(() => closeHarness(h));

const READS: [string, (cookie: string) => ReturnType<typeof send>][] = [
  ["medical profile", (c) => send(h, c, "GET", `/v1/patients/${patient}/medical-profile`)],
  ["attachments list", (c) => send(h, c, "GET", `/v1/patients/${patient}/attachments`)],
  ["attachment download", (c) => send(h, c, "GET", `/v1/attachments/${attachment}`)],
  ["note search", (c) => send(h, c, "POST", `/v1/patients/${patient}/visits/search`, { q: "x" })],
  ["prescription print", (c) => send(h, c, "GET", `/v1/visits/${visit}/prescription/print`)],
];

describe("reads naming a patient", () => {
  it.each(READS)("%s: inside the patients reach 200, outside not_found", async (_n, read) => {
    expect((await read(readIn.cookie)).statusCode).toBe(200);
    expect((await read(readOut.cookie)).statusCode).toBe(404);
  });

  it("the visit page: the visit stays (visits key), its content only inside the reach", async () => {
    const content = async (cookie: string) =>
      (
        (await send(h, cookie, "GET", `/v1/visits/${visit}`)).json() as {
          content: { note: { assessment: string | null } } | null;
        }
      ).content;
    expect((await content(readIn.cookie))?.note.assessment).toBe("Reach check");
    expect(await content(readOut.cookie)).toBeNull();
  });

  it("the visit list: previews and their audit row only inside the reach", async () => {
    const listed = async (cookie: string) => {
      const since = new Date();
      const res = await send(h, cookie, "GET", `/v1/patients/${patient}/visits`);
      const body = res.json() as { items: { preview: string | null }[]; can: { search: boolean } };
      const rows = await medicalAudit(h, C.clinicId, since);
      return [body.items[0]?.preview, body.can.search, rows.map((r) => r["action"])];
    };
    expect(await listed(readIn.cookie)).toEqual(["Reach check", true, ["visit.previews_listed"]]);
    expect(await listed(readOut.cookie)).toEqual([null, false, []]);
  });
});

const WRITES: [string, (cookie: string) => Promise<{ statusCode: number }>, number][] = [
  [
    "medical profile save",
    (c) => send(h, c, "PUT", `/v1/patients/${patient}/medical-profile`, PROFILE),
    200,
  ],
  ["attachment upload", (c) => uploadParts(h, c, patient, png()), 201],
  [
    "attachment archive",
    async (c) => {
      const fresh = await uploaded(h, writeIn.cookie, patient, png());
      return send(h, c, "POST", `/v1/attachments/${fresh}/archive`, {});
    },
    200,
  ],
];

describe("writes naming a patient", () => {
  it.each(WRITES)("%s: inside the reach succeeds, outside not_found", async (_n, write, ok) => {
    expect((await write(writeIn.cookie)).statusCode).toBe(ok);
    expect((await write(writeOut.cookie)).statusCode).toBe(404);
  });
});

describe("the provider without a patients key", () => {
  it("starts a walk-in (outside the check) but reads no content and writes no note", async () => {
    const file = await patientIn(h, C, C.branchD);
    const res = await startVisit(h, authorOut.cookie, { patientId: file, branchId: C.branchD });
    expect(res.statusCode).toBe(201);
    const started = res.json() as {
      visit: { visit: { id: string }; content: unknown; can: Record<string, boolean> };
    };
    expect(started.visit.content).toBeNull();
    // Codex 4241757308: no button the writes would answer not_found to.
    const none = { edit: false, sign: false, cancel: false, addAddendum: false, attach: false };
    expect(started.visit.can).toEqual(none);
    const note = `/v1/visits/${started.visit.visit.id}/note`;
    expect((await send(h, authorOut.cookie, "PUT", note, NOTE)).statusCode).toBe(404);
  });
});

describe("the patients module off (owner 2026-10-11: medical requires it)", () => {
  it("the default doctor reaches no medical content of its own patient", async () => {
    const own = await patientIn(h, C, C.branchD);
    await startedVisit(h, C.doctor.cookie, { patientId: own, branchId: C.branchD });
    const profile = () => send(h, C.doctor.cookie, "GET", `/v1/patients/${own}/medical-profile`);
    expect((await profile()).statusCode).toBe(200);
    await setPatientsModule(h, invalidate, C.clinicId, false);
    try {
      expect(code(await profile())).toBe("not_found");
    } finally {
      await setPatientsModule(h, invalidate, C.clinicId, true);
    }
  });
});
