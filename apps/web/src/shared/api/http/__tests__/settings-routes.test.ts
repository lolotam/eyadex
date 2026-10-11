import { afterEach, describe, expect, it, vi } from "vitest";
import { meResponseSchema } from "@eyadex/contracts/access";
import { platformSettingsRequestSchema } from "@eyadex/contracts/platform-console";
import type { Persona } from "@eyadex/contracts/session";
import { contextFromMe } from "../http-session";
import { CLINIC, clientWith, code, me, TS, USER } from "./fetch-stub";

// ADR-0020: the five namespaces that were "coming soon" are served, each on its route and body.
const C: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const P: Persona = { kind: "platform_admin", clinicId: null, memberId: null };
const settings = {
  nameAr: "عيادة",
  nameEn: "Clinic",
  defaultLanguage: "ar",
  timezone: "Asia/Kuwait",
  slug: "c",
  specialty: "general",
};
const account = {
  fullName: "Test User",
  email: "user@example.test",
  preferredLanguage: "en",
  roleNameAr: "ر",
  roleNameEn: "R",
};
const teamMember = {
  id: USER,
  fullName: "Member",
  email: "m@example.test",
  status: "invited",
  joinedAt: null,
  createdAt: TS,
};
const platformSettings = {
  defaultTrialDays: 14,
  alertDaysBeforeExpiry: 7,
  emailSenderName: "Eyadex",
  defaultMaxUsers: 25,
  defaultMaxBranches: 5,
  defaultModules: { patients: false, appointments: false, medical: false },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clinic settings and account", () => {
  it("reads and saves the clinic settings with exactly the editable fields", async () => {
    const h = clientWith(() => ({ body: settings }));
    await h.api.clinicSettings.get(C);
    await h.api.clinicSettings.update(C, {
      nameAr: "عيادة",
      nameEn: "Clinic",
      defaultLanguage: "ar",
      timezone: "Asia/Kuwait",
    });
    expect(h.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/v1/clinic/settings",
      "PUT /api/v1/clinic/settings",
    ]);
    expect(Object.keys(h.calls[1]!.body as object).sort()).toEqual([
      "defaultLanguage",
      "nameAr",
      "nameEn",
      "timezone",
    ]);
  });

  it("saves the account, and sends a password change to Better Auth, never to /v1", async () => {
    const h = clientWith((call) => ({ body: call.url.startsWith("/api/auth") ? {} : account }));
    await h.api.account.update(C, { fullName: "Test User", preferredLanguage: "en" });
    await h.api.account.changePassword(C, {
      currentPassword: "old-password",
      newPassword: "new-password-1",
      confirmPassword: "new-password-1",
    });
    expect(h.calls[0]).toMatchObject({ method: "PUT", url: "/api/v1/account" });
    expect(h.calls[1]).toMatchObject({ method: "POST", url: "/api/auth/change-password" });
    // The confirmation never leaves the form; the other sessions end.
    expect(h.calls[1]!.body).toEqual({
      currentPassword: "old-password",
      newPassword: "new-password-1",
      revokeOtherSessions: true,
    });
  });

  it("passes the server's banner window through /v1/me", () => {
    const parsed = meResponseSchema.parse({ ...me, expiresInDays: 3 });
    expect(contextFromMe(parsed).expiresInDays).toBe(3);
  });
});

describe("platform console", () => {
  it("reads the overview and the settings, and saves the settings", async () => {
    const h = clientWith((call) =>
      call.url.endsWith("/overview")
        ? {
            body: {
              counts: { trial: 1, active: 2, suspended: 0, expired: 3 },
              alertDaysBeforeExpiry: 7,
              expiringSoon: [],
            },
          }
        : { body: platformSettings },
    );
    expect((await h.api.platformOverview.get(P)).counts.expired).toBe(3);
    await h.api.platformSettings.update(P, platformSettings);
    expect(h.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/v1/platform/overview",
      "PUT /api/v1/platform/settings",
    ]);
    // The whole strict body the API validates, new-clinic defaults included (ADR-0020 amendment).
    const body = h.calls[1]!.body;
    expect(platformSettingsRequestSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual(platformSettings);
  });

  it("refuses an overview carrying a field the contract does not name", async () => {
    const h = clientWith(() => ({
      body: {
        counts: { trial: 0, active: 0, suspended: 0, expired: 0 },
        alertDaysBeforeExpiry: 7,
        expiringSoon: [],
        patients: 12,
      },
    }));
    expect((await code(h.api.platformOverview.get(P))).code).toBe("unknown");
  });

  it("lists every team page, invites with the dialog's key, and changes a status", async () => {
    let first = true;
    const h = clientWith((call) => {
      if (call.url.startsWith("/api/v1/platform/team?")) {
        const body = { items: [teamMember], nextCursor: first ? "n1" : null, total: 2 };
        first = false;
        return { body };
      }
      return { body: teamMember };
    });
    expect(await h.api.platformTeam.list(P)).toHaveLength(2);
    await h.api.platformTeam.invite(P, { fullName: "Member", email: "m@example.test" }, "k-1");
    await h.api.platformTeam.deactivate(P, USER);
    expect(h.calls[1]!.url).toContain("cursor=n1");
    expect(h.calls[2]).toMatchObject({ method: "POST", url: "/api/v1/platform/team" });
    expect(h.calls[2]!.headers["Idempotency-Key"]).toBe("k-1");
    expect(h.calls[3]).toMatchObject({ url: `/api/v1/platform/team/${USER}/deactivate` });
  });

  it("the platform host accepts a platform-team link on the platform routes", async () => {
    vi.stubGlobal("window", { location: { hostname: "platform.eyadex.com" } });
    const h = clientWith((call) =>
      call.url.endsWith("/inspect")
        ? { body: { fullName: "Member", email: "m@example.test", expiresAt: TS } }
        : { body: { email: "m@example.test" } },
    );
    const preview = await h.api.invitations.preview("tok");
    expect(preview).toMatchObject({ clinicNameEn: "Eyadex", email: "m@example.test" });
    const accepted = await h.api.invitations.accept("tok", {
      password: "a-password",
      confirmPassword: "a-password",
    });
    expect(accepted.clinicId).toBeNull();
    expect(h.calls.map((c) => c.url)).toEqual([
      "/api/v1/platform/invitations/inspect",
      "/api/v1/platform/invitations/accept",
    ]);
  });
});
