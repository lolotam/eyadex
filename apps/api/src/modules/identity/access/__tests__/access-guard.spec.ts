import type { ExecutionContext } from "@nestjs/common";
import { PERMISSION_CATALOG, PERMISSION_KEYS } from "@eyadex/contracts/permissions";
import { describe, expect, it } from "vitest";

import { decideMemberAccess, type MemberAccess } from "../../domain/member-access.ts";
import { grantFor } from "../../domain/permission-check.ts";
import { AccessDeclarationError, AccessGuard } from "../access.guard.ts";
import { Public, Require } from "../access-rules.ts";

class Routes {
  none() {}
  @Public()
  open() {}
  @Public()
  @Require("view:roles:clinic")
  twice() {}
}

const contextFor = (name: keyof Routes) =>
  ({
    getHandler: () => Routes.prototype[name],
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  }) as unknown as ExecutionContext;

describe("AccessGuard declarations (RBAC-04)", () => {
  const guard = new AccessGuard();

  it("NEGATIVE: no declaration and two declarations fail closed", async () => {
    await expect(guard.canActivate(contextFor("none"))).rejects.toBeInstanceOf(
      AccessDeclarationError,
    );
    await expect(guard.canActivate(contextFor("twice"))).rejects.toBeInstanceOf(
      AccessDeclarationError,
    );
  });

  it("a public route passes without auth mounted", async () => {
    await expect(guard.canActivate(contextFor("open"))).resolves.toBe(true);
  });

  it("NEGATIVE: Require refuses a key outside the catalogue", () => {
    expect(() => Require("create:audit_log:clinic" as never)).toThrow(/unknown permission/);
  });

  it("the typed key list equals PERMISSION_CATALOG", () => {
    expect([...PERMISSION_KEYS].sort()).toEqual(PERMISSION_CATALOG.map((p) => p.key).sort());
  });
});

describe("grantFor (never role names)", () => {
  it("exact key, and a clinic key covers a branch requirement", () => {
    expect(grantFor(["view:roles:clinic"], "view:roles:clinic")).toBe("clinic");
    expect(grantFor(["view:patients:branch"], "view:patients:branch")).toBe("branch");
    expect(grantFor(["view:patients:clinic"], "view:patients:branch")).toBe("clinic");
  });

  it("NEGATIVE: a branch key never covers a clinic requirement; other actions never count", () => {
    expect(grantFor(["view:patients:branch"], "view:patients:clinic")).toBeNull();
    expect(grantFor(["update:roles:clinic"], "view:roles:clinic")).toBeNull();
    expect(grantFor([], "view:roles:clinic")).toBeNull();
  });
});

const member = (over: Partial<MemberAccess> = {}, clinic: Partial<MemberAccess["clinic"]> = {}) =>
  ({
    status: "active",
    clinic: { status: "active", expiresAt: "2030-01-01T00:00:00.000Z", ...clinic },
    ...over,
  }) as MemberAccess;

describe("decideMemberAccess (PRD §4.7 steps 1–2)", () => {
  const now = new Date("2029-06-01T00:00:00Z");
  it("allows an active member of an allowed clinic", () => {
    expect(decideMemberAccess(member(), now)).toEqual({ allowed: true });
  });
  it("NEGATIVE: deactivated, suspended, expired (at the exact instant too)", () => {
    expect(decideMemberAccess(member({ status: "deactivated" }), now)).toMatchObject({
      code: "account_disabled",
    });
    expect(decideMemberAccess(member({}, { status: "suspended" }), now)).toMatchObject({
      reason: "suspended",
    });
    expect(
      decideMemberAccess(member({}, { expiresAt: "2029-06-01T00:00:00.000Z" }), now),
    ).toMatchObject({ reason: "expired" });
  });
});
