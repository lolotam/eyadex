import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../index.ts";
import {
  createOwner,
  runAsOwner,
  seedTwoClinics,
  secretsOf,
  TEST_URLS,
  uniqueRoleName,
  type ClinicFixture,
} from "./test-database.ts";

let owner: Sql;
let A: ClinicFixture;

beforeAll(async () => {
  owner = createOwner();
  [A] = await seedTwoClinics(owner);
});

afterAll(async () => {
  await owner.end();
});

/**
 * بيمنح `eyadex_app` عضوية في دور معيّن بالاسم، ويرجّع دالة ترجّعها زي ما كانت. راجع (٥) في
 * AGENTS.md: الاختبار بيتنضّف جوه `finally`، ولازم يرجّع حتى لو فشل في النص.
 */
const membership = async (grantedRole: string): Promise<() => Promise<void>> => {
  await runAsOwner(owner, `GRANT ${grantedRole} TO eyadex_app`);
  return async () => {
    await runAsOwner(owner, `REVOKE ${grantedRole} FROM eyadex_app`);
  };
};

describe("a role that is a member of another role is refused", () => {
  it("a BYPASSRLS member role cannot open a transaction, and ping refuses it too", async () => {
    const bypass = uniqueRoleName("b3a_bypass");
    const granted: (() => Promise<void>)[] = [];
    let database: Database | undefined;
    try {
      await runAsOwner(owner, `CREATE ROLE ${bypass} NOLOGIN BYPASSRLS`);
      granted.push(await membership(bypass));
      database = createDatabase({
        url: TEST_URLS.appUrl,
        role: "eyadex_app",
        ids: { newId: () => A.clinicId },
      });
      let called = false;
      const failure = await database
        .withTenant(A.clinicId, async () => {
          called = true;
          return "must not run";
        })
        .then(() => undefined)
        .catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      // The message names the expected role and nothing else from the URL — no password, no
      // host, no port. (The username is the role itself, so it is the one part allowed out.)
      expect((failure as Error).message).toContain("eyadex_app");
      for (const secret of secretsOf(TEST_URLS.appUrl, "eyadex_app")) {
        expect((failure as Error).message).not.toContain(secret);
      }
      expect(called).toBe(false);
      const pingFailure = await database
        .ping()
        .then(() => undefined)
        .catch((error: Error) => error);
      expect(pingFailure).toBeInstanceOf(Error);
    } finally {
      await database?.close();
      for (const revoke of granted.reverse()) await revoke();
      await runAsOwner(owner, `DROP ROLE IF EXISTS ${bypass}`);
    }
  });

  it("pg_monitor membership is refused too — it reads every cluster-wide statistic", async () => {
    const granted = await membership("pg_monitor");
    let database: Database | undefined;
    try {
      database = createDatabase({
        url: TEST_URLS.appUrl,
        role: "eyadex_app",
        ids: { newId: () => A.clinicId },
      });
      let called = false;
      const failure = await database
        .withTenant(A.clinicId, async () => {
          called = true;
          return "must not run";
        })
        .then(() => undefined)
        .catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(called).toBe(false);
      await expect(database.ping()).rejects.toThrow(/member of any role/);
    } finally {
      await database?.close();
      await granted();
    }
  });

  it("the runtime role has no memberships once the grants are gone", async () => {
    const rows = await owner<{ member_of_another_role: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_auth_members m
                     WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user))
        AS member_of_another_role
      FROM pg_roles WHERE rolname = 'eyadex_app'`;
    expect(rows[0]?.member_of_another_role).toBe(false);
  });
});
