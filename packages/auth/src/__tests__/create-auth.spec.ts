import { randomBytes } from "node:crypto";

import { systemUuidV7 } from "@eyadex/ids";
import { afterAll, describe, expect, it } from "vitest";

import { createAuth } from "../create-auth.ts";

// No database here: postgres.js is lazy and these checks never send a query.
const secret = randomBytes(32).toString("hex");
const databaseUrl = "postgres://eyadex_auth:change-me@localhost:5432/eyadex";
const platform = createAuth({
  area: "platform",
  databaseUrl,
  secret,
  baseUrl: "https://platform.example.com",
  ids: systemUuidV7(),
});
const clinic = createAuth({
  area: "clinic",
  databaseUrl,
  secret,
  baseUrl: "https://app.example.com",
  ids: systemUuidV7(),
});

afterAll(async () => {
  await platform.close();
  await clinic.close();
});

describe("createAuth", () => {
  it("disables self sign-up and enables email + password", () => {
    expect(platform.auth.options.emailAndPassword.enabled).toBe(true);
    expect(platform.auth.options.emailAndPassword.disableSignUp).toBe(true);
  });

  it("uses a distinct cookie prefix per area", () => {
    expect(platform.auth.options.advanced.cookiePrefix).toBe("eyadex-platform");
    expect(clinic.auth.options.advanced.cookiePrefix).toBe("eyadex-clinic");
  });

  it("configures the two-factor plugin", () => {
    expect(platform.auth.options.plugins.map((plugin) => plugin.id)).toContain("two-factor");
  });

  it("keeps sessions in the database only (no cookie cache)", () => {
    expect(clinic.auth.options.session.cookieCache.enabled).toBe(false);
  });

  it("uses secure cookies on an https origin", () => {
    expect(clinic.auth.options.advanced.useSecureCookies).toBe(true);
  });

  it("refuses a password outside the limits before touching the database", async () => {
    await expect(
      clinic.createUserAccount({ email: "a@example.com", name: "A", password: "short" }),
    ).rejects.toThrow(RangeError);
  });
});
