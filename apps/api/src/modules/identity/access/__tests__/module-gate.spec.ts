import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { ApiError } from "../../../../shared/errors.ts";
import { effectivePermissions, type MemberAccess } from "../../domain/member-access.ts";
import type { AreaAuth } from "../../auth/area-auth.ts";
import { AccessGuard } from "../access.guard.ts";
import { Require, RequiresFeature } from "../access-rules.ts";
import type { ClinicContextResolver, ClinicRequestContext } from "../clinic-context.ts";
import { missingFeature } from "../route-access-check.ts";

// FLAG-01 at the guard (ADR-0010): the module gate and the catalogue-module defence in depth.
class Routes {
  @Require("view:patients:branch")
  @RequiresFeature("patients")
  gated() {}
  @Require("view:patients:branch")
  forgot() {}
  @Require("view:roles:clinic")
  core() {}
}

const areaAuth = {
  hosts: { resolve: () => "clinic" },
  of: () => ({ getSession: async () => ({ user: { id: "u" }, session: {} }) }),
} as unknown as AreaAuth;

const guardWith = (context: Partial<ClinicRequestContext>) =>
  new AccessGuard(areaAuth, {
    resolve: async () => ({
      context: { branchScope: { all: true }, enabledModules: [], permissions: [], ...context },
      member: {},
    }),
  } as unknown as ClinicContextResolver);

const run = (guard: AccessGuard, name: keyof Routes) =>
  guard.canActivate({
    getHandler: () => Routes.prototype[name],
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  } as unknown as ExecutionContext);

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "passed";
  } catch (error) {
    return error instanceof ApiError ? error.code : String(error);
  }
};

describe("module gate", () => {
  const keys = ["view:patients:branch", "view:roles:clinic"];

  it("NEGATIVE: a locked module → module_disabled before the permission check", async () => {
    expect(await codeOf(run(guardWith({ permissions: keys }), "gated"))).toBe("module_disabled");
  });

  it("an enabled module passes", async () => {
    const guard = guardWith({ permissions: keys, enabledModules: ["patients"] });
    expect(await codeOf(run(guard, "gated"))).toBe("passed");
  });

  it("NEGATIVE: a locked module's key is not granted even without @RequiresFeature", async () => {
    // The context still lists the key here, so only the catalogue-module check can refuse.
    expect(await codeOf(run(guardWith({ permissions: keys }), "forgot"))).toBe("forbidden");
    expect(await codeOf(run(guardWith({ permissions: keys }), "core"))).toBe("passed");
  });
});

describe("route walk: a module key needs @RequiresFeature", () => {
  it("NEGATIVE: flags the route that forgot it", () => {
    const rule = { kind: "require", permission: "view:patients:branch" } as const;
    expect(missingFeature({ route: "GET /x", rules: [rule], feature: null })).toBe("patients");
    expect(missingFeature({ route: "GET /x", rules: [rule], feature: "patients" })).toBeNull();
    const core = { kind: "require", permission: "view:roles:clinic" } as const;
    expect(missingFeature({ route: "GET /y", rules: [core], feature: null })).toBeNull();
  });
});

describe("effectivePermissions (FLAG-01/02)", () => {
  const member = (enabledModules: "patients"[]) =>
    ({
      role: { isActive: true },
      permissions: ["update:patients:branch", "view:patients:branch", "view:roles:clinic"],
      clinic: { enabledModules },
    }) as unknown as MemberAccess;

  it("drops a locked module's keys and gives them back when re-enabled", () => {
    expect(effectivePermissions(member([]))).toEqual(["view:roles:clinic"]);
    expect(effectivePermissions(member(["patients"]))).toEqual(member(["patients"]).permissions);
  });
});
