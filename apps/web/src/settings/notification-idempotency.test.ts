import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { MAIL_TEST_REPORT_MS } from "@/shared/api/mock/mock-notifications";

const provider = {
  kind: "resend" as const,
  apiKey: "fixture-only",
  fromName: "Clinic fixture",
  fromEmail: "desk@example.invalid",
};
const admin = () => as("clinic_admin");

function secondAdmin(): Persona {
  const db = getState();
  const clinicId = clinicIdAt(0);
  const role = db.roles.find((r) => r.clinicId === clinicId && r.systemKey === "clinic_admin")!;
  const member = db.members.find(
    (m) => m.clinicId === clinicId && m.status === "active" && m.roleId !== role.id,
  )!;
  member.roleId = role.id;
  member.allBranches = true;
  return { kind: "clinic_admin", clinicId, memberId: member.id };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetMockData();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("notification provider idempotency parity", () => {
  it("the same key independently saves the primary and fallback", async () => {
    await api.notifications.setMailProvider(admin(), "primary", provider, "shared-key");
    await expect(
      api.notifications.setMailProvider(admin(), "fallback", provider, "shared-key"),
    ).resolves.toMatchObject({ fromName: provider.fromName });
  });

  it("a save replays its original response after verification and replacement", async () => {
    const original = await api.notifications.setMailProvider(admin(), "primary", provider, "save");
    await api.notifications.testMailProvider(admin(), "primary", "test");
    vi.advanceTimersByTime(MAIL_TEST_REPORT_MS);
    expect((await api.notifications.mailProviders(admin())).primary?.verifiedAt).not.toBeNull();
    expect(await api.notifications.setMailProvider(admin(), "primary", provider, "save")).toEqual(
      original,
    );
    const replacement = { ...provider, fromName: "Replacement fixture" };
    await api.notifications.setMailProvider(admin(), "primary", replacement, "replacement");
    const auditCount = getState().clinicAudit.length;
    expect(await api.notifications.setMailProvider(admin(), "primary", provider, "save")).toEqual(
      original,
    );
    expect((await api.notifications.mailProviders(admin())).primary?.fromName).toBe(
      replacement.fromName,
    );
    expect(getState().clinicAudit).toHaveLength(auditCount);
  });

  it("a save replay after removal does not recreate a provider", async () => {
    const original = await api.notifications.setMailProvider(admin(), "primary", provider, "save");
    await api.notifications.removeMailProvider(admin(), "primary");
    const auditCount = getState().clinicAudit.length;
    expect(await api.notifications.setMailProvider(admin(), "primary", provider, "save")).toEqual(
      original,
    );
    expect((await api.notifications.mailProviders(admin())).primary).toBeNull();
    expect(getState().clinicAudit).toHaveLength(auditCount);
  });

  it("a changed save body under the same actor, slot and key conflicts", async () => {
    await api.notifications.setMailProvider(admin(), "primary", provider, "save");
    await expect(
      api.notifications.setMailProvider(
        admin(),
        "primary",
        { ...provider, fromName: "Changed fixture" },
        "save",
      ),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("different actors do not share save keys", async () => {
    await api.notifications.setMailProvider(admin(), "primary", provider, "save");
    await expect(
      api.notifications.setMailProvider(
        secondAdmin(),
        "primary",
        { ...provider, fromName: "Second admin" },
        "save",
      ),
    ).resolves.toMatchObject({ fromName: "Second admin" });
  });

  it("save and test have independent scopes; a test replay queues no second report", async () => {
    await api.notifications.setMailProvider(admin(), "primary", provider, "shared-key");
    await api.notifications.testMailProvider(admin(), "primary", "shared-key");
    const auditCount = getState().clinicAudit.length;
    const timerCount = vi.getTimerCount();
    await expect(
      api.notifications.testMailProvider(admin(), "primary", "shared-key"),
    ).resolves.toBeUndefined();
    expect(getState().clinicAudit).toHaveLength(auditCount);
    expect(vi.getTimerCount()).toBe(timerCount);
    await api.notifications.removeMailProvider(admin(), "primary");
    await expect(
      api.notifications.testMailProvider(admin(), "primary", "shared-key"),
    ).resolves.toBeUndefined();
  });

  it("different actors do not replay another actor's accepted test", async () => {
    await api.notifications.setMailProvider(admin(), "primary", provider, "save");
    await api.notifications.testMailProvider(admin(), "primary", "test");
    await expect(
      api.notifications.testMailProvider(secondAdmin(), "primary", "test"),
    ).rejects.toMatchObject({ code: "rate_limited", details: { retryAfterSeconds: 60 } });
  });

  it("a test key on the fallback cannot replay a primary test", async () => {
    await api.notifications.setMailProvider(admin(), "primary", provider, "primary");
    await api.notifications.setMailProvider(admin(), "fallback", provider, "fallback");
    await api.notifications.testMailProvider(admin(), "primary", "test");
    await expect(
      api.notifications.testMailProvider(admin(), "fallback", "test"),
    ).rejects.toMatchObject({
      code: "rate_limited",
      details: { retryAfterSeconds: 60 },
    });
    vi.advanceTimersByTime(60_000);
    await api.notifications.testMailProvider(admin(), "fallback", "test");
    expect(
      getState().clinicAudit.filter((row) => row.action === "clinic.mail_provider_test_requested"),
    ).toHaveLength(2);
  });

  it.each(["", " ", "with space", "line\nbreak", "é", "a".repeat(201)])(
    "save rejects an invalid Idempotency-Key (%j)",
    async (key) => {
      await api.notifications.setMailProvider(admin(), "primary", provider, "setup");
      const auditCount = getState().clinicAudit.length;
      await expect(
        api.notifications.setMailProvider(admin(), "primary", provider, key),
      ).rejects.toMatchObject({ code: "validation" });
      expect(getState().clinicAudit).toHaveLength(auditCount);
    },
  );

  it.each(["", " ", "with space", "line\nbreak", "é", "a".repeat(201)])(
    "test rejects an invalid Idempotency-Key (%j)",
    async (key) => {
      await api.notifications.setMailProvider(admin(), "primary", provider, "setup");
      const auditCount = getState().clinicAudit.length;
      await expect(
        api.notifications.testMailProvider(admin(), "primary", key),
      ).rejects.toMatchObject({
        code: "validation",
      });
      expect(getState().clinicAudit).toHaveLength(auditCount);
    },
  );
});
