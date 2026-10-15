import { createHash, randomUUID } from "node:crypto";

import { ATTACHMENT_MAX_BYTES } from "@eyadex/contracts/attachments";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { MemoryBlobStore } from "../../../shared/blob/memory-blob-store.ts";
import {
  filePart,
  pngBytes,
  postMultipart,
  testCipher,
  uploadParts,
} from "./attachment-fixtures.ts";
import {
  medicalAudit,
  medicalClinic,
  patientIn,
  startedVisit,
  type MedicalClinic,
} from "./medical-fixtures.ts";

// P2-10, spec §6, R1-14, R1-15, R2-7 (plan Task 10): the upload, with real multipart bodies. The content
// is sealed before it reaches the store, bound to the clinic and the attachment; the row holds the
// plaintext's hash and the sealed name; nothing of the file reaches an audit row or a log line.
let h: Harness;
let C: MedicalClinic;
const store = new MemoryBlobStore();
let patient: string;
let visit: string;
let otherPatientVisit: string;

const NAME = "تحليل الدم.png";

beforeAll(async () => {
  h = await openHarness({}, true, { medicalBlobStore: store });
  C = await medicalClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  patient = await patientIn(h, C, C.branchD);
  // Walk-ins make both patients the doctor's own (R1-18).
  visit = await startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
  const second = await patientIn(h, C, C.branchD);
  otherPatientVisit = await startedVisit(h, C.doctor.cookie, {
    patientId: second,
    branchId: C.branchD,
  });
});

afterAll(() => closeHarness(h));

const rowCount = async () =>
  Number(
    (
      await h.owner`SELECT count(*)::int AS n FROM patient_attachments WHERE clinic_id = ${C.clinicId}`
    )[0]!["n"],
  );

describe("upload", () => {
  it("seals the content to the clinic and the attachment, and records the plaintext's hash", async () => {
    const since = new Date();
    const bytes = pngBytes(1024);
    const res = await uploadParts(h, C.doctor.cookie, patient, [
      filePart(NAME, "image/png", bytes),
    ]);
    expect(res.statusCode).toBe(201);
    const { attachment } = res.json() as { attachment: Record<string, unknown> };
    expect(attachment).toMatchObject({
      patientId: patient,
      visitId: null,
      name: NAME,
      contentType: "image/png",
      sizeBytes: 1024,
      status: "active",
    });
    expect(attachment["uploadedByName"]).not.toBe("—");
    const id = attachment["id"] as string;
    const key = `clinic/${C.clinicId}/${id}`;
    const blob = store.stored.get(key)!;
    expect(blob.includes(bytes.subarray(0, 64))).toBe(false);
    const cipher = testCipher();
    const ref = { table: "patient_attachments", column: "blob", rowId: id };
    expect(cipher.openBytes(C.clinicId, ref, blob.toString("utf8")).equals(bytes)).toBe(true);
    expect(() =>
      cipher.openBytes(C.clinicId, { ...ref, rowId: randomUUID() }, blob.toString("utf8")),
    ).toThrow();
    const [row] = await h.owner`SELECT a.*, row_to_json(a)::text AS raw FROM patient_attachments a
                                WHERE a.id = ${id}`;
    expect(row!["storage_key"]).toBe(key);
    expect(row!["sha256"]).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(row!["name_enc"]).toMatch(/^f1\.[0-9]+\./);
    expect(row!["raw"]).not.toContain("تحليل");
    const audit = await medicalAudit(h, C.clinicId, since);
    expect(
      audit.map((r) => [r["action"], r["category"], r["entity_type"], r["entity_id"]]),
    ).toEqual([["attachment.uploaded", "patient_access", "attachment", id]]);
    expect(audit[0]!["details"]).toEqual({ before: null, after: { changed: ["file"] } });
    expect(audit[0]!["raw"]).not.toContain("تحليل");
    expect(h.logs.join("")).not.toContain("تحليل");
  });

  it("attaches to a visit of the same patient, which then lists it on its page", async () => {
    const res = await uploadParts(h, C.doctor.cookie, patient, [
      { name: "visitId", value: visit },
      filePart("lab.pdf", "application/pdf", Buffer.from("%PDF-1.7\n%test\n")),
    ]);
    expect(res.statusCode).toBe(201);
    const { attachment } = res.json() as { attachment: { id: string; visitId: string } };
    expect(attachment.visitId).toBe(visit);
    const page = await send(h, C.doctor.cookie, "GET", `/v1/visits/${visit}`);
    const content = (page.json() as { content: { attachments: { id: string }[] } }).content;
    expect(content.attachments.map((a) => a.id)).toEqual([attachment.id]);
  });

  it("NEGATIVE: a visit of another patient, or no visit at all, is attachment_patient_mismatch (R1-15)", async () => {
    const before = await rowCount();
    for (const visitId of [otherPatientVisit, randomUUID()]) {
      const res = await uploadParts(h, C.doctor.cookie, patient, [
        { name: "visitId", value: visitId },
        filePart("x.png", "image/png", pngBytes(64)),
      ]);
      expect(res.statusCode).toBe(422);
      expect(code(res)).toBe("attachment_patient_mismatch");
    }
    expect(await rowCount()).toBe(before);
  });

  it("accepts exactly 20 MB and refuses 20 MB + 1 byte as attachment_too_large (R2-7)", async () => {
    const ok = await uploadParts(h, C.doctor.cookie, patient, [
      filePart("big.png", "image/png", pngBytes(ATTACHMENT_MAX_BYTES)),
    ]);
    expect(ok.statusCode).toBe(201);
    const before = store.stored.size;
    const res = await uploadParts(h, C.doctor.cookie, patient, [
      filePart("big.png", "image/png", pngBytes(ATTACHMENT_MAX_BYTES + 1)),
    ]);
    expect(res.statusCode).toBe(413);
    expect(code(res)).toBe("attachment_too_large");
    expect(store.stored.size).toBe(before);
  });

  it("NEGATIVE: a type outside the list, or a PNG renamed .pdf, is attachment_type", async () => {
    const before = store.stored.size;
    for (const part of [
      filePart("page.html", "text/html", Buffer.from("<html></html>")),
      filePart("scan.pdf", "application/pdf", pngBytes(256)),
      filePart("empty.png", "image/png", Buffer.alloc(0)),
    ]) {
      const res = await uploadParts(h, C.doctor.cookie, patient, [part]);
      expect(res.statusCode).toBe(415);
      expect(code(res)).toBe("attachment_type");
    }
    expect(store.stored.size).toBe(before);
  });

  it("NEGATIVE: two files, an extra field, an unknown part, no file or a JSON body are validation (R2-7)", async () => {
    const png = filePart("a.png", "image/png", pngBytes(64));
    const before = await rowCount();
    for (const parts of [
      [png, filePart("b.png", "image/png", pngBytes(64))],
      [{ name: "visitId", value: visit }, { name: "note", value: "x" }, png],
      [{ name: "photo", filename: "a.png", type: "image/png", bytes: pngBytes(64) }],
      [{ name: "visitId", value: "not-an-id" }, png],
      [{ name: "visitId", value: visit }],
    ]) {
      const res = await uploadParts(h, C.doctor.cookie, patient, parts);
      expect(res.statusCode, JSON.stringify(parts.map((p) => p.name))).toBe(400);
      expect(code(res)).toBe("validation");
    }
    const json = await send(h, C.doctor.cookie, "POST", `/v1/patients/${patient}/attachments`, {});
    expect(code(json)).toBe("validation");
    expect(await rowCount()).toBe(before);
  });

  it("NEGATIVE: any other route still refuses a multipart body, before its handler runs", async () => {
    // Sign reads no body: had the multipart parser reached it, the empty draft would be visit_empty.
    const res = await postMultipart(h, C.doctor.cookie, `/v1/visits/${visit}/sign`, [
      { name: "x", value: "y" },
    ]);
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe("validation");
  });
});
