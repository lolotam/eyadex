import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import type { StoredVisit } from "@/shared/api/mock/mock-medical-state";
import {
  api,
  doctorAt,
  doctorMember,
  getState,
  memberWithKeys,
  startDraft,
} from "./medical-test-kit";

// Parity sweep: the visit list and the note search page as the API's `queries/visit-list.ts` (keyset
// cursor, a 500-visit search scan), and an `own` reader learns nothing of another file.
beforeEach(() => resetMockData());

const D = () => doctorAt(0);

/** `count` more visits of the draft's patient by the same doctor, a minute apart, oldest first. */
async function visitsOfOnePatient(count: number, assessment: (i: number) => string | null) {
  const { visit } = await startDraft();
  const db = getState();
  const base = db.medical.visits.find((v) => v.id === visit.id)!;
  const added: StoredVisit[] = [];
  for (let i = 0; i < count; i += 1) {
    const copy: StoredVisit = {
      ...base,
      id: crypto.randomUUID(),
      appointmentId: null,
      startedAt: new Date(Date.UTC(2020, 0, 1, 0, i)).toISOString(),
      note: { ...base.note, assessment: assessment(i) },
      diagnoses: [],
      addenda: [],
    };
    db.medical.visits.push(copy);
    added.push(copy);
  }
  return { patientId: visit.patientId, added };
}

describe("the visit list", () => {
  it("an own reader asking for a file that is not its own gets not_found", async () => {
    const { patientId } = await visitsOfOnePatient(1, () => null);
    const reader = memberWithKeys(["view:visits:own"]);
    // The reader has no appointment and no visit with this file (demo data, not an access rule).
    const db = getState();
    db.appointments = db.appointments.filter(
      (x) => !(x.patientId === patientId && x.providerMembershipId === reader.memberId),
    );
    await expect(api.medical.listVisits(reader, patientId, {})).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("pages by keyset: a visit started between two fetches never repeats an item", async () => {
    const { patientId } = await visitsOfOnePatient(25, () => null);
    const first = await api.medical.listVisits(D(), patientId, {});
    getState().medical.visits.push({
      ...getState().medical.visits.find((v) => v.patientId === patientId)!,
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    });
    const second = await api.medical.listVisits(D(), patientId, { cursor: first.nextCursor! });
    const seen = new Set(first.items.map((v) => v.id));
    expect(second.items.filter((v) => seen.has(v.id))).toEqual([]);
  });

  it.each(["abc", "!!", btoa("2026-01-01T00:00:00.000Z|not-an-id")])(
    "a malformed cursor %j is validation, not the first page",
    async (cursor) => {
      const { patientId } = await visitsOfOnePatient(1, () => null);
      await expect(api.medical.listVisits(D(), patientId, { cursor })).rejects.toMatchObject({
        code: "validation",
      });
    },
  );
});

describe("the note search", () => {
  it("scans only the patient's 500 newest visits, as the API", async () => {
    const { patientId } = await visitsOfOnePatient(501, (i) => (i === 0 ? "Oldest match" : null));
    const found = await api.medical.searchVisits(D(), patientId, { q: "Oldest match" });
    expect(found.items).toEqual([]);
  });
});

describe("the walk-in branches", () => {
  it.each(["ar", "en"] as const)(
    "are ordered by the name in the caller's language (%s)",
    async (lang) => {
      const member = doctorMember(0);
      member.allBranches = true;
      member.preferredLanguage = lang;
      const { items } = await api.medical.walkInBranches(D());
      const names = items.map((b) => (lang === "ar" ? b.nameAr : b.nameEn));
      expect(names.length).toBeGreaterThan(1);
      expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
    },
  );
});
