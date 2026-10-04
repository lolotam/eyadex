import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../index.ts";
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

const ownPatients = async (clinicId: string): Promise<string[]> =>
  app.withTenant(clinicId, async (tx) => {
    const rows = await tx.execute<{ id: string }>(
      sql`SELECT id FROM patients WHERE id IN (${idList([A.patientId, B.patientId])}) ORDER BY id`,
    );
    return rows.map((row) => row.id);
  });

describe("wrappers never nest on the same Database", () => {
  it("a wrapper called from inside another one rejects before taking a connection", async () => {
    let inner: unknown;
    const outer = await app
      .withTenant(A.clinicId, async (tx) => {
        inner = await app
          .withNoTenant(() => Promise.resolve("never"))
          .then(() => undefined)
          .catch((error: unknown) => error);
        return await tx.execute<{ id: string }>(
          sql`SELECT id FROM patients WHERE id IN (${idList([A.patientId, B.patientId])}) ORDER BY id`,
        );
      })
      .catch((error: unknown) => error);
    expect(inner).toBeInstanceOf(TypeError);
    expect((inner as TypeError).message).toMatch(/nested database work/);
    // The outer transaction is untouched by the refused inner call, and it committed.
    expect((outer as { id: string }[]).map((row) => row.id)).toEqual([A.patientId]);
  });

  it("ping inside a wrapper rejects too, and the outer transaction still commits", async () => {
    let inner: unknown;
    const outer = await app
      .withTenant(A.clinicId, async () => {
        inner = await app
          .ping()
          .then(() => undefined)
          .catch((error: unknown) => error);
        return "outer survived";
      })
      .catch((error: unknown) => error);
    expect(inner).toBeInstanceOf(TypeError);
    expect((inner as TypeError).message).toMatch(/nested database work/);
    expect(outer).toBe("outer survived");
  });
});

describe("nesting is refused per Database instance, not globally", () => {
  it("platform work inside app work runs — two roles, two pools, no deadlock", async () => {
    // الرفض موجود عشان pool من size 1 بيموت لحد ما الـ idle timeout يقتل الـ transaction
    // الخارجة. ده مش بيحصل مع دور تاني: ده pool تاني و connection تانية خالص. ومنعّيه كان
    // هيعطّل شغل شرعي (onboarding جوه transaction تانية، قراءة platform جوه شغل app).
    const platform = createDatabase({
      url: TEST_URLS.platformUrl,
      role: "eyadex_platform",
      ids: { newId: () => newTestId() },
      maxConnections: 2,
    });
    try {
      const seen = await app.withTenant(A.clinicId, async (tx) => {
        const clinics = await platform.withNoTenant(async (other) => {
          const rows = await other.execute<{ id: string }>(
            sql`SELECT id FROM clinics WHERE id IN (${idList([A.clinicId, B.clinicId])}) ORDER BY id`,
          );
          return rows.map((row) => row.id);
        });
        const mine = await tx.execute<{ id: string }>(
          sql`SELECT id FROM patients WHERE id IN (${idList([A.patientId, B.patientId])}) ORDER BY id`,
        );
        return { clinics, mine: mine.map((row) => row.id) };
      });
      // كل instance شاف حته: اللي شاف عيادتين شاف B كمان، واللي شاف A مفيش غير A
      expect(new Set(seen.clinics)).toEqual(new Set([A.clinicId, B.clinicId]));
      expect(seen.mine).toEqual([A.patientId]);
      // وبعد ما كل transaction قفلت، الاتنين رجعوا нормаAbsolutely
      expect(await ownPatients(B.clinicId)).toEqual([B.patientId]);
      await expect(platform.ping()).resolves.toBeUndefined();
    } finally {
      await platform.close();
    }
  });

  it("work scheduled inside fn that runs after the transaction is not refused as nested", async () => {
    let later: Promise<unknown> | undefined;
    await app.withTenant(A.clinicId, () => {
      // A timer created inside fn inherits its async context; it fires after the COMMIT.
      later = new Promise((resolve) => {
        setTimeout(() => {
          app.withNoTenant(() => Promise.resolve("ran")).then(resolve, resolve);
        }, 50);
      });
      return Promise.resolve();
    });
    expect(await later).toBe("ran");
  });

  it("the same work scheduled inside fn is refused while the transaction is still open", async () => {
    let during: Promise<unknown> | undefined;
    await app.withTenant(A.clinicId, async (tx) => {
      during = new Promise((resolve) => {
        setTimeout(() => {
          app.withNoTenant(() => Promise.resolve("ran")).then(resolve, resolve);
        }, 50);
      });
      // the marker is still on, so this one is refused
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
      expect(await during).toBeInstanceOf(TypeError);
      expect(await tx.execute<{ one: number }>(sql`SELECT 1 AS one`)).toBeTruthy();
    });
  });
});
