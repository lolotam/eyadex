import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { MemoryBlobStore } from "../persistence/memory-blob-store.ts";
import { filePart, pngBytes, uploaded, uploadParts } from "./attachment-fixtures.ts";
import {
  medicalAudit,
  medicalClinic,
  patientIn,
  startedVisit,
  type MedicalClinic,
} from "./medical-fixtures.ts";

// P2-10, spec §5, R1-14 (plan Task 10): listing, downloading and archiving, the keys and `own`, another
// clinic, and an API started without the blob store settings.
let h: Harness;
let C: MedicalClinic;
let other: MedicalClinic;
let patient: string;
let visit: string;
let notOwn: string;
let scan: string;
let photo: string;
const bytes = pngBytes(2048);
const NAME = "أشعة الصدر (1).png";

type List = { items: { id: string; name: string; status: string; visitId: string | null }[] };
const list = (cookie: string, id: string, query = "") =>
  send(h, cookie, "GET", `/v1/patients/${id}/attachments${query}`);
const download = (cookie: string, id: string) => send(h, cookie, "GET", `/v1/attachments/${id}`);
const archive = (cookie: string, id: string) =>
  send(h, cookie, "POST", `/v1/attachments/${id}/archive`, {});

beforeAll(async () => {
  h = await openHarness({}, true, { medicalBlobStore: new MemoryBlobStore() });
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await medicalClinic(h, invalidate);
  other = await medicalClinic(h, invalidate);
  patient = await patientIn(h, C, C.branchD);
  visit = await startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
  notOwn = await patientIn(h, C, C.branchD);
  scan = await uploaded(h, C.doctor.cookie, patient, [filePart(NAME, "image/png", bytes)]);
  photo = await uploaded(h, C.doctor.cookie, patient, [
    { name: "visitId", value: visit },
    filePart("b.png", "image/png", pngBytes(128)),
  ]);
});

afterAll(() => closeHarness(h));

describe("list", () => {
  it("shows the patient's active attachments newest first, or one visit's", async () => {
    const all = await list(C.doctor.cookie, patient);
    expect(all.statusCode).toBe(200);
    expect((all.json() as List).items.map((a) => a.id)).toEqual([photo, scan]);
    expect((all.json() as List).items[1]!.name).toBe(NAME);
    const ofVisit = await list(C.doctor.cookie, patient, `?visitId=${visit}`);
    expect((ofVisit.json() as List).items.map((a) => a.id)).toEqual([photo]);
    expect(code(await list(C.doctor.cookie, patient, "?visitId=x"))).toBe("validation");
  });

  it("shows decrypted names, so one list writes one patient_access row without a name", async () => {
    const since = new Date();
    expect((await list(C.doctor.cookie, patient)).statusCode).toBe(200);
    const rows = await medicalAudit(h, C.clinicId, since);
    expect(rows.map((r) => [r["action"], r["category"], r["entity_type"], r["entity_id"]])).toEqual(
      [["attachment.listed", "patient_access", "patient", patient]],
    );
    expect(rows[0]!["branch_id"]).toBe(C.branchD);
    expect(rows[0]!["details"]).toEqual({ before: null, after: null });
    expect(rows[0]!["raw"]).not.toMatch(/أشعة|\.png/);
  });

  it("NEGATIVE: without a medical key it is forbidden; another doctor's patient is not_found", async () => {
    expect(code(await list(C.front.cookie, patient))).toBe("forbidden");
    expect(code(await list(C.admin.cookie, patient))).toBe("forbidden");
    expect(code(await list(C.doctorB.cookie, patient))).toBe("not_found");
    expect(code(await list(other.doctor.cookie, patient))).toBe("not_found");
  });
});

describe("download", () => {
  it("answers the plaintext as an attachment, safely named, and audits it without the name", async () => {
    const since = new Date();
    const res = await download(C.doctor.cookie, scan);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(bytes)).toBe(true);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    const disposition = String(res.headers["content-disposition"]);
    expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(decodeURIComponent(disposition.split("UTF-8''")[1]!)).toBe(NAME);
    const rows = await medicalAudit(h, C.clinicId, since);
    expect(rows.map((r) => [r["action"], r["category"], r["entity_id"], r["branch_id"]])).toEqual([
      ["attachment.downloaded", "patient_access", scan, C.branchD],
    ]);
    expect(rows[0]!["details"]).toEqual({ before: null, after: null });
    expect(rows[0]!["raw"]).not.toContain("أشعة");
  });

  it("NEGATIVE: another clinic, another doctor's patient or no medical key cannot download", async () => {
    expect(code(await download(other.doctor.cookie, scan))).toBe("not_found");
    expect(code(await download(C.doctorB.cookie, scan))).toBe("not_found");
    expect(code(await download(C.front.cookie, scan))).toBe("forbidden");
    expect(code(await download(C.doctor.cookie, randomUUID()))).toBe("not_found");
  });
});

describe("own (spec §2)", () => {
  it("NEGATIVE: update:medical:own cannot upload to a patient the caller never saw", async () => {
    const res = await uploadParts(h, C.doctor.cookie, notOwn, [
      filePart("x.png", "image/png", pngBytes(64)),
    ]);
    expect(code(res)).toBe("not_found");
    expect(code(await uploadParts(h, C.front.cookie, patient, []))).toBe("forbidden");
  });
});

describe("archive", () => {
  it("hides the attachment from lists, the visit page and downloads; a second archive writes nothing", async () => {
    const since = new Date();
    const res = await archive(C.doctor.cookie, photo);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { attachment: { status: string } }).attachment.status).toBe("archived");
    expect((await archive(C.doctor.cookie, photo)).statusCode).toBe(200);
    const rows = await medicalAudit(h, C.clinicId, since);
    expect(rows.map((r) => [r["action"], r["entity_id"], r["branch_id"], r["details"]])).toEqual([
      ["attachment.archived", photo, C.branchD, { before: null, after: { changed: ["status"] } }],
    ]);
    expect(((await list(C.doctor.cookie, patient)).json() as List).items.map((a) => a.id)).toEqual([
      scan,
    ]);
    const page = await send(h, C.doctor.cookie, "GET", `/v1/visits/${visit}`);
    expect((page.json() as { content: { attachments: unknown[] } }).content.attachments).toEqual(
      [],
    );
    expect(code(await download(C.doctor.cookie, photo))).toBe("not_found");
    const [row] = await h.owner`SELECT status FROM patient_attachments WHERE id = ${photo}`;
    expect(row!["status"]).toBe("archived");
  });

  it("NEGATIVE: a reader without update:medical, or another clinic, cannot archive", async () => {
    expect(code(await archive(C.reader.cookie, scan))).toBe("forbidden");
    expect(code(await archive(other.doctor.cookie, scan))).toBe("not_found");
  });
});

describe("without the blob store settings", () => {
  let bare: Harness;
  beforeAll(async () => {
    // Same auth secret, so the sessions made by the first app still sign in here.
    bare = await openHarness({ BETTER_AUTH_SECRET: process.env["BETTER_AUTH_SECRET"]! }, true);
  });
  afterAll(() => closeHarness(bare));

  it("starts, lists, and answers 503 to an upload and a download", async () => {
    const asDoctor = (method: "GET" | "POST", url: string) =>
      send(bare, C.doctor.cookie, method, url);
    expect((await asDoctor("GET", `/v1/patients/${patient}/attachments`)).statusCode).toBe(200);
    const down = await asDoctor("GET", `/v1/attachments/${scan}`);
    expect(down.statusCode).toBe(503);
    expect(code(down)).toBe("unknown");
    const up = await uploadParts(bare, C.doctor.cookie, patient, [
      filePart("x.png", "image/png", pngBytes(64)),
    ]);
    expect(up.statusCode).toBe(503);
  });
});
