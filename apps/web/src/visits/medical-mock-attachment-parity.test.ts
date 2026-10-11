import { beforeEach, describe, expect, it } from "vitest";
import { ATTACHMENT_MAX_BYTES } from "@eyadex/contracts/attachments";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, doctorMember, file, getState, startDraft } from "./medical-test-kit";

// Parity sweep: the attachments and the profile answer as the API's (attachments.ts,
// attachment-rules.ts, attachment-upload.ts, medical-profile.ts).
beforeEach(() => resetMockData());

const D = () => doctorAt(0);
const reject = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

describe("an uploaded file's name, as the API's attachmentName", () => {
  it.each([
    ["trimmed", "  scan.png  ", "scan.png"],
    ["no path", "C:\\scans\\left/scan.png", "scan.png"],
    ["no direction marks", "scan\u202egnp.png", "scangnp.png"],
    ["255 characters kept", `${"a".repeat(251)}.png`, `${"a".repeat(251)}.png`],
    ["at most 255 characters", "b".repeat(300), "b".repeat(255)],
    ["never empty", "   ", "attachment"],
  ])("%s", async (_case, name, stored) => {
    const { visit } = await startDraft();
    const sent = file("image/png", 100, name);
    const { attachment } = await api.medical.uploadAttachment(D(), visit.patientId, sent, null);
    expect(attachment.name).toBe(stored);
  });
});

describe("the upload's checks, in the API's order", () => {
  it("a malformed visit id is validation, before the file's status", async () => {
    const { visit } = await startDraft();
    getState().patients.find((p) => p.id === visit.patientId)!.status = "archived";
    const sent = file("image/png", 100);
    await reject(api.medical.uploadAttachment(D(), visit.patientId, sent, "abc"), "validation");
  });

  it("a malformed patient id is not_found, before an oversized file", async () => {
    const big = file("image/png", ATTACHMENT_MAX_BYTES + 1);
    await reject(api.medical.uploadAttachment(D(), "abc", big, null), "not_found");
  });
});

describe("the order of attachments, as the API's created_at DESC, id DESC", () => {
  it("the list breaks a tie of upload times by the higher id", async () => {
    const { visit } = await startDraft();
    for (const name of ["a.png", "b.png", "c.png"]) {
      await api.medical.uploadAttachment(D(), visit.patientId, file("image/png", 100, name), null);
    }
    for (const row of getState().medical.attachments) row.uploadedAt = "2026-01-01T00:00:00.000Z";
    const { items } = await api.medical.listAttachments(D(), visit.patientId, {});
    const ids = items.map((i) => i.id);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it("the visit page shows its newest attachment first", async () => {
    const { visit } = await startDraft();
    for (const name of ["first.png", "second.png"]) {
      await api.medical.uploadAttachment(
        D(),
        visit.patientId,
        file("image/png", 100, name),
        visit.id,
      );
    }
    const [older, newer] = getState().medical.attachments.filter((x) => x.visitId === visit.id);
    older!.uploadedAt = "2026-01-01T00:00:00.000Z";
    newer!.uploadedAt = "2026-01-02T00:00:00.000Z";
    const detail = await api.medical.getVisit(D(), visit.id);
    expect(detail.content!.attachments.map((x) => x.name)).toEqual(["second.png", "first.png"]);
  });
});

describe("names are read when shown, as the API's member lookup", () => {
  it("a renamed uploader and profile author show their current name", async () => {
    const { visit } = await startDraft();
    const sent = file("image/png", 100, "scan.png");
    await api.medical.uploadAttachment(D(), visit.patientId, sent, null);
    const profile = {
      allergies: "Penicillin",
      chronicConditions: null,
      currentMedications: null,
      surgicalHistory: null,
      familyHistory: null,
    };
    await api.medical.saveMedicalProfile(D(), visit.patientId, profile);
    doctorMember(0).fullName = "Renamed Doctor";
    const list = await api.medical.listAttachments(D(), visit.patientId, {});
    const opened = await api.medical.getMedicalProfile(D(), visit.patientId);
    expect([list.items[0]!.uploadedByName, opened.updatedByName]).toEqual([
      "Renamed Doctor",
      "Renamed Doctor",
    ]);
  });
});
