import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  as,
  CLINIC_QUERY,
  clinicIdAt,
  getState,
  resetMockData,
  seedActivity,
} from "./audit-test-kit";

describe("clinic audit log", () => {
  beforeEach(() => resetMockData());

  it("rejects a persona without view:audit_log", async () => {
    await expect(api.audit.clinicList(as("doctor"), CLINIC_QUERY)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(api.audit.clinicList(as("platform_admin"), CLINIC_QUERY)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("authorizes before validating the query", async () => {
    await expect(
      api.audit.clinicList(as("doctor"), { ...CLINIC_QUERY, limit: 0 }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      api.audit.clinicList(as("clinic_admin"), { ...CLINIC_QUERY, limit: 0 }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("returns only the caller's clinic, newest first", async () => {
    await seedActivity();
    const a = await api.audit.clinicList(as("clinic_admin"), CLINIC_QUERY);
    const b = await api.audit.clinicList(as("clinic_admin", 1), CLINIC_QUERY);
    const aIds = new Set(
      getState()
        .clinicAudit.filter((e) => e.clinicId === clinicIdAt(0))
        .map((e) => e.id),
    );
    expect(a.items.length).toBe(aIds.size);
    expect(a.items.every((e) => aIds.has(e.id))).toBe(true);
    expect(b.items.some((e) => aIds.has(e.id))).toBe(false);
    expect(b.items).toHaveLength(1);
    const times = a.items.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("filters by entity, category, action and actor", async () => {
    await seedActivity();
    const admin = as("clinic_admin");
    const patients = await api.audit.clinicList(admin, { ...CLINIC_QUERY, entity: "patient" });
    expect(patients.items.map((e) => e.action).sort()).toEqual([
      "patient.created",
      "patient.opened",
    ]);
    const access = await api.audit.clinicList(admin, {
      ...CLINIC_QUERY,
      category: "patient_access",
    });
    expect(access.items.every((e) => e.category === "patient_access")).toBe(true);
    const opened = await api.audit.clinicList(admin, { ...CLINIC_QUERY, action: "patient.opened" });
    expect(opened.items).toHaveLength(1);
    const nobody = await api.audit.clinicList(admin, { ...CLINIC_QUERY, actor: "zzz" });
    expect(nobody.items).toHaveLength(0);
    const noura = await api.audit.clinicList(admin, { ...CLINIC_QUERY, actor: "noura" });
    expect(noura.items.length).toBe(patients.items.length + 1);
  });

  it("interprets date bounds in the clinic time zone", async () => {
    await seedActivity();
    const db = getState();
    const clinic = db.clinics[0];
    const entry = db.clinicAudit.find((e) => e.clinicId === clinicIdAt(0));
    if (!clinic || !entry) throw new Error("setup");
    // 22:30 UTC on Jan 1 is already Jan 2 in Kuwait (UTC+3).
    clinic.timezone = "Asia/Kuwait";
    for (const e of db.clinicAudit) e.createdAt = "2025-06-01T10:00:00.000Z";
    entry.createdAt = "2026-01-01T22:30:00.000Z";
    const admin = as("clinic_admin");
    const jan2 = await api.audit.clinicList(admin, {
      ...CLINIC_QUERY,
      from: "2026-01-02",
      to: "2026-01-02",
    });
    expect(jan2.items.map((e) => e.id)).toEqual([entry.id]);
    const jan1 = await api.audit.clinicList(admin, {
      ...CLINIC_QUERY,
      from: "2026-01-01",
      to: "2026-01-01",
    });
    expect(jan1.items).toHaveLength(0);
    clinic.timezone = "UTC";
    const utc = await api.audit.clinicList(admin, {
      ...CLINIC_QUERY,
      from: "2026-01-01",
      to: "2026-01-01",
    });
    expect(utc.items.map((e) => e.id)).toEqual([entry.id]);
  });

  it("pages with a stable cursor and no repeats", async () => {
    await seedActivity();
    const db = getState();
    // Identical timestamps force the id tie-breaker.
    for (const e of db.clinicAudit) e.createdAt = "2026-01-01T10:00:00.000Z";
    const admin = as("clinic_admin");
    const all = await api.audit.clinicList(admin, CLINIC_QUERY);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await api.audit.clinicList(admin, { ...CLINIC_QUERY, limit: 1, cursor });
      seen.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.items.map((e) => e.id));
    const again = await api.audit.clinicList(admin, CLINIC_QUERY);
    expect(again.items.map((e) => e.id)).toEqual(seen);
  });

  it("never returns a civil ID", async () => {
    const { civilId } = await seedActivity();
    const list = await api.audit.clinicList(as("clinic_admin"), CLINIC_QUERY);
    const text = JSON.stringify(list);
    expect(text).not.toContain("civilId");
    expect(text).not.toContain(civilId);
  });
  it("shows role and branch references by name, not as ids", async () => {
    const db = getState();
    const clinicId = clinicIdAt(0);
    const member = db.members.find((m) => m.clinicId === clinicId && !m.allBranches);
    const role = db.roles.find((r) => r.clinicId === clinicId && r.id === member?.roleId);
    if (!member || !role) throw new Error("seed");
    db.clinicAudit.push({
      id: crypto.randomUUID(),
      clinicId,
      createdAt: new Date().toISOString(),
      actorName: "Tester",
      action: "user.role_changed",
      entity: "user",
      category: "administrative",
      entityId: member.id,
      before: null,
      after: { roleId: role.id, branchIds: member.branchIds },
    });
    const list = await api.audit.clinicList(as("clinic_admin"), CLINIC_QUERY);
    const entry = list.items.find((e) => e.action === "user.role_changed");
    expect(entry?.after?.["roleId"]).toEqual({ nameAr: role.nameAr, nameEn: role.nameEn });
    const branches = entry?.after?.["branchIds"] as { nameEn: string }[];
    expect(branches.every((b) => typeof b.nameEn === "string")).toBe(true);
    expect(JSON.stringify(entry?.after)).not.toContain(role.id);
  });
});
