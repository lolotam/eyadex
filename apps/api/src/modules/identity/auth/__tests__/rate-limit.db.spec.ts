import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { APP, call, closeHarness, createUser, jar, openHarness, password, setCookies } from "./auth-http-harness.ts";
import type { Harness } from "./auth-http-harness.ts";

// ADR-0005. Each harness has a fresh secret, so its HMAC keys never meet another file's; FLUSHDB
// makes the clear-text scan below look at this file's keys only.
const redisUrl = process.env["EYADEX_TEST_REDIS_URL"] ?? "";
let h: Harness;
let redis: Redis;

const wrongSignIn = (email: string, ip: string) =>
  call(h, { url: "/auth/sign-in/email", host: APP, ip, body: { email, password: "wrong-password-1" } });

beforeAll(async () => {
  if (redisUrl === "") throw new Error("EYADEX_TEST_REDIS_URL is not set — see CI db job");
  redis = new Redis(redisUrl);
  await redis.flushdb();
  h = await openHarness();
});

afterAll(async () => {
  await closeHarness(h);
  await redis?.quit();
});

describe("auth rate limiting (ADR-0005)", () => {
  it("the 6th wrong sign-in for one email is refused even from different IPs", async () => {
    const { email } = await createUser(h, h.areaAuth.of("clinic"), "rl-email");
    for (let i = 1; i <= 5; i++) {
      expect((await wrongSignIn(email, `198.51.100.${i}`)).statusCode).toBe(401);
    }
    const sixth = await wrongSignIn(` ${email.toUpperCase()} `, "198.51.100.99");
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().code).toBe("rate_limited");
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("the 21st sign-in from one IP is refused across different emails", async () => {
    for (let i = 1; i <= 20; i++) {
      expect((await wrongSignIn(`nobody-${i}@example.com`, "203.0.113.7")).statusCode).toBe(401);
    }
    expect((await wrongSignIn("nobody-21@example.com", "203.0.113.7")).statusCode).toBe(429);
  });

  it("a client X-Forwarded-For does not move the IP bucket when TRUST_PROXY_HOPS=0", async () => {
    for (let i = 1; i <= 20; i++) {
      await call(h, {
        url: "/auth/sign-in/email",
        host: APP,
        ip: "203.0.113.8",
        headers: { "x-forwarded-for": `192.0.2.${i}` },
        body: { email: `spoof-${i}@example.com`, password: "wrong-password-1" },
      });
    }
    const res = await call(h, {
      url: "/auth/sign-in/email",
      host: APP,
      ip: "203.0.113.8",
      headers: { "x-forwarded-for": "192.0.2.200" },
      body: { email: "spoof-21@example.com", password: "wrong-password-1" },
    });
    expect(res.statusCode).toBe(429);
  });

  it("the 6th verify-totp for one user is refused, from any IP", async () => {
    const { email } = await createUser(h, h.areaAuth.of("clinic"), "rl-totp");
    const signIn = await call(h, { url: "/auth/sign-in/email", host: APP, ip: "198.51.100.200", body: { email, password } });
    expect(signIn.statusCode).toBe(200);
    const cookie = jar(setCookies(signIn));
    const enable = await call(h, { url: "/auth/two-factor/enable", host: APP, cookie, body: { password } });
    expect(enable.statusCode).toBe(200);
    const verify = (i: number) =>
      call(h, { url: "/auth/two-factor/verify-totp", host: APP, cookie, ip: `198.51.100.${210 + i}`, body: { code: "000000" } });
    for (let i = 1; i <= 5; i++) expect((await verify(i)).statusCode).not.toBe(429);
    expect((await verify(6)).statusCode).toBe(429);
  });

  it("keys hold no email or IP in clear text", async () => {
    const keys = await redis.keys("eyadex:rl:*");
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toMatch(/^eyadex:rl:(clinic|platform):[a-z-]+:(ip|email|subject|user):[0-9a-f]{64}$/);
      expect(key).not.toMatch(/@|example|\d+\.\d+\.\d+\.\d+/);
    }
  });
});

describe("Redis unavailable", () => {
  it("fails closed with 503 unknown and never reaches Better Auth", async () => {
    const down = await openHarness({ REDIS_URL: "redis://127.0.0.1:1" });
    try {
      const { email } = await createUser(down, down.areaAuth.of("clinic"), "rl-down");
      const res = await call(down, { url: "/auth/sign-in/email", host: APP, body: { email, password } });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("unknown");
      expect(setCookies(res)).toEqual([]);
    } finally {
      await closeHarness(down);
    }
  });
});
