import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  call,
  closeHarness,
  createUser,
  jar,
  openHarness,
  password,
  setCookies,
  type Harness,
} from "./auth-http-harness.ts";

// ADR-0021: staging runs beside production with its own hosts and its own cookie names. Both apps here
// share one database and one secret on purpose, so the only thing that can keep their sessions apart
// is the cookie name (in a real deployment the secret and the database differ too).
const PROD_APP = "https://app.eyadex.test";
const STAGING_APP = "https://staging-app.eyadex.test";
const STAGING_PLATFORM = "https://staging-platform.eyadex.test";
const secret = randomBytes(32).toString("hex");

let production: Harness;
let staging: Harness;

beforeAll(async () => {
  production = await openHarness({ BETTER_AUTH_SECRET: secret, AUTH_COOKIE_PREFIX: "" });
  staging = await openHarness({
    APP_URL: STAGING_APP,
    PLATFORM_URL: STAGING_PLATFORM,
    BETTER_AUTH_SECRET: secret,
    AUTH_COOKIE_PREFIX: "eyadex-staging",
  });
});

afterAll(async () => {
  await closeHarness(staging);
  await closeHarness(production);
  // process.env outlives this file; the next spec must start on the production default again.
  delete process.env["AUTH_COOKIE_PREFIX"];
});

const signIn = async (h: Harness, host: string, email: string) => {
  const res = await call(h, {
    url: "/auth/sign-in/email",
    host,
    ip: "198.51.100.12",
    body: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return setCookies(res);
};
const probe = (h: Harness, host: string, cookie: string) =>
  call(h, { method: "GET", url: "/v1/probe", host, cookie });

describe("staging and production never share a session (ADR-0021)", () => {
  it("a staging sign-in sets only eyadex-staging-clinic cookies, valid on the staging host", async () => {
    const user = await createUser(staging, staging.areaAuth.of("clinic"), "staging");
    const lines = await signIn(staging, STAGING_APP, user.email);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.startsWith("__Secure-eyadex-staging-clinic.")).toBe(true);
      expect(line).not.toMatch(/;\s*Domain=/i);
    }
    const ok = await probe(staging, STAGING_APP, jar(lines));
    expect(ok.json()).toMatchObject({ area: "clinic", userId: user.userId });
  });

  it("NEGATIVE: a staging session is not read by production, even with the same secret and data", async () => {
    const user = await createUser(staging, staging.areaAuth.of("clinic"), "staging-cross");
    const cookie = jar(await signIn(staging, STAGING_APP, user.email));
    const res = await probe(production, PROD_APP, cookie);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "unauthorized" });
  });

  it("NEGATIVE: a production session is not read by staging", async () => {
    const user = await createUser(production, production.areaAuth.of("clinic"), "prod-cross");
    const lines = await signIn(production, PROD_APP, user.email);
    expect(lines.every((line) => line.startsWith("__Secure-eyadex-clinic."))).toBe(true);
    const res = await probe(staging, STAGING_APP, jar(lines));
    expect(res.statusCode).toBe(401);
  });

  it("NEGATIVE: a staging API answers 404 on a production host, before any session is read", async () => {
    const res = await call(staging, {
      url: "/auth/sign-in/email",
      host: PROD_APP,
      body: { email: "nobody@example.com", password },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not_found" });
  });
});
