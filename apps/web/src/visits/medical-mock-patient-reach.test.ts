import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import {
  api,
  doctorAt,
  doctorMember,
  file,
  getState,
  memberWithKeys,
  startDraft,
} from "./medical-test-kit";

// Owner decision 2026-10-11 (Codex 4241606173), as the API's medical-patient-reach.db.spec.ts: medical
// content stays inside the caller's patients view reach (the rule of GET /patients/:id). Outside it a
// read or write naming the patient is not_found and a visit comes without its content; the walk-in
// stays outside the check; with the patients module off nothing is reachable.
let second: ReturnType<typeof doctorMember>;
beforeEach(() => {
  resetMockData();
  second = doctorMember(1);
});

const NOTE = { complaint: null, examination: null, assessment: "Reach check", plan: null };
const PROFILE = {
  allergies: "Penicillin",
  chronicConditions: null,
  currentMedications: null,
  surgicalHistory: null,
  familyHistory: null,
};

/** The first doctor's draft with a note and an attachment, and the file's registration branch. */
async function filedVisit() {
  const { visit } = await startDraft();
  await api.medical.saveNote(doctorAt(0), visit.id, NOTE);
  const sent = file("image/png", 100, "scan.png");
  const { attachment } = await api.medical.uploadAttachment(
    doctorAt(0),
    visit.patientId,
    sent,
    null,
  );
  const fileBranch = getState().patients.find(
    (p) => p.id === visit.patientId,
  )!.registrationBranchId;
  return { visit, attachmentId: attachment.id, fileBranch };
}

/**
 * The second doctor, moved to a role holding `keys` plus a patients view key: `clinic` (inside) or
 * `branch` on every branch but the file's (outside).
 */
function reader(keys: string[], reach: "inside" | "outside", fileBranch: string): Persona {
  const db = getState();
  const base = db.roles.find((r) => r.id === second.roleId)!;
  const permissions = [...keys, `view:patients:${reach === "inside" ? "clinic" : "branch"}`];
  const role = { ...base, id: crypto.randomUUID(), systemKey: null, permissions };
  db.roles.push(role);
  second.roleId = role.id;
  second.allBranches = false;
  second.branchIds = db.branches
    .filter((b) => b.clinicId === second.clinicId && b.id !== fileBranch)
    .map((b) => b.id);
  return { kind: "custom", clinicId: second.clinicId, memberId: second.id };
}

type Seed = Awaited<ReturnType<typeof filedVisit>>;
const READS: [string, (p: Persona, s: Seed) => Promise<unknown>][] = [
  ["medical profile", (p, s) => api.medical.getMedicalProfile(p, s.visit.patientId)],
  ["attachments list", (p, s) => api.medical.listAttachments(p, s.visit.patientId, {})],
  ["attachment download", (p, s) => api.medical.downloadAttachment(p, s.attachmentId)],
  ["note search", (p, s) => api.medical.searchVisits(p, s.visit.patientId, { q: "Reach" })],
  ["prescription print", (p, s) => api.medical.getPrescriptionPrint(p, s.visit.id)],
];
const READ_KEYS = ["view:medical:clinic", "view:visits:clinic"];

describe("reads naming a patient", () => {
  it.each(READS)("%s: outside the patients reach is not_found", async (_n, read) => {
    const seed = await filedVisit();
    const outside = reader(READ_KEYS, "outside", seed.fileBranch);
    await expect(read(outside, seed)).rejects.toMatchObject({ code: "not_found" });
  });

  it.each(READS)("%s: inside the patients reach answers", async (_n, read) => {
    const seed = await filedVisit();
    await expect(read(reader(READ_KEYS, "inside", seed.fileBranch), seed)).resolves.toBeTruthy();
  });

  it("the visit page and list: the visit stays, its content and previews only inside", async () => {
    const seed = await filedVisit();
    const seen = async (reach: "inside" | "outside") => {
      const P = reader(READ_KEYS, reach, seed.fileBranch);
      const page = await api.medical.getVisit(P, seed.visit.id);
      const list = await api.medical.listVisits(P, seed.visit.patientId, {});
      const preview = list.items.find((v) => v.id === seed.visit.id)?.preview ?? null;
      return [page.content?.note.assessment ?? null, preview, list.can.search];
    };
    expect(await seen("inside")).toEqual(["Reach check", "Reach check", true]);
    expect(await seen("outside")).toEqual([null, null, false]);
  });
});

describe("writes naming a patient", () => {
  it.each([
    [
      "medical profile save",
      (p: Persona, s: Seed) => api.medical.saveMedicalProfile(p, s.visit.patientId, PROFILE),
    ],
    [
      "attachment upload",
      (p: Persona, s: Seed) =>
        api.medical.uploadAttachment(p, s.visit.patientId, file("image/png", 100), null),
    ],
    [
      "attachment archive",
      (p: Persona, s: Seed) => api.medical.archiveAttachment(p, s.attachmentId),
    ],
  ])("%s: outside the patients reach is not_found", async (_n, write) => {
    const seed = await filedVisit();
    const outside = reader(["update:medical:clinic"], "outside", seed.fileBranch);
    await expect(write(outside, seed)).rejects.toMatchObject({ code: "not_found" });
    const inside = reader(["update:medical:clinic"], "inside", seed.fileBranch);
    await expect(write(inside, seed)).resolves.toBeTruthy();
  });
});

describe("the provider without a patients key", () => {
  it("starts a walk-in (outside the check) but reads no content and writes no note", async () => {
    const member = second;
    const P = memberWithKeys([
      "view:visits:own",
      "create:visits:own",
      "view:medical:own",
      "update:medical:own",
    ]);
    member.allBranches = true;
    const db = getState();
    const fileId = db.patients.find(
      (p) => p.clinicId === member.clinicId && p.status === "active",
    )!;
    const started = await api.medical.startVisit(
      P,
      { patientId: fileId.id, branchId: fileId.registrationBranchId },
      crypto.randomUUID(),
    );
    expect(started.content).toBeNull();
    // As the API (Codex 4241757308): no button the writes would answer not_found to.
    const none = { edit: false, sign: false, cancel: false, addAddendum: false, attach: false };
    expect(started.can).toEqual(none);
    await expect(api.medical.saveNote(P, started.visit.id, NOTE)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("the patients module off (owner 2026-10-11: medical requires it)", () => {
  it("the default doctor reaches no medical content of its own patient", async () => {
    const { visit } = await startDraft();
    await expect(api.medical.getMedicalProfile(doctorAt(0), visit.patientId)).resolves.toBeTruthy();
    getState().features[getState().clinics[0]!.id]!.patients = false;
    await expect(api.medical.getMedicalProfile(doctorAt(0), visit.patientId)).rejects.toMatchObject(
      {
        code: "not_found",
      },
    );
  });
});
