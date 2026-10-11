import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { api, doctorAt, getState, memberWithKeys, startDraft } from "./medical-test-kit";

// The list answers the API's own write rule for the file (`Attachments.list`): the update reach covers
// it (`own` = one of the caller's patients), and for an upload the file is also active. Each role
// holds a patients key: the content stays inside the patients reach (owner 2026-10-11).
beforeEach(() => resetMockData());

describe("the attachment list carries the API's upload and archive rule", () => {
  it.each<[string, () => Persona, "active" | "archived", { upload: boolean; archive: boolean }]>([
    ["the file's own doctor", () => doctorAt(0), "active", { upload: true, archive: true }],
    [
      "update:medical:own on another's file",
      () => memberWithKeys(["view:patients:clinic", "view:medical:clinic", "update:medical:own"]),
      "active",
      { upload: false, archive: false },
    ],
    [
      "update:medical:clinic on another's file",
      () =>
        memberWithKeys(["view:patients:clinic", "view:medical:clinic", "update:medical:clinic"]),
      "active",
      { upload: true, archive: true },
    ],
    [
      "no update key",
      () => memberWithKeys(["view:patients:clinic", "view:medical:clinic"]),
      "active",
      { upload: false, archive: false },
    ],
    ["an archived file", () => doctorAt(0), "archived", { upload: false, archive: true }],
  ])("%s", async (_case, who, status, can) => {
    const { visit } = await startDraft();
    getState().patients.find((p) => p.id === visit.patientId)!.status = status;
    const list = await api.medical.listAttachments(who(), visit.patientId, {});
    expect(list.can).toEqual(can);
  });
});
