import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  as,
  getState,
  PLATFORM,
  PLATFORM_QUERY,
  resetMockData,
  seedActivity,
} from "./audit-test-kit";

describe("platform audit log", () => {
  beforeEach(() => resetMockData());

  it("is platform admin only, checked before the query", async () => {
    for (const kind of ["clinic_admin", "doctor"] as const) {
      await expect(api.audit.platformList(as(kind), PLATFORM_QUERY)).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(
        api.audit.platformList(as(kind), { ...PLATFORM_QUERY, limit: 0 }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("returns platform events and clinic administrative entries only", async () => {
    await seedActivity();
    const list = await api.audit.platformList(PLATFORM, PLATFORM_QUERY);
    const db = getState();
    const admin = db.clinicAudit.filter((e) => e.category === "administrative");
    expect(list.total).toBe(db.platformAudit.length + admin.length);
    expect(list.items.every((e) => e.category === "administrative")).toBe(true);
    expect(list.items.some((e) => (e.entity as string) === "patient")).toBe(false);
    const patientIds = new Set(
      db.clinicAudit.filter((e) => e.entity === "patient").map((e) => e.id),
    );
    expect(patientIds.size).toBeGreaterThan(0);
    expect(list.items.some((e) => patientIds.has(e.id))).toBe(false);
  });

  it("can't be filtered into patient entries", async () => {
    await seedActivity();
    const opened = await api.audit.platformList(PLATFORM, {
      ...PLATFORM_QUERY,
      action: "patient.opened",
    });
    expect(opened.items).toHaveLength(0);
    await expect(
      api.audit.platformList(PLATFORM, {
        ...PLATFORM_QUERY,
        entity: "patient" as never,
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("carries no patient fields or values", async () => {
    const { civilId } = await seedActivity();
    const text = JSON.stringify(await api.audit.platformList(PLATFORM, PLATFORM_QUERY));
    for (const p of getState().patients) {
      expect(text).not.toContain(p.id);
      expect(text).not.toContain(p.fullName);
      expect(text).not.toContain(p.phone);
    }
    for (const field of ["civilId", "fileNumber", "birthDate", "registrationBranchId"])
      expect(text).not.toContain(field);
    expect(text).not.toContain(civilId);
  });

  it("filters by source and pages stably", async () => {
    await seedActivity();
    const clinicOnly = await api.audit.platformList(PLATFORM, {
      ...PLATFORM_QUERY,
      source: "clinic",
    });
    expect(clinicOnly.items.every((e) => e.source === "clinic")).toBe(true);
    const all = await api.audit.platformList(PLATFORM, PLATFORM_QUERY);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await api.audit.platformList(PLATFORM, { ...PLATFORM_QUERY, limit: 2, cursor });
      seen.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.items.map((e) => e.id));
  });
});
