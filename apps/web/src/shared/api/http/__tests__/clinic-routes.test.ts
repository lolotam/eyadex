import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import {
  BRANCH,
  CLINIC,
  INVITE,
  ROLE,
  USER,
  branchDetail,
  clientWith,
  inspection,
  invitation,
  me,
  page,
  roleSummary,
  userView,
  type Call,
} from "./fetch-stub";

const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const option = { id: ROLE, nameAr: "ر", nameEn: "R", isActive: false };
const roleInput = { nameAr: "ر", nameEn: "R", permissionKeys: ["view:branches:clinic"] };
const TOKEN = "tok_abc-DEF_123";
const USAGE = { active: 2, limit: 3 };

/** Answers every wired clinic route with a valid API body. */
function answer(call: Call) {
  const path = call.url.replace(/\?.*$/, "");
  if (path === "/api/v1/me") return { body: me };
  if (path === "/api/v1/branches/usage") return { body: USAGE };
  if (path === "/api/v1/branches" && call.method === "GET") return { body: page([branchDetail]) };
  if (path.startsWith("/api/v1/branches"))
    return {
      body: branchDetail,
      status: call.method === "POST" && path === "/api/v1/branches" ? 201 : 200,
    };
  if (path === "/api/v1/users") return { body: page([userView]) };
  if (path === "/api/v1/users/role-options" || path === "/api/v1/users/branch-options")
    return { body: page([option]) };
  if (path.startsWith("/api/v1/users/")) return { body: userView };
  if (path === "/api/v1/roles" && call.method === "GET") return { body: page([roleSummary]) };
  if (path.startsWith("/api/v1/roles"))
    return {
      body: roleSummary,
      status: call.method === "POST" && path === "/api/v1/roles" ? 201 : 200,
    };
  if (path === "/api/v1/permissions/catalogue")
    return {
      body: {
        modules: [
          {
            module: null,
            permissions: [
              {
                key: "view:branches:clinic",
                action: "view",
                resource: "branches",
                scope: "clinic",
              },
            ],
          },
        ],
      },
    };
  if (path === "/api/v1/invitations" && call.method === "GET") return { body: page([invitation]) };
  if (path === "/api/v1/invitations/inspect") return { body: inspection };
  if (path === "/api/v1/invitations/accept")
    return { body: { clinicId: CLINIC, email: "new@example.test" } };
  if (path.endsWith("/link"))
    return { body: { token: TOKEN, expiresAt: "2026-02-01T00:00:00.000Z" } };
  if (path.startsWith("/api/v1/invitations")) return { body: invitation };
  return { status: 404, body: { code: "not_found", message_ar: "x", message_en: "x" } };
}

let h: ReturnType<typeof clientWith>;
beforeEach(async () => {
  h = clientWith(answer);
  await h.api.session.getContext(P);
  h.calls.length = 0;
});
const last = () => h.calls.at(-1)!;

const branchInput = { nameAr: "ف", nameEn: "B", address: "", phone: "" };
const KEYED = [
  [
    "branches.create",
    "POST",
    "/api/v1/branches",
    () => h.api.branches.create(P, branchInput, "key-b"),
    { nameAr: "ف", nameEn: "B", address: null, phone: null },
    "key-b",
  ],
  [
    "invitations.invite",
    "POST",
    "/api/v1/invitations",
    () =>
      h.api.invitations.invite(
        P,
        {
          fullName: "New Person",
          email: "new@example.test",
          roleId: ROLE,
          allBranches: true,
          branchIds: [],
        },
        "key-i",
      ),
    {
      fullName: "New Person",
      email: "new@example.test",
      roleId: ROLE,
      allBranches: true,
      branchIds: [],
    },
    "key-i",
  ],
  [
    "roles.create",
    "POST",
    "/api/v1/roles",
    () => h.api.roles.create(P, roleInput, "key-r"),
    roleInput,
    "key-r",
  ],
] as const;

const PLAIN = [
  [
    "branches.list",
    "GET",
    "/api/v1/branches?limit=10&search=x&status=active",
    () => h.api.branches.list(P, { cursor: null, limit: 10, search: " x ", status: "active" }),
    undefined,
  ],
  [
    "branches.update",
    "PATCH",
    `/api/v1/branches/${BRANCH}`,
    () => h.api.branches.update(P, BRANCH, branchInput),
    { nameAr: "ف", nameEn: "B", address: null, phone: null },
  ],
  [
    "branches.deactivate",
    "POST",
    `/api/v1/branches/${BRANCH}/deactivate`,
    () => h.api.branches.deactivate(P, BRANCH),
    {},
  ],
  [
    "branches.deactivate confirmed",
    "POST",
    `/api/v1/branches/${BRANCH}/deactivate`,
    () => h.api.branches.deactivate(P, BRANCH, { confirmStrandedMembers: true }),
    { confirmStrandedMembers: true },
  ],
  [
    "branches.reactivate",
    "POST",
    `/api/v1/branches/${BRANCH}/reactivate`,
    () => h.api.branches.reactivate(P, BRANCH),
    undefined,
  ],
  [
    "users.list",
    "GET",
    `/api/v1/users?limit=20&roleId=${ROLE}`,
    () =>
      h.api.users.list(P, {
        cursor: null,
        limit: 20,
        search: "",
        roleId: ROLE,
        branchId: null,
        status: null,
      }),
    undefined,
  ],
  [
    "users.listRoleOptions",
    "GET",
    "/api/v1/users/role-options?limit=100",
    () => h.api.users.listRoleOptions(P),
    undefined,
  ],
  [
    "users.listBranchOptions",
    "GET",
    "/api/v1/users/branch-options?limit=100",
    () => h.api.users.listBranchOptions(P),
    undefined,
  ],
  [
    "users.changeRole",
    "PATCH",
    `/api/v1/users/${USER}/role`,
    () => h.api.users.changeRole(P, USER, { roleId: ROLE }),
    { roleId: ROLE },
  ],
  [
    "users.changeBranches",
    "PATCH",
    `/api/v1/users/${USER}/branches`,
    () => h.api.users.changeBranches(P, USER, { allBranches: false, branchIds: [BRANCH] }),
    { allBranches: false, branchIds: [BRANCH] },
  ],
  [
    "users.deactivate",
    "POST",
    `/api/v1/users/${USER}/deactivate`,
    () => h.api.users.deactivate(P, USER),
    undefined,
  ],
  [
    "users.reactivate",
    "POST",
    `/api/v1/users/${USER}/reactivate`,
    () => h.api.users.reactivate(P, USER),
    undefined,
  ],
  [
    "invitations.list",
    "GET",
    "/api/v1/invitations?limit=5&status=expired",
    () => h.api.invitations.list(P, { cursor: null, limit: 5, search: "", status: "expired" }),
    undefined,
  ],
  [
    "invitations.resend",
    "POST",
    `/api/v1/invitations/${INVITE}/resend`,
    () => h.api.invitations.resend(P, INVITE),
    undefined,
  ],
  [
    "invitations.copyLink",
    "POST",
    `/api/v1/invitations/${INVITE}/link`,
    () => h.api.invitations.copyLink(P, INVITE),
    undefined,
  ],
  [
    "invitations.cancel",
    "POST",
    `/api/v1/invitations/${INVITE}/cancel`,
    () => h.api.invitations.cancel(P, INVITE),
    undefined,
  ],
  [
    "invitations.preview",
    "POST",
    "/api/v1/invitations/inspect",
    () => h.api.invitations.preview(TOKEN),
    { token: TOKEN },
  ],
  [
    "invitations.accept",
    "POST",
    "/api/v1/invitations/accept",
    () =>
      h.api.invitations.accept(TOKEN, {
        password: "pw-for-tests",
        confirmPassword: "pw-for-tests",
      }),
    { token: TOKEN, password: "pw-for-tests" },
  ],
  ["roles.list", "GET", "/api/v1/roles?limit=100", () => h.api.roles.list(P), undefined],
  [
    "roles.catalog",
    "GET",
    "/api/v1/permissions/catalogue",
    () => h.api.roles.catalog(P),
    undefined,
  ],
  [
    "roles.update",
    "PATCH",
    `/api/v1/roles/${ROLE}`,
    () => h.api.roles.update(P, ROLE, roleInput),
    roleInput,
  ],
  [
    "roles.deactivate",
    "POST",
    `/api/v1/roles/${ROLE}/deactivate`,
    () => h.api.roles.deactivate(P, ROLE),
    undefined,
  ],
  [
    "roles.reactivate",
    "POST",
    `/api/v1/roles/${ROLE}/reactivate`,
    () => h.api.roles.reactivate(P, ROLE),
    undefined,
  ],
] as const;

describe("wired clinic methods", () => {
  it.each(PLAIN)("%s → %s %s", async (_n, method, url, run, body) => {
    await run();
    expect(last()).toMatchObject({ method, url, credentials: "same-origin" });
    expect(last().body).toEqual(body);
    expect(last().headers["Idempotency-Key"]).toBeUndefined();
    expect(last().url).not.toContain(TOKEN);
  });
  it.each(KEYED)("%s sends its Idempotency-Key", async (_n, method, url, run, body, key) => {
    await run();
    expect(last()).toMatchObject({ method, url, credentials: "same-origin" });
    expect(last().body).toEqual(body);
    expect(last().headers["Idempotency-Key"]).toBe(key);
  });
  it("session.getContext maps /v1/me without role names", async () => {
    const ctx = await h.api.session.getContext(P);
    expect(last().url).toBe("/api/v1/me");
    expect(ctx.persona).toEqual({ kind: "custom", clinicId: CLINIC, memberId: USER });
    expect(ctx.features).toEqual({ patients: true, appointments: false, medical: false });
    expect(ctx.blocked).toBeNull();
    expect(ctx.expiresInDays).toBeNull();
  });

  it("maps role counts (any status) and the catalogue module", async () => {
    expect((await h.api.roles.list(P))[0]?.memberCount).toBe(3);
    expect((await h.api.roles.deactivate(P, ROLE)).memberCount).toBe(3);
    expect((await h.api.roles.catalog(P))[0]?.module).toBeNull();
  });
  it("option reads keep inactive rows, with the minimal fields", async () => {
    expect(await h.api.users.listRoleOptions(P)).toEqual([option]);
    expect(await h.api.users.listBranchOptions(P)).toEqual([option]);
  });
  it("a role write whose answer does not match the API schema is refused", async () => {
    const bad = clientWith((call) =>
      call.url.startsWith("/api/v1/me")
        ? { body: me }
        : { body: { ...roleSummary, memberCount: "3" } },
    );
    await bad.api.session.getContext(P);
    await expect(bad.api.roles.reactivate(P, ROLE)).rejects.toBeInstanceOf(Error);
  });
  it("accept opens no session: the member id stays null", async () => {
    const done = await h.api.invitations.accept(TOKEN, {
      password: "pw-for-tests",
      confirmPassword: "pw-for-tests",
    });
    expect(done.memberId).toBeNull();
  });
});
