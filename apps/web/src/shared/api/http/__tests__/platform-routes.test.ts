import { describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import type { SubscriptionInput } from "@eyadex/contracts/clinics";
import { addCalendarMonths } from "../subscription-expiry";
import {
  CLINIC,
  branchDetail,
  clientWith,
  code,
  page,
  platformDetail,
  type Call,
  stubFetch,
} from "./fetch-stub";
import { createHttpApiClient } from "../http-adapter";

const P: Persona = { kind: "platform_admin", clinicId: null, memberId: null };
const created = {
  clinicId: CLINIC,
  slug: "test-clinic",
  invitation: { id: CLINIC, email: "admin@example.test", expiresAt: "2026-02-07T00:00:00.000Z" },
};
function answer(call: Call) {
  if (call.url === "/api/v1/platform/clinics") return { status: 201, body: created };
  if (call.url.includes("/branches")) return { body: page([branchDetail]) };
  return { body: platformDetail };
}
const input = {
  nameAr: "عيادة",
  nameEn: "Clinic",
  slug: "test-clinic",
  specialty: "general" as const,
  defaultLanguage: "ar" as const,
  timezone: "Asia/Kuwait",
  adminName: "Admin Person",
  adminEmail: "admin@example.test",
};
const base = `/api/v1/platform/clinics/${CLINIC}`;
const sub = (over: Partial<SubscriptionInput>): SubscriptionInput => ({
  status: "active",
  expiryMode: "duration",
  durationMonths: 1,
  expiresOn: "",
  maxUsers: 10,
  maxBranches: 3,
  ...over,
});

describe("wired platform methods", () => {
  it("createClinic posts the request with its Idempotency-Key; no link comes back", async () => {
    const h = clientWith(answer);
    const result = await h.api.platform.createClinic(P, input, "key-c");
    const call = h.calls[0]!;
    expect(call).toMatchObject({
      method: "POST",
      url: "/api/v1/platform/clinics",
      credentials: "same-origin",
    });
    expect(call.headers["Idempotency-Key"]).toBe("key-c");
    expect(call.body).toMatchObject({
      slug: "test-clinic",
      timezone: "Asia/Kuwait",
      status: "trial",
      admin: { fullName: "Admin Person", email: "admin@example.test" },
    });
    expect(result.firstAdminInvite.token).toBeNull();
  });
  it("a createClinic retry after midnight resends the first body under the same key", async () => {
    let failFirst = true;
    const stub = stubFetch((call) => {
      if (failFirst) {
        failFirst = false;
        return { status: 503 };
      }
      return answer(call);
    });
    const clock = [new Date("2026-01-31T23:59:00Z"), new Date("2026-02-01T00:01:00Z")];
    const api = createHttpApiClient(stub.fetchImpl, () => clock.shift() ?? new Date());
    expect(await code(api.platform.createClinic(P, input, "key-r"))).toMatchObject({
      code: "unknown",
    });
    await api.platform.createClinic(P, input, "key-r");
    expect(stub.calls[1]!.body).toEqual(stub.calls[0]!.body);
  });
  it("getClinic, listClinicBranches and setClinicFeature use their routes", async () => {
    const h = clientWith(answer);
    const detail = await h.api.platform.getClinic(P, CLINIC);
    expect(detail).toMatchObject({ maxUsers: 10, usersCount: 2, features: { patients: true } });
    const branches = await h.api.platform.listClinicBranches(P, CLINIC);
    expect(branches[0]?.clinicId).toBe(CLINIC);
    await h.api.platform.setClinicFeature(P, CLINIC, "patients", false);
    expect(h.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${base}`,
      `GET ${base}/branches?limit=100`,
      `PUT ${base}/features/patients`,
    ]);
    expect(h.calls[2]?.body).toEqual({ enabled: false });
  });
  it("duration mode sends an explicit expiresAt, never durationDays, and no limits PATCH when unchanged", async () => {
    const h = clientWith(answer);
    await h.api.platform.updateSubscription(P, CLINIC, sub({ durationMonths: 1 }));
    const patches = h.calls.filter((c) => c.method === "PATCH");
    expect(patches.map((c) => c.url)).toEqual([`${base}/subscription`]);
    expect(patches[0]?.body).toEqual({ status: "active", expiresAt: "2026-02-28T23:59:59Z" });
    expect(JSON.stringify(patches[0]?.body)).not.toContain("durationDays");
  });
  it("date mode sends the chosen day; changed limits go in a second PATCH, changed fields only", async () => {
    const h = clientWith(answer);
    await h.api.platform.updateSubscription(
      P,
      CLINIC,
      sub({ expiryMode: "date", expiresOn: "2027-03-15", maxBranches: 5 }),
    );
    const patches = h.calls.filter((c) => c.method === "PATCH");
    expect(patches[0]?.body).toEqual({ status: "active", expiresAt: "2027-03-15T23:59:59Z" });
    expect(patches[1]).toMatchObject({ url: `${base}/limits`, body: { maxBranches: 5 } });
  });
  it("calendar months clamp to the month's last day", () => {
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("unserved methods throw not_implemented", () => {
  const h = clientWith(() => ({ body: {} }));
  const a = h.api;
  const methods: [string, () => Promise<unknown>][] = [
    [
      "platform.listClinics",
      () =>
        a.platform.listClinics(P, {
          cursor: null,
          limit: 10,
          search: "",
          status: null,
          specialty: null,
        }),
    ],
    ["platform.getFirstAdminInvitation", () => a.platform.getFirstAdminInvitation(P, CLINIC)],
    ["platform.resendFirstAdminInvitation", () => a.platform.resendFirstAdminInvitation(P, CLINIC)],
    ["platform.updateClinicDetails", () => a.platform.updateClinicDetails(P, CLINIC, input)],
    ["platform.listClinicMembers", () => a.platform.listClinicMembers(P, CLINIC)],
    ["session.listLoginClinics", () => a.session.listLoginClinics()],
    ["session.listLoginAccounts", () => a.session.listLoginAccounts(CLINIC)],
    ["session.listLoginPlatformAccounts", () => a.session.listLoginPlatformAccounts()],
    ["session.acceptPlatformInvitation", () => a.session.acceptPlatformInvitation(CLINIC)],
    ...(["create", "update", "deactivate", "reactivate"] as const).map(
      (m): [string, () => Promise<unknown>] => [
        `roles.${m}`,
        () => (a.roles[m] as (...x: unknown[]) => Promise<unknown>)(P, CLINIC, {}),
      ],
    ),
    ...(
      [
        "audit",
        "clinicSettings",
        "account",
        "platformOverview",
        "platformTeam",
        "platformSettings",
      ] as const
    ).flatMap((ns) =>
      Object.entries(a[ns]).map(([m, fn]): [string, () => Promise<unknown>] => [
        `${ns}.${m}`,
        () => (fn as (...x: unknown[]) => Promise<unknown>)(P, CLINIC, {}),
      ]),
    ),
  ];
  it.each(methods)("%s", async (_name, run) => {
    expect((await code(run())).code).toBe("not_implemented");
    expect(h.calls).toHaveLength(0);
  });
});
