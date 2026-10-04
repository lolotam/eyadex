import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database, type Tx } from "../index.ts";
import {
  createOwner,
  idList,
  newTestId,
  seedTwoClinics,
  TEST_URLS,
  type ClinicFixture,
} from "./test-database.ts";

// مفيش Drizzle schema في الباكاج لسه (دي B3b)، فكل query هنا SQL مباشر على الـ Tx.
const idsIn = async (tx: Tx, ids: string[]): Promise<string[]> => {
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM clinics WHERE id IN (${idList(ids)})`,
  );
  return rows.map((row) => row.id);
};

const patientCount = async (tx: Tx): Promise<number> => {
  const rows = await tx.execute<{ total: string }>(sql`SELECT count(*) AS total FROM patients`);
  return Number(rows[0]?.total ?? -1);
};

const seenPatients = async (tx: Tx, a: ClinicFixture, b: ClinicFixture): Promise<string[]> => {
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM patients WHERE id IN (${idList([a.patientId, b.patientId])}) ORDER BY id`,
  );
  return rows.map((row) => row.id);
};

let owner: Sql;
let A: ClinicFixture;
let B: ClinicFixture;
let app: Database;

beforeAll(async () => {
  owner = createOwner();
  [A, B] = await seedTwoClinics(owner);
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

describe("withTenant isolates a clinic", () => {
  it("sees only its own patients and branches, and only its own clinic row", async () => {
    const seen = await app.withTenant(A.clinicId, async (tx) => {
      const branches = await tx.execute<{ id: string }>(
        sql`SELECT id FROM branches WHERE id IN (${idList([A.branchId, B.branchId])}) ORDER BY id`,
      );
      return {
        patients: await seenPatients(tx, A, B),
        branches: branches.map((row) => row.id),
        clinics: await idsIn(tx, [A.clinicId, B.clinicId]),
      };
    });
    expect(seen.patients).toEqual([A.patientId]);
    expect(seen.branches).toEqual([A.branchId]);
    expect(seen.clinics).toEqual([A.clinicId]);
  });

  it("refuses a write into another clinic and writes nothing (RLS WITH CHECK)", async () => {
    const probe = newTestId();
    let failure: { code?: string } | undefined;
    try {
      await app.withTenant(A.clinicId, (tx) =>
        tx.execute(sql`
          INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
          VALUES (${B.clinicId}, ${probe}, 'تسريب', 'Leak', true, now(), now())
        `),
      );
    } catch (error) {
      failure = error as { code?: string };
    }
    expect(failure?.code).toBe("42501");
    const rows =
      await owner`SELECT id FROM branches WHERE id = ${probe} AND clinic_id = ${B.clinicId}`;
    expect(rows).toHaveLength(0);
  });
});

describe("withNoTenant", () => {
  it("sees zero clinic rows but can resolve an invitation token", async () => {
    const found = await app.withNoTenant(async (tx) => ({
      patients: await patientCount(tx),
      resolved: await tx.execute<{ clinic: string | null }>(
        sql`SELECT invitation_clinic_for_token(${A.invitationTokenHash}) AS clinic`,
      ),
      unknown: await tx.execute<{ clinic: string | null }>(
        sql`SELECT invitation_clinic_for_token(${`b3a-unknown-${A.clinicId}`}) AS clinic`,
      ),
    }));
    expect(found.patients).toBe(0);
    expect(found.resolved[0]?.clinic).toBe(A.clinicId);
    expect(found.unknown[0]?.clinic).toBeNull();
  });
});

describe("a clinic value set on the session cannot leak through the pool", () => {
  it("is refused by the closing check, and the next transactions still see only their own rows", async () => {
    const single = createDatabase({
      url: TEST_URLS.appUrl,
      role: "eyadex_app",
      ids: { newId: () => A.clinicId },
      maxConnections: 1,
    });
    try {
      // is_local = false: القيمة دي بتفضل بعد الـ COMMIT على الـ connection نفسها
      const failure = await single
        .withTenant(A.clinicId, (tx) =>
          tx.execute(sql`SELECT set_config('app.clinic_id', ${B.clinicId}, false)`),
        )
        .then(() => undefined)
        .catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      // وبعد الرفض: نفس الـ connection بتاعة pool من size 1 لسه نضيفة
      expect(await single.withNoTenant(patientCount)).toBe(0);
      const seen = await single.withTenant(A.clinicId, (tx) => seenPatients(tx, A, B));
      expect(seen).toEqual([A.patientId]);
    } finally {
      await single.close();
    }
  });
});

describe("a failure inside fn rolls the whole transaction back", () => {
  it("rethrows the original error object and leaves nothing behind", async () => {
    const probe = newTestId();
    const boom = new Error("use case failed on purpose");
    let caught: unknown;
    try {
      await app.withTenant(A.clinicId, async (tx) => {
        await tx.execute(sql`
          INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
          VALUES (${A.clinicId}, ${probe}, 'تراجع', 'Rolled back', true, now(), now())
        `);
        throw boom;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(boom);
    const rows = await owner`SELECT id FROM branches WHERE id = ${probe}`;
    expect(rows).toHaveLength(0);
  });
});
