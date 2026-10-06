import { Controller, Get } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.ts";
import { DATABASE } from "../../../shared/database.provider.ts";
import { ApiError } from "../../../shared/errors.ts";
import { AuthorizationCache } from "../access/authorization-cache.ts";
import { ClinicContextResolver } from "../access/clinic-context.ts";
import { closeHarness, openHarness, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { PgMemberAccessReader } from "../persistence/pg-member-access-reader.ts";
import { clinicWithMembers, get } from "./access-fixtures.ts";

// The versioned cache and its failure modes (ADR-0009), against real PostgreSQL + Redis.
let h: Harness;
let redis: Redis;
let cache: AuthorizationCache;
let M: Awaited<ReturnType<typeof clinicWithMembers>>;
let other: Awaited<ReturnType<typeof clinicWithMembers>>;

const quiet = { warn: () => undefined };
const clock = { now: () => new Date() };

beforeAll(async () => {
  h = await openHarness({}, true);
  redis = new Redis(process.env["EYADEX_TEST_REDIS_URL"]!);
  cache = new AuthorizationCache(redis);
  M = await clinicWithMembers(h);
  other = await clinicWithMembers(h);
});

afterAll(async () => {
  redis?.disconnect();
  await closeHarness(h);
});

describe("versioned cache", () => {
  it("a cached entry is used, and NEVER again after a version bump", async () => {
    // Warm the entry, then forge it in place: a stale grant the database does not hold.
    expect((await get(h, "/v1/roles", M.doctor.cookie)).statusCode).toBe(403);
    const version = await cache.version(M.doctor.clinicId);
    const entry = await cache.member(M.doctor.clinicId, version, M.doctor.userId);
    expect(entry).not.toBeNull();
    await cache.store(M.doctor.clinicId, version, {
      ...entry!,
      permissions: ["view:roles:clinic"],
    });
    // Proves the guard reads the cache (otherwise this test proves nothing below).
    expect((await get(h, "/v1/roles", M.doctor.cookie)).statusCode).toBe(200);
    await cache.clinicChanged(M.doctor.clinicId);
    expect((await get(h, "/v1/roles", M.doctor.cookie)).statusCode).toBe(403);
  });

  it("NEGATIVE (ISO-02): a user→clinic mapping pointing at another clinic resolves nothing", async () => {
    await cache.rememberClinic(M.doctor.userId, other.admin.clinicId);
    const res = await get(h, "/v1/me", M.doctor.cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("forbidden");
    await redis.del(`eyadex:authz:uc:${M.doctor.userId}`);
    expect((await get(h, "/v1/me", M.doctor.cookie)).statusCode).toBe(200);
  });
});

describe("Redis down", () => {
  const deadCache = () =>
    new AuthorizationCache(
      new Redis("redis://127.0.0.1:1", {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        lazyConnect: true,
      }).on("error", () => undefined),
    );

  it("NEGATIVE: the resolver reads the database and still refuses what the database refuses", async () => {
    const resolver = new ClinicContextResolver({
      reader: new PgMemberAccessReader(h.app.get<Database>(DATABASE)),
      cache: deadCache(),
      clock,
      logger: quiet,
    });
    const ok = await resolver.resolve(M.admin.userId);
    expect(ok.context.clinicId).toBe(M.admin.clinicId);
    await h.owner`UPDATE memberships SET status = 'deactivated' WHERE user_id = ${M.admin.userId}`;
    try {
      await expect(resolver.resolve(M.admin.userId)).rejects.toMatchObject({
        code: "account_disabled",
      });
      await h.owner`UPDATE clinics SET status = 'suspended' WHERE id = ${M.admin.clinicId}`;
      await h.owner`UPDATE memberships SET status = 'active' WHERE user_id = ${M.admin.userId}`;
      await expect(resolver.resolve(M.admin.userId)).rejects.toBeInstanceOf(ApiError);
      await expect(resolver.resolve(M.admin.userId)).rejects.toMatchObject({
        code: "subscription_blocked",
      });
    } finally {
      await h.owner`UPDATE memberships SET status = 'active' WHERE user_id = ${M.admin.userId}`;
      await h.owner`UPDATE clinics SET status = 'trial' WHERE id = ${M.admin.clinicId}`;
    }
  });

  it("NEGATIVE: an unknown user is refused with no cache", async () => {
    const resolver = new ClinicContextResolver({
      reader: new PgMemberAccessReader(h.app.get<Database>(DATABASE)),
      cache: deadCache(),
      clock,
      logger: quiet,
    });
    await expect(resolver.resolve(crypto.randomUUID())).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

@Controller("undeclared")
class UndeclaredController {
  @Get()
  get() {
    return { reachable: true };
  }
}

describe("RBAC-04 at boot", () => {
  it("NEGATIVE: an app with an undeclared route refuses to start", async () => {
    await expect(createApp({}, { controllers: [UndeclaredController] })).rejects.toThrow(
      /GET \/v1\/undeclared/,
    );
  });
});
