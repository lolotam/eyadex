import { PASSWORD_LIMITS } from "@eyadex/auth";
import { ACCEPT_PASSWORD_LIMITS } from "@eyadex/contracts/invitation-acceptance";
import { RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ModulesContainer } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeHarness, openHarness, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { PublicRateLimitGuard } from "../auth/public-rate-limit.guard.ts";
import { PUBLIC_V1_ROUTES } from "../auth/public-rate-limits.ts";
import { accessRulesOf } from "../access/access-rules.ts";

// Completeness: every @Public() /v1 POST, and every public GET but the health check, is listed with a
// limit and guarded by the limiter.
let h: Harness;

beforeAll(async () => {
  h = await openHarness({}, true);
});

afterAll(async () => {
  await closeHarness(h);
});

const join = (...parts: string[]) =>
  `/${parts
    .flatMap((p) => p.split("/"))
    .filter((p) => p !== "")
    .join("/")}`;

describe("sessionless /v1 routes", () => {
  it("every one has a limit and the limiter guard", () => {
    const found: string[] = [];
    for (const module of h.app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const type = wrapper.metatype as (new (...args: never[]) => unknown) | null;
        if (type === null) continue;
        const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, type) ?? [];
        for (const name of Object.getOwnPropertyNames(type.prototype)) {
          const handler = (type.prototype as Record<string, unknown>)[name];
          if (typeof handler !== "function" || name === "constructor") continue;
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
          if (method !== RequestMethod.POST && method !== RequestMethod.GET) continue;
          const guards = [...classGuards, ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])];
          if (accessRulesOf(handler)[0]?.kind !== "public") continue;
          const path = join(
            "v1",
            Reflect.getMetadata(PATH_METADATA, type),
            Reflect.getMetadata(PATH_METADATA, handler),
          );
          // The health check, and the auth specs' session probe the harness mounts (SessionGuard).
          if (method === RequestMethod.GET && ["/v1/health", "/v1/probe"].includes(path)) continue;
          const verb = method === RequestMethod.GET ? "GET" : "POST";
          found.push(`${verb} ${path}`);
          expect(PUBLIC_V1_ROUTES[`${verb} ${path}`], path).toBeDefined();
          expect(guards, path).toContain(PublicRateLimitGuard);
        }
      }
    }
    expect(found.sort()).toEqual([
      "GET /v1/hooks/meta",
      "GET /v1/public/invoices/:token",
      "POST /v1/hooks/evolution",
      "POST /v1/hooks/meta",
      "POST /v1/invitations/accept",
      "POST /v1/invitations/inspect",
      "POST /v1/platform/invitations/accept",
      "POST /v1/platform/invitations/inspect",
    ]);
  });

  it("the contract's password bounds are Better Auth's", () => {
    expect(ACCEPT_PASSWORD_LIMITS).toEqual(PASSWORD_LIMITS);
  });
});
