import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";

import { ENROLLMENT_LOCK_PREFIX, type EyadexAuth } from "@eyadex/auth";
import { systemUuidV7 } from "@eyadex/ids";
import { createLogger } from "@eyadex/observability";
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../../app.ts";
import { API_LOG_EVENTS } from "../../../../shared/log-events.ts";
import { AREA_AUTH, type AreaAuth } from "../area-auth.ts";
import { SessionGuard, type AuthenticatedRequest } from "../session.guard.ts";
import { totpFromUri } from "./totp.ts";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set — see CI db job`);
  return value;
};
const OWNER_URL = required("EYADEX_TEST_OWNER_URL");
const AUTH_URL = required("EYADEX_TEST_AUTH_URL");

const APP = "https://app.eyadex.test";
const PLATFORM = "https://platform.eyadex.test";
const password = randomBytes(18).toString("base64url");
const email = (label: string) => `${label}-${systemUuidV7().newId()}@example.com`;

@Controller("probe")
@UseGuards(SessionGuard)
class ProbeController {
  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return { area: request.areaSession.area, userId: request.areaSession.session.user.id };
  }
}

let app: NestFastifyApplication;
let areaAuth: AreaAuth;
let owner: Sql;

type Inject = {
  method?: "GET" | "POST";
  url: string;
  host: string;
  cookie?: string;
  body?: unknown;
  origin?: string;
};
const call = (o: Inject) =>
  app.inject({
    method: o.method ?? "POST",
    url: o.url,
    headers: {
      host: new URL(o.host).host,
      origin: o.origin ?? o.host,
      "content-type": "application/json",
      ...(o.cookie === undefined ? {} : { cookie: o.cookie }),
    },
    ...(o.method === "GET" ? {} : { payload: JSON.stringify(o.body ?? {}) }),
  });
const cookiesOf = (res: { headers: Record<string, unknown> }): string[] => {
  const raw = res.headers["set-cookie"];
  return raw === undefined ? [] : Array.isArray(raw) ? (raw as string[]) : [String(raw)];
};
const jar = (lines: string[]) => lines.map((line) => line.split(";")[0]).join("; ");
const signIn = async (host: string, mail: string) => {
  const res = await call({ url: "/auth/sign-in/email", host, body: { email: mail, password } });
  expect(res.statusCode).toBe(200);
  return jar(cookiesOf(res));
};
const create = (auth: EyadexAuth, label: string) =>
  auth
    .createUserAccount({ email: email(label), name: label, password })
    .then(async ({ userId }) => {
      const [row] = await owner<
        { email: string }[]
      >`SELECT email FROM auth_users WHERE id = ${userId}`;
      return { userId, email: row!.email };
    });

beforeAll(async () => {
  Object.assign(process.env, {
    APP_URL: APP,
    PLATFORM_URL: PLATFORM,
    AUTH_DATABASE_URL: AUTH_URL,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    TRUST_PROXY_HOPS: "0",
    REDIS_URL: required("EYADEX_TEST_REDIS_URL"),
  });
  owner = postgres(OWNER_URL, { max: 2, onnotice: () => undefined });
  const sink = new Writable({ write: (_c, _e, done) => done() });
  app = await createApp(
    { mountAuth: true },
    {
      logger: createLogger("info", { destination: sink, events: API_LOG_EVENTS }),
      controllers: [ProbeController],
    },
  );
  await app.getHttpAdapter().getInstance().ready();
  areaAuth = app.get<AreaAuth>(AREA_AUTH);
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

describe("same-origin auth over HTTP (ADR-0004)", () => {
  it("clinic sign-in sets only a host-only, Secure eyadex-clinic cookie, refused on the platform host", async () => {
    const user = await create(areaAuth.of("clinic"), "clinic");
    const res = await call({
      url: "/auth/sign-in/email",
      host: APP,
      body: { email: user.email, password },
    });
    expect(res.statusCode).toBe(200);
    const lines = cookiesOf(res);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.startsWith("__Secure-eyadex-clinic.")).toBe(true);
      expect(line).toMatch(/;\s*Secure/i);
      expect(line).not.toMatch(/;\s*Domain=/i);
    }
    const cookie = jar(lines);
    expect(
      (await call({ method: "GET", url: "/v1/probe", host: APP, cookie })).json(),
    ).toMatchObject({ area: "clinic", userId: user.userId });
    const cross = await call({ method: "GET", url: "/v1/probe", host: PLATFORM, cookie });
    expect(cross.statusCode).toBe(401);
    expect(cross.json()).toMatchObject({ code: "unauthorized" });
    // Same secret, same table: the clinic cookie renamed to the platform name still verifies in Better
    // Auth — only the area-bound lookup (ADR-0003) refuses it.
    const renamed = cookie.replaceAll("__Secure-eyadex-clinic.", "__Secure-eyadex-platform.");
    const replay = await call({ method: "GET", url: "/v1/probe", host: PLATFORM, cookie: renamed });
    expect(replay.statusCode).toBe(401);
  });

  it("NEGATIVE: a clinic session renamed for the platform host is refused on /auth routes too", async () => {
    const user = await create(areaAuth.of("clinic"), "cross-auth");
    const cookie = await signIn(APP, user.email);
    const renamed = cookie.replaceAll("__Secure-eyadex-clinic.", "__Secure-eyadex-platform.");
    const change = await call({
      url: "/auth/change-password",
      host: PLATFORM,
      cookie: renamed,
      body: { currentPassword: password, newPassword: `${password}-changed` },
    });
    expect(change.statusCode).toBe(401);
    expect(change.json()).toMatchObject({ code: "unauthorized" });
    const enable = await call({
      url: "/auth/two-factor/enable",
      host: PLATFORM,
      cookie: renamed,
      body: { password },
    });
    expect(enable.statusCode).toBe(401);
    // The password is unchanged: the clinic sign-in with the original one still works.
    await signIn(APP, user.email);
  });

  it("NEGATIVE: two-factor cannot be disabled on the platform host", async () => {
    const res = await call({ url: "/auth/two-factor/disable", host: PLATFORM, body: { password } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not_found" });
  });

  it("unknown host → 404 envelope on /auth and /v1", async () => {
    const auth = await call({
      url: "/auth/sign-in/email",
      host: "https://api.eyadex.test",
      body: {},
    });
    expect(auth.statusCode).toBe(404);
    expect(auth.json()).toMatchObject({ code: "not_found" });
    expect(
      (await call({ method: "GET", url: "/v1/probe", host: "https://api.eyadex.test" })).statusCode,
    ).toBe(404);
  });

  it("a route outside the allowlist (sign-up) → 404", async () => {
    const res = await call({
      url: "/auth/sign-up/email",
      host: APP,
      body: { email: email("su"), password, name: "x" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not_found" });
  });

  it("refuses a sign-in POST whose Origin is the other area", async () => {
    const user = await create(areaAuth.of("clinic"), "csrf");
    const res = await call({
      url: "/auth/sign-in/email",
      host: APP,
      origin: PLATFORM,
      cookie: "x=1",
      body: { email: user.email, password },
    });
    expect(res.statusCode).toBe(403);
    expect(cookiesOf(res).some((line) => line.includes("session_token="))).toBe(false);
  });

  it("platform: TOTP is mandatory, then allowed after enroll + verify; sign-out ends the session", async () => {
    const user = await create(areaAuth.of("platform"), "platform");
    let cookie = await signIn(PLATFORM, user.email);
    const blocked = await call({ method: "GET", url: "/v1/probe", host: PLATFORM, cookie });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: "two_factor_required" });
    expect(
      (await call({ method: "GET", url: "/auth/get-session", host: PLATFORM, cookie })).statusCode,
    ).toBe(403);

    const enabled = await call({
      url: "/auth/two-factor/enable",
      host: PLATFORM,
      cookie,
      body: { password },
    });
    expect(enabled.statusCode).toBe(200);
    const verified = await call({
      url: "/auth/two-factor/verify-totp",
      host: PLATFORM,
      cookie,
      body: { code: totpFromUri(enabled.json().totpURI) },
    });
    expect(verified.statusCode).toBe(200);
    cookie = jar(cookiesOf(verified));
    expect(
      (await call({ method: "GET", url: "/v1/probe", host: PLATFORM, cookie })).statusCode,
    ).toBe(200);

    expect((await call({ url: "/auth/sign-out", host: PLATFORM, cookie })).statusCode).toBe(200);
    expect(
      (await call({ method: "GET", url: "/v1/probe", host: PLATFORM, cookie })).statusCode,
    ).toBe(401);
  });

  it("serializes /two-factor/enable per user: overlapping requests never return a stale QR", async () => {
    const user = await create(areaAuth.of("clinic"), "lock");
    const cookie = await signIn(APP, user.email);
    const enable = () =>
      call({ url: "/auth/two-factor/enable", host: APP, cookie, body: { password } });
    const key = ENROLLMENT_LOCK_PREFIX + user.userId;

    // Deterministic overlap: hold the lock as another session, then fire three — all must be refused.
    const held = await owner.reserve();
    await held`SELECT pg_advisory_lock(hashtextextended(${key}, 0))`;
    const busy = await Promise.all([enable(), enable(), enable()]);
    await held`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`;
    held.release();
    expect(busy.map((r) => r.statusCode)).toEqual([409, 409, 409]);
    expect(busy[0]!.json()).toMatchObject({ code: "two_factor_busy" });

    // Free race: no 500, one row, and the last 200 to finish holds the stored secret.
    const finished: { status: number; uri?: string }[] = [];
    await Promise.all(
      [1, 2, 3].map(async () => {
        const r = await enable();
        finished.push({
          status: r.statusCode,
          ...(r.statusCode === 200 ? { uri: r.json().totpURI } : {}),
        });
      }),
    );
    expect(finished.every((f) => f.status === 200 || f.status === 409)).toBe(true);
    const [counted] = await owner<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM auth_two_factors WHERE user_id = ${user.userId}`;
    expect(counted?.count).toBe(1);
    const last = finished.filter((f) => f.status === 200).at(-1)!;
    const verify = await call({
      url: "/auth/two-factor/verify-totp",
      host: APP,
      cookie,
      body: { code: totpFromUri(last.uri!) },
    });
    expect(verify.statusCode).toBe(200);
  });
});
