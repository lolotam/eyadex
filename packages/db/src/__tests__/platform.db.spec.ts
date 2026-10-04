import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, TenantContextViolationError, type Database } from "../index.ts";
import {
  createOwner,
  idList,
  newTestId,
  seedTwoClinics,
  TEST_URLS,
  type ClinicFixture,
} from "./test-database.ts";

let owner: Sql;
let A: ClinicFixture;
let B: ClinicFixture;
let platform: Database;

beforeAll(async () => {
  owner = createOwner();
  [A, B] = await seedTwoClinics(owner);
  platform = createDatabase({
    url: TEST_URLS.platformUrl,
    role: "eyadex_platform",
    ids: { newId: () => A.clinicId },
  });
});

afterAll(async () => {
  await platform.close();
  await owner.end();
});

describe("the platform role has no patient data to leak", () => {
  it("withTenant on patients is permission denied, even inside a clinic context", async () => {
    let failure: { code?: string } | undefined;
    try {
      await platform.withTenant(A.clinicId, (tx) => tx.execute(sql`SELECT id FROM patients`));
    } catch (error) {
      failure = error as { code?: string };
    }
    expect(failure?.code).toBe("42501");
  });

  it("withNoTenant lists every clinic, because clinic administration is not tenant data", async () => {
    const clinics = await platform.withNoTenant(async (tx) => {
      const rows = await tx.execute<{ id: string }>(
        sql`SELECT id FROM clinics WHERE id IN (${idList([A.clinicId, B.clinicId])}) ORDER BY id`,
      );
      return rows.map((row) => row.id);
    });
    expect(new Set(clinics)).toEqual(new Set([A.clinicId, B.clinicId]));
  });
});

describe("withNewTenant is how a clinic is created", () => {
  it("inserts the clinic and a role for it under the generated id, visible to the owner", async () => {
    const clinicId = newTestId();
    const onboarding = createDatabase({
      url: TEST_URLS.platformUrl,
      role: "eyadex_platform",
      ids: { newId: () => clinicId },
    });
    const roleId = newTestId();
    try {
      const passed = await onboarding.withNewTenant(async (tx, generated) => {
        expect(generated).toBe(clinicId);
        await tx.execute(sql`
          INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone,
              status, expires_at, max_users, max_branches, created_at, updated_at)
          VALUES (${generated}, ${`b3a-${generated}`}, 'عيادة جديدة', 'New clinic', 'general', 'ar',
              'Asia/Kuwait', 'trial', now() + interval '30 days', 5, 1, now(), now())
        `);
        await tx.execute(sql`
          INSERT INTO roles (clinic_id, id, system_key, name_ar, name_en, is_locked, is_active, created_at, updated_at)
          VALUES (${generated}, ${roleId}, 'clinic_admin', 'مدير', 'Admin', true, true, now(), now())
        `);
        return generated;
      });
      expect(passed).toBe(clinicId);
      const clinics = await owner`SELECT slug FROM clinics WHERE id = ${clinicId}`;
      expect(clinics).toHaveLength(1);
      const roles = await owner`SELECT system_key FROM roles WHERE clinic_id = ${clinicId}`;
      expect(roles.map((row) => row["system_key"])).toEqual(["clinic_admin"]);
    } finally {
      await onboarding.close();
    }
  });

  it("refuses an id that already belongs to a clinic, before fn runs", async () => {
    const onboarding = createDatabase({
      url: TEST_URLS.platformUrl,
      role: "eyadex_platform",
      ids: { newId: () => A.clinicId },
    });
    let called = false;
    let failure: unknown;
    try {
      await onboarding.withNewTenant(async (tx) => {
        called = true;
        await tx.execute(sql`UPDATE clinics SET max_branches = 99 WHERE id = ${A.clinicId}`);
      });
    } catch (error) {
      failure = error;
    } finally {
      await onboarding.close();
    }
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("fresh-clinic");
    expect(called).toBe(false);
    const rows = await owner`SELECT max_branches FROM clinics WHERE id = ${A.clinicId}`;
    expect(rows[0]?.["max_branches"]).toBe(3);
  });
});
