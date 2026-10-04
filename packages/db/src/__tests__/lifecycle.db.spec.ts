import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../index.ts";
import {
  createOwner,
  idList,
  seedTwoClinics,
  TEST_URLS,
  type ClinicFixture,
} from "./test-database.ts";

let owner: Sql;
let A: ClinicFixture;
let B: ClinicFixture;

beforeAll(async () => {
  owner = createOwner();
  [A, B] = await seedTwoClinics(owner);
});

afterAll(async () => {
  await owner.end();
});

describe("transactionTimeoutMs bounds the statement on the server", () => {
  it("cancels a long statement with 57014 and releases the connection", async () => {
    const impatient = createDatabase({
      url: TEST_URLS.appUrl,
      role: "eyadex_app",
      ids: { newId: () => A.clinicId },
      transactionTimeoutMs: 300,
    });
    try {
      const started = Date.now();
      // bound واسع: المقصود إن السيرفر ألغى الـ statement، مش إننا سباقنا مع الـ CI
      const failure = await impatient
        .withTenant(A.clinicId, (tx) => tx.execute(sql`SELECT pg_sleep(2)`))
        .then(() => undefined)
        .catch((error: { code?: string }) => error);
      expect(failure).toBeDefined();
      expect(failure?.code).toBe("57014");
      expect(Date.now() - started).toBeLessThan(5_000);
      // الـ connection رجعت للـ pool بعد ما الـ server قفل الـ transaction
      await expect(impatient.withTenant(A.clinicId, async () => "still usable")).resolves.toBe(
        "still usable",
      );
    } finally {
      await impatient.close();
    }
  });
});

describe("concurrent transactions on a small pool", () => {
  it("20 interleaved reads each see only their own clinic", async () => {
    const pooled = createDatabase({
      url: TEST_URLS.appUrl,
      role: "eyadex_app",
      ids: { newId: () => A.clinicId },
      maxConnections: 3,
    });
    const mine = A.clinicId;
    const theirs = B.clinicId;
    const minePatient = A.patientId;
    const theirsPatient = B.patientId;
    const read = async (clinicId: string, own: string, other: string) => {
      const rows = await pooled.withTenant(clinicId, async (tx) => {
        const seen = await tx.execute<{ id: string }>(
          sql`SELECT id FROM patients WHERE id IN (${idList([own, other])}) ORDER BY id`,
        );
        const pid = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        return { seen: seen.map((row) => row.id), pid: pid[0]?.pid ?? 0 };
      });
      return { clinicId, ...rows };
    };
    try {
      const work = Array.from({ length: 20 }, (_unused, index) =>
        index % 2 === 0
          ? read(mine, minePatient, theirsPatient)
          : read(theirs, theirsPatient, minePatient),
      );
      const results = await Promise.all(work);
      expect(results).toHaveLength(20);
      for (const result of results) {
        expect(result.seen).toEqual([result.clinicId === mine ? minePatient : theirsPatient]);
      }
      // كل الـ 20 مرّوا على 3 backends بالكتير، يعني الـ isolation اتلعبت تحت ضغط
      expect(new Set(results.map((result) => result.pid)).size).toBeLessThanOrEqual(3);
    } finally {
      await pooled.close();
    }
  });
});
