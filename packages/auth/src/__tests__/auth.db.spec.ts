import { randomBytes } from "node:crypto";

import { systemUuidV7 } from "@eyadex/ids";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuth, type EyadexAuth } from "../create-auth.ts";
import { totpFromUri } from "./totp.ts";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set — @eyadex/auth test:db needs the owner and eyadex_auth URLs`,
    );
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
let platform: EyadexAuth;

/** يحوّل الـ Set-Cookie بتاع الرد لـ headers طلب تالي. */
const cookieHeaders = (response: Response): Headers => {
  const cookies = response.headers.getSetCookie().map((line) => line.split(";")[0]);
  return new Headers({ cookie: cookies.join("; ") });
};

const signIn = (email: string, pass: string) =>
  clinic.auth.api.signInEmail({ body: { email, password: pass }, asResponse: true });

beforeAll(() => {
  owner = postgres(OWNER_URL, { max: 1, onnotice: () => undefined });
  // One secret for both areas, as in production: it also encrypts the per-user TOTP secret.
  const secret = randomBytes(32).toString("hex");
  clinic = createAuth({
    area: "clinic",
    databaseUrl: AUTH_URL,
    secret,
    baseUrl: "http://localhost:3000",
    ids,
  });
  platform = createAuth({
    area: "platform",
    databaseUrl: AUTH_URL,
    secret,
    baseUrl: "http://localhost:3001",
    ids,
  });
});

afterAll(async () => {
  await clinic.close();
  await platform.close();
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

  it("NEGATIVE: a failed credential write leaves no user behind (one transaction)", async () => {
    const email = uniqueEmail("atomic");
    const context = await clinic.auth.$context;
    const linkAccount = context.internalAdapter.linkAccount;
    context.internalAdapter.linkAccount = () =>
      Promise.reject(new Error("credential write failed"));
    try {
      await expect(clinic.createUserAccount({ email, name: "Atomic", password })).rejects.toThrow(
        "credential write failed",
      );
    } finally {
      context.internalAdapter.linkAccount = linkAccount;
    }
    expect(await owner`SELECT 1 FROM auth_users WHERE email = ${email}`).toHaveLength(0);
    // The email is still free: the retry succeeds.
    await expect(clinic.createUserAccount({ email, name: "Atomic", password })).resolves.toEqual({
      userId: expect.any(String),
    });
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

  it("NEGATIVE: a clinic session replayed under the platform cookie name is refused", async () => {
    const email = uniqueEmail("area");
    const { userId } = await clinic.createUserAccount({ email, name: "Area", password });
    const clinicHeaders = cookieHeaders(await signIn(email, password));
    const [row] = await owner<{ area: string }[]>`
      SELECT area FROM auth_sessions WHERE user_id = ${userId}`;
    expect(row?.area).toBe("clinic");
    expect((await clinic.getSession(clinicHeaders))?.user.id).toBe(userId);
    const replayed = new Headers({
      cookie: (clinicHeaders.get("cookie") ?? "").replaceAll("eyadex-clinic.", "eyadex-platform."),
    });
    // Same secret, same table: Better Auth alone accepts it — the area check is what refuses it.
    expect(await platform.auth.api.getSession({ headers: replayed })).not.toBeNull();
    expect(await platform.getSession(replayed)).toBeNull();
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

  it("NEGATIVE: overlapping first enrollments leave a single two-factor row", async () => {
    const email = uniqueEmail("totp-race");
    const { userId } = await clinic.createUserAccount({ email, name: "Race", password });
    const headers = cookieHeaders(await signIn(email, password));
    await Promise.allSettled(
      [1, 2, 3].map(() => clinic.auth.api.enableTwoFactor({ body: { password }, headers })),
    );
    const rows = await owner`SELECT 1 FROM auth_two_factors WHERE user_id = ${userId}`;
    expect(rows).toHaveLength(1);
  });

  it("enables two-factor and verifies a TOTP code", async () => {
    const email = uniqueEmail("totp");
    const { userId } = await clinic.createUserAccount({ email, name: "TOTP", password });
    const headers = cookieHeaders(await signIn(email, password));
    const enabled = await clinic.auth.api.enableTwoFactor({ body: { password }, headers });
    if (enabled.method !== "totp") throw new Error("expected the TOTP method");
    expect(enabled.totpURI).toMatch(/^otpauth:\/\/totp\//);
    const verified = await clinic.auth.api.verifyTOTP({
      body: { code: totpFromUri(enabled.totpURI) },
      headers,
    });
    expect(verified.user.id).toBe(userId);
    const [user] = await owner<{ two_factor_enabled: boolean }[]>`
      SELECT two_factor_enabled FROM auth_users WHERE id = ${userId}`;
    expect(user?.two_factor_enabled).toBe(true);
    const [secretRow] = await owner<{ secret: string; backup_codes: string }[]>`
      SELECT secret, backup_codes FROM auth_two_factors WHERE user_id = ${userId}`;
    // Stored encrypted, never as the plain base32 secret the URI carries nor the recovery codes.
    const plain = new URL(enabled.totpURI).searchParams.get("secret") ?? "";
    expect(secretRow?.secret).not.toContain(plain);
    expect(enabled.backupCodes.length).toBeGreaterThan(0);
    for (const code of enabled.backupCodes) expect(secretRow?.backup_codes).not.toContain(code);
  });
});
