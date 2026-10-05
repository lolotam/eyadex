import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP,
  call,
  closeHarness,
  createUser,
  jar,
  openHarness,
  password,
  PLATFORM,
  setCookies,
  type Harness,
} from "./auth-http-harness.ts";
import { totpFromUri } from "./totp.ts";

// Second review round of slice 2b: account↔area binding, the enrollment pool, platform trust-device
// and pre-enrollment sessions, and the error envelope for Better Auth failures.
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});

afterAll(async () => {
  await closeHarness(h);
});

const signIn = (host: string, email: string, pass = password) =>
  call(h, { url: "/auth/sign-in/email", host, body: { email, password: pass } });

/** Signs in, enrolls TOTP and verifies it; returns the verified session cookie and the TOTP URI. */
async function enrolled(host: string, email: string) {
  const cookie = jar(setCookies(await signIn(host, email)));
  const enable = await call(h, {
    url: "/auth/two-factor/enable",
    host,
    cookie,
    body: { password },
  });
  expect(enable.statusCode).toBe(200);
  const uri: string = enable.json().totpURI;
  const verify = await call(h, {
    url: "/auth/two-factor/verify-totp",
    host,
    cookie,
    body: { code: totpFromUri(uri) },
  });
  expect(verify.statusCode).toBe(200);
  return { cookie: jar(setCookies(verify)), uri };
}

const sessionsIn = async (userId: string, area: string) =>
  (await h.owner`SELECT 1 FROM auth_sessions WHERE user_id = ${userId} AND area = ${area}`).length;

describe("one account, one area (0024)", () => {
  it("NEGATIVE: a clinic account's password does not open a platform session", async () => {
    const user = await createUser(h, h.areaAuth.of("clinic"), "clinic-on-platform");
    const res = await signIn(PLATFORM, user.email);
    expect(res.statusCode).toBe(401);
    // Reads exactly like a wrong password: the platform host does not confirm clinic accounts.
    expect(res.json()).toMatchObject({ code: "invalid_credentials" });
    expect(setCookies(res).some((line) => line.includes("session_token="))).toBe(false);
    expect(await sessionsIn(user.userId, "platform")).toBe(0);
    expect((await signIn(APP, user.email)).statusCode).toBe(200);
  });

  it("NEGATIVE: a clinic two_factor cookie renamed for the platform cannot finish a sign-in there", async () => {
    const user = await createUser(h, h.areaAuth.of("clinic"), "two-factor-cookie");
    const { uri } = await enrolled(APP, user.email);
    const pending = await signIn(APP, user.email);
    expect(pending.json()).toMatchObject({ twoFactorRedirect: true });
    const renamed = jar(setCookies(pending)).replaceAll(
      "__Secure-eyadex-clinic.",
      "__Secure-eyadex-platform.",
    );
    const verify = await call(h, {
      url: "/auth/two-factor/verify-totp",
      host: PLATFORM,
      cookie: renamed,
      body: { code: totpFromUri(uri) },
    });
    expect(verify.statusCode).toBeGreaterThanOrEqual(400);
    expect(await sessionsIn(user.userId, "platform")).toBe(0);
  });
});

describe("enrollment lock pool", () => {
  it("NEGATIVE: many users enrolling at once never starve the auth pool", async () => {
    const users = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7].map((n) => createUser(h, h.areaAuth.of("clinic"), `pool-${n}`)),
    );
    const cookies = await Promise.all(
      users.map(async (u) => jar(setCookies(await signIn(APP, u.email)))),
    );
    const results = await Promise.all(
      cookies.map((cookie) =>
        call(h, { url: "/auth/two-factor/enable", host: APP, cookie, body: { password } }),
      ),
    );
    expect(results.every((r) => r.statusCode === 200 || r.statusCode === 409)).toBe(true);
    expect(results.some((r) => r.statusCode === 200)).toBe(true);
    // The pool still answers afterwards.
    const after = await call(h, {
      method: "GET",
      url: "/v1/probe",
      host: APP,
      cookie: cookies[0]!,
    });
    expect(after.statusCode).toBe(200);
  }, 20_000);
});

describe("platform two-factor hardening", () => {
  it("NEGATIVE: trustDevice is refused on the platform host", async () => {
    const user = await createUser(h, h.areaAuth.of("platform"), "trust-device");
    const cookie = jar(setCookies(await signIn(PLATFORM, user.email)));
    const enable = await call(h, {
      url: "/auth/two-factor/enable",
      host: PLATFORM,
      cookie,
      body: { password },
    });
    const res = await call(h, {
      url: "/auth/two-factor/verify-totp",
      host: PLATFORM,
      cookie,
      body: { code: totpFromUri(enable.json().totpURI), trustDevice: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "validation" });
  });

  it("NEGATIVE: password-only sessions opened before enrollment are revoked when it completes", async () => {
    const user = await createUser(h, h.areaAuth.of("platform"), "pre-enrollment");
    const other = jar(setCookies(await signIn(PLATFORM, user.email)));
    const { cookie } = await enrolled(PLATFORM, user.email);
    expect(
      (await call(h, { method: "GET", url: "/v1/probe", host: PLATFORM, cookie })).statusCode,
    ).toBe(200);
    const stale = await call(h, { method: "GET", url: "/v1/probe", host: PLATFORM, cookie: other });
    expect(stale.statusCode).toBe(401);
  });
});

describe("Better Auth failures leave as the API envelope", () => {
  it("a wrong password → 401 invalid_credentials with both languages", async () => {
    const user = await createUser(h, h.areaAuth.of("clinic"), "envelope");
    const res = await signIn(APP, user.email, `${password}-wrong`);
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body).toMatchObject({ code: "invalid_credentials" });
    expect(typeof body.message_ar).toBe("string");
    expect(typeof body.message_en).toBe("string");
  });
});
