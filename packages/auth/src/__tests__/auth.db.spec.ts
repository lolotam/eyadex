import { randomBytes } from "node:crypto";

import { systemUuidV7 } from "@eyadex/ids";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuth, type EyadexAuth } from "../create-auth.ts";
import { totpFromUri } from "./totp.ts";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set — @eyadex/auth test:db needs the owner and eyadex_auth URLs`);
  }
  return value;
};
const OWNER_URL = required("EYADEX_TEST_OWNER_URL");
const AUTH_URL = required("EYADEX_TEST_AUTH_URL");
const ids = systemUuidV7();

// Generated per run: never a real password, and every email is unique on a non-empty database.
const password = randomBytes(18).toString("base64url");
const uniqueEmail = (label: string) => `${label}-${ids.newId()}@example.com`;

let owner: Sql;
let clinic: EyadexAuth;

/** يحوّل الـ Set-Cookie بتاع الرد لـ headers طلب تالي. */
const cookieHeaders = (response: Response): Headers => {
  const cookies = response.headers.getSetCookie().map((line) => line.split(";")[0]);
  return new Headers({ cookie: cookies.join("; ") });
};

const signIn = (email: string, pass: string) =>
  clinic.auth.api.signInEmail({ body: { email, password: pass }, asResponse: true });

beforeAll(() => {
  owner = postgres(OWNER_URL, { max: 1, onnotice: () => undefined });
  clinic = createAuth({
    area: "clinic",
    databaseUrl: AUTH_URL,
    secret: randomBytes(32).toString("hex"),
    baseUrl: "http://localhost:3000",
    ids,
  });
});

afterAll(async () => {
  await clinic.close();
  await owner.end();
});

describe("Better Auth on eyadex_auth", () => {
  it("creates a user server-side with a UUID v7 id and a hashed credential", async () => {
    const email = uniqueEmail("create");
    const { userId } = await clinic.createUserAccount({ email, name: "Create", password });
    expect(userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const [row] = await owner<{ password: string }[]>`
      SELECT password FROM auth_accounts WHERE user_id = ${userId} AND provider_id = 'credential'`;
    expect(row?.password).toBeDefined();
    expect(row?.password).not.toContain(password);
  });

  it("signs in with the right password and finds the session by its token", async () => {
    const email = uniqueEmail("signin");
    const { userId } = await clinic.createUserAccount({ email, name: "Sign in", password });
    const response = await signIn(email, password);
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toMatch(/eyadex-clinic\.session_token=/);
    expect(cookies.toLowerCase()).toContain("httponly");
    const session = await clinic.auth.api.getSession({ headers: cookieHeaders(response) });
    expect(session?.user.id).toBe(userId);
    const context = await clinic.auth.$context;
    const found = await context.internalAdapter.findSession(session?.session.token ?? "");
    expect(found?.user.id).toBe(userId);
  });

  it("refuses a wrong password", async () => {
    const email = uniqueEmail("wrong");
    await clinic.createUserAccount({ email, name: "Wrong", password });
    const response = await signIn(email, `${password}-not-it`);
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("refuses public sign-up", async () => {
    const email = uniqueEmail("signup");
    const response = await clinic.auth.api.signUpEmail({
      body: { email, password, name: "Self" },
      asResponse: true,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const rows = await owner`SELECT 1 FROM auth_users WHERE email = ${email}`;
    expect(rows).toHaveLength(0);
  });

  it("revokeUserSessions ends every session of the user", async () => {
    const email = uniqueEmail("revoke");
    const { userId } = await clinic.createUserAccount({ email, name: "Revoke", password });
    const first = cookieHeaders(await signIn(email, password));
    const second = cookieHeaders(await signIn(email, password));
    expect(await clinic.auth.api.getSession({ headers: first })).not.toBeNull();
    await clinic.revokeUserSessions(userId);
    expect(await clinic.auth.api.getSession({ headers: first })).toBeNull();
    expect(await clinic.auth.api.getSession({ headers: second })).toBeNull();
    const rows = await owner`SELECT 1 FROM auth_sessions WHERE user_id = ${userId}`;
    expect(rows).toHaveLength(0);
  });

  it("enables two-factor and verifies a TOTP code", async () => {
    const email = uniqueEmail("totp");
    const { userId } = await clinic.createUserAccount({ email, name: "TOTP", password });
    const headers = cookieHeaders(await signIn(email, password));
    const enabled = await clinic.auth.api.enableTwoFactor({ body: { password }, headers });
    expect(enabled.totpURI).toMatch(/^otpauth:\/\/totp\//);
    const verified = await clinic.auth.api.verifyTOTP({
      body: { code: totpFromUri(enabled.totpURI) },
      headers,
    });
    expect(verified.user.id).toBe(userId);
    const [user] = await owner<{ two_factor_enabled: boolean }[]>`
      SELECT two_factor_enabled FROM auth_users WHERE id = ${userId}`;
    expect(user?.two_factor_enabled).toBe(true);
    const [secretRow] = await owner<{ secret: string }[]>`
      SELECT secret FROM auth_two_factors WHERE user_id = ${userId}`;
    // Stored encrypted, never as the plain base32 secret the URI carries.
    const plain = new URL(enabled.totpURI).searchParams.get("secret") ?? "";
    expect(secretRow?.secret).not.toContain(plain);
  });
});
