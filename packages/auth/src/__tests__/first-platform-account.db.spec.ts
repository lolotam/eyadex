import { randomBytes } from "node:crypto";

import { systemUuidV7 } from "@eyadex/ids";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuth } from "../create-auth.ts";
import { createFirstPlatformAccount } from "../first-platform-account.ts";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set — see CI db job`);
  return value;
};
const OWNER_URL = required("EYADEX_TEST_OWNER_URL");
const AUTH_URL = required("EYADEX_TEST_AUTH_URL");
const ids = systemUuidV7();
const secret = randomBytes(32).toString("hex");
const password = randomBytes(18).toString("base64url");
const email = (label: string) => `${label}-${ids.newId()}@example.com`;
const options = {
  databaseUrl: AUTH_URL,
  secret,
  baseUrl: "https://staging-platform.eyadex.test",
  ids,
};

let owner: Sql;
const platformAccounts = async () =>
  (
    await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM auth_users WHERE area = 'platform'`
  )[0]!.n;
const holdOf = async (address: string) =>
  (await owner<{ kind: string }[]>`SELECT kind FROM email_reservations WHERE email = ${address}`)[0]
    ?.kind;

beforeAll(async () => {
  owner = postgres(OWNER_URL, { max: 1, onnotice: () => undefined });
  // The bootstrap is for a fresh database only, and this test database is shared: the platform
  // accounts other spec files left behind are removed first (their files have already finished).
  await owner`DELETE FROM auth_two_factors WHERE user_id IN
                (SELECT id FROM auth_users WHERE area = 'platform')`;
  await owner`DELETE FROM auth_users WHERE area = 'platform'`;
  await owner`DELETE FROM platform_accounts`;
});

afterAll(async () => {
  await owner?.end();
});

describe("createFirstPlatformAccount (ADR-0021)", () => {
  it("NEGATIVE: a password outside the limits creates nothing and holds no email", async () => {
    const address = email("short");
    await expect(
      createFirstPlatformAccount(options, { email: address, name: "Ops", password: "short" }),
    ).rejects.toThrow(RangeError);
    expect(await platformAccounts()).toBe(0);
    expect(await holdOf(address)).toBeUndefined();
  });

  it("NEGATIVE: a commit that fails after the user is written leaves no user and no hold", async () => {
    const address = email("boom");
    // A deferred trigger fails the bootstrap's COMMIT itself, after every row has been written: the
    // user, its credential and the email hold must all go or all stay.
    await owner.unsafe(`
      CREATE OR REPLACE FUNCTION public.test_fail_bootstrap_commit() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected commit failure'; END $$;
      CREATE CONSTRAINT TRIGGER test_fail_bootstrap_commit AFTER INSERT ON email_reservations
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        WHEN (NEW.email LIKE 'boom-%') EXECUTE FUNCTION public.test_fail_bootstrap_commit();`);
    try {
      await expect(
        createFirstPlatformAccount(options, { email: address, name: "Ops", password }),
      ).rejects.toThrow();
    } finally {
      await owner.unsafe(`
        DROP TRIGGER test_fail_bootstrap_commit ON email_reservations;
        DROP FUNCTION public.test_fail_bootstrap_commit();`);
    }
    expect(await platformAccounts()).toBe(0);
    expect(await holdOf(address)).toBeUndefined();
    const [user] = await owner`SELECT 1 FROM auth_users WHERE email = ${address}`;
    expect(user).toBeUndefined();
    // Nothing is left behind, so a rerun starts from a clean database (the race below is that rerun).
  });

  it("NEGATIVE: an email somebody already holds is refused, and nothing is created", async () => {
    const held = email("held");
    await owner`INSERT INTO email_reservations (email, kind, reserved_at) VALUES (${held}, 'platform', now())`;
    const result = await createFirstPlatformAccount(options, {
      email: held,
      name: "Ops",
      password,
    });
    expect(result).toEqual({ created: false, reason: "email_taken" });
    expect(await platformAccounts()).toBe(0);
  });

  it("NEGATIVE: an email with a clinic account is refused", async () => {
    const clinic = createAuth({
      ...options,
      area: "clinic",
      baseUrl: "https://staging-app.eyadex.test",
    });
    const address = email("clinic");
    try {
      await clinic.createUserAccount({ email: address, name: "Clinic", password });
    } finally {
      await clinic.close();
    }
    const result = await createFirstPlatformAccount(options, {
      email: address,
      name: "Ops",
      password,
    });
    expect(result).toEqual({ created: false, reason: "email_taken" });
    expect(await platformAccounts()).toBe(0);
  });

  it("NEGATIVE: a team that already has an active member is refused, and nothing is written (ADR-0020)", async () => {
    const member = ids.newId();
    const address = email("team-first");
    await owner`INSERT INTO platform_accounts (id, user_id, email, full_name, status, token_hash,
        token_expires_at, invited_by, joined_at, created_at, updated_at)
      VALUES (${member}, ${member}, ${email("member")}, 'Member', 'active', NULL, NULL, NULL, now(), now(), now())`;
    try {
      const result = await createFirstPlatformAccount(options, {
        email: address,
        name: "Ops",
        password,
      });
      expect(result).toEqual({ created: false, reason: "platform_account_exists" });
      expect(await platformAccounts()).toBe(0);
      expect(await holdOf(address)).toBeUndefined();
    } finally {
      await owner`DELETE FROM platform_accounts WHERE id = ${member}`;
    }
  });

  it("creates exactly one first account when two runs race, holding its email for the platform", async () => {
    const first = email("first");
    const second = email("second");
    const results = await Promise.all([
      createFirstPlatformAccount(options, {
        email: ` ${first.toUpperCase()} `,
        name: "Ops",
        password,
      }),
      createFirstPlatformAccount(options, { email: second, name: "Ops", password }),
    ]);
    const created = results.filter((result) => result.created);
    expect(created).toHaveLength(1);
    expect(results.filter((result) => !result.created)).toEqual([
      { created: false, reason: "platform_account_exists" },
    ]);
    expect(await platformAccounts()).toBe(1);
    const [row] = await owner<{ email: string; area: string }[]>`
      SELECT email, area FROM auth_users WHERE area = 'platform'`;
    expect([first, second]).toContain(row!.email);
    expect(await holdOf(row!.email)).toBe("platform");
    // The platform gate's row (0037): the first account is the team's active member.
    const team = await owner<{ email: string; status: string }[]>`
      SELECT email, status FROM platform_accounts`;
    expect(team).toEqual([{ email: row!.email, status: "active" }]);
  });

  it("NEGATIVE: once a platform account exists, the bootstrap refuses for good", async () => {
    const result = await createFirstPlatformAccount(options, {
      email: email("late"),
      name: "X",
      password,
    });
    expect(result).toEqual({ created: false, reason: "platform_account_exists" });
    expect(await platformAccounts()).toBe(1);
  });

  it("the new account signs in on the platform area with its password", async () => {
    const [row] = await owner<
      { email: string }[]
    >`SELECT email FROM auth_users WHERE area = 'platform'`;
    const platform = createAuth({ ...options, area: "platform" });
    try {
      const res = await platform.auth.api.signInEmail({
        body: { email: row!.email, password },
        asResponse: true,
      });
      expect(res.status).toBe(200);
    } finally {
      await platform.close();
    }
  });
});
