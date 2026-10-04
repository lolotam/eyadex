import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, ForbiddenStatementError, type Database } from "../index.ts";
import {
  createOwner,
  newTestId,
  seedTwoClinics,
  TEST_URLS,
  type ClinicFixture,
} from "./test-database.ts";

let owner: Sql;
let A: ClinicFixture;
let app: Database;

beforeAll(async () => {
  owner = createOwner();
  [A] = await seedTwoClinics(owner);
  app = createDatabase({
    url: TEST_URLS.appUrl,
    role: "eyadex_app",
    ids: { newId: () => A.clinicId },
  });
});

afterAll(async () => {
  await app.close();
  await owner.end();
});

/**
 * جمعة **من غير أي parameters** (`sql.raw`) عشان postgres.js تسيب مسار الـ simple protocol لما
 * مفيش args، وهو المسار اللي بيقبل أكتر من statement في نداء واحد. الجملة الأولى مسموحة
 * (`INSERT`)، والتانية `COMMIT` مخبّية ورا `;`.
 */
const smuggleCommit = (probe: string) =>
  sql.raw(
    `INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
     VALUES ('${A.clinicId}', '${probe}', 'مسبار', 'Probe', true, now(), now()); COMMIT`,
  );

const commitSurvived = async (probe: string): Promise<boolean> =>
  (await owner`SELECT id FROM branches WHERE id = ${probe}`).length > 0;

describe("fn cannot smuggle a second statement into one parameterless call", () => {
  it("refuses INSERT …; COMMIT and commits nothing", async () => {
    const probe = newTestId();
    let failure: unknown;
    try {
      await app.withTenant(A.clinicId, async (tx) => {
        await tx.execute(smuggleCommit(probe));
        return "never reached";
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ForbiddenStatementError);
    expect(await commitSurvived(probe)).toBe(false);
  });
});
