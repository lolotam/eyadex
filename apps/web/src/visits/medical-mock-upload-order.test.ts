import { beforeEach, describe, expect, it } from "vitest";
import { ATTACHMENT_MAX_BYTES } from "@eyadex/contracts/attachments";
import type { Persona } from "@eyadex/contracts/session";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, file, getState, memberWithKeys, startDraft } from "./medical-test-kit";

// The API's upload order: `readUpload` answers attachment_too_large before the use case runs, then
// `Attachments.uploadTarget` (the file's update reach, an active file, the visit: unknown, unseen or
// another file's = attachment_patient_mismatch), and only then the type of the bytes.
beforeEach(() => resetMockData());

const BIG = ATTACHMENT_MAX_BYTES + 1;

type Upload = { persona: Persona; patientId: string; sent: File; visitId: string | null };
type Draft = Awaited<ReturnType<typeof startDraft>>;

const archived = (patientId: string) => {
  getState().patients.find((p) => p.id === patientId)!.status = "archived";
};

/** A visit of the same clinic that belongs to another file. */
function otherFilesVisit({ visit }: Draft) {
  const other = getState().patients.find(
    (p) => p.clinicId === getState().clinics[0]!.id && p.id !== visit.patientId,
  )!;
  return { patientId: other.id, visitId: visit.id };
}

describe("the mock upload answers in the API's order", () => {
  it.each<[string, (d: Draft) => Upload, string]>([
    [
      "too large to an archived file",
      (d) => {
        archived(d.visit.patientId);
        return {
          persona: doctorAt(0),
          patientId: d.visit.patientId,
          sent: file("image/png", BIG),
          visitId: null,
        };
      },
      "attachment_too_large",
    ],
    [
      "too large and of the wrong type",
      (d) => ({
        persona: doctorAt(0),
        patientId: d.visit.patientId,
        sent: file("text/plain", BIG),
        visitId: null,
      }),
      "attachment_too_large",
    ],
    [
      "too large to a file outside the update reach",
      (d) => ({
        persona: memberWithKeys(["view:patients:clinic", "update:medical:own"]),
        patientId: d.visit.patientId,
        sent: file("image/png", BIG),
        visitId: null,
      }),
      "attachment_too_large",
    ],
    [
      "too large with another file's visit",
      (d) => ({ persona: doctorAt(0), ...otherFilesVisit(d), sent: file("image/png", BIG) }),
      "attachment_too_large",
    ],
    [
      "an unknown visit",
      (d) => ({
        persona: doctorAt(0),
        patientId: d.visit.patientId,
        sent: file("image/png", 50),
        visitId: crypto.randomUUID(),
      }),
      "attachment_patient_mismatch",
    ],
    [
      "a visit the caller cannot see",
      (d) => ({
        persona: memberWithKeys(["view:patients:clinic", "update:medical:clinic"]),
        patientId: d.visit.patientId,
        sent: file("image/png", 50),
        visitId: d.visit.id,
      }),
      "attachment_patient_mismatch",
    ],
    [
      "the wrong type to an archived file",
      (d) => {
        archived(d.visit.patientId);
        return {
          persona: doctorAt(0),
          patientId: d.visit.patientId,
          sent: file("text/plain", 50),
          visitId: null,
        };
      },
      "patient_inactive",
    ],
    [
      "the wrong type with another file's visit",
      (d) => ({ persona: doctorAt(0), ...otherFilesVisit(d), sent: file("text/plain", 50) }),
      "attachment_patient_mismatch",
    ],
  ])("%s", async (_case, setup, code) => {
    const { persona, patientId, sent, visitId } = setup(await startDraft());
    await expect(
      api.medical.uploadAttachment(persona, patientId, sent, visitId),
    ).rejects.toMatchObject({ code });
    expect(getState().medical.attachments).toEqual([]);
  });
});
