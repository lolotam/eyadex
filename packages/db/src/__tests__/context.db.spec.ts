import { sql } from "drizzle-orm";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, TenantContextViolationError, type Database, type Tx } from "../index.ts";
import {
  createOwner,
  idList,
  newTestId,
  roleOf,
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
    maxConnections: 2,
  });
});

afterAll(async () => {
  await app.close();
  await owner.end();
});

const insertBranch = (tx: Tx, clinicId: string, probe: string): Promise<unknown> =>
  tx.execute(sql`
    INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
    VALUES (${clinicId}, ${probe}, 'اسم', 'Branch', true, now(), now())
  `);

const ownPatients = async (tx: Tx): Promise<string[]> => {
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM patients WHERE id IN (${idList([A.patientId, B.patientId])}) ORDER BY id`,
  );
  return rows.map((row) => row.id);
};

describe("fn cannot re-point the clinic", () => {
  it("rejects the transaction and keeps nothing written under the other clinic", async () => {
    const probe = newTestId();
    let failure: unknown;
    try {
      await app.withTenant(A.clinicId, async (tx) => {
        await tx.execute(sql`SELECT set_config('app.clinic_id', ${B.clinicId}, true)`);
        // من هنا الشغل بقى على عيادة تانية من غير ما الـ wrapper يعرف
        await insertBranch(tx, B.clinicId, probe);
        return "leaked";
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("clinic");
    const leaked = await owner`SELECT id FROM branches WHERE id = ${probe}`;
    expect(leaked).toHaveLength(0);
  });

  it("names the breach and never the clinic ids it read", async () => {
    let failure: Error | undefined;
    try {
      await app.withTenant(A.clinicId, (tx) =>
        tx.execute(sql`SELECT set_config('app.clinic_id', ${B.clinicId}, true)`),
      );
    } catch (error) {
      failure = error as Error;
    }
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect(failure?.message).not.toContain(A.clinicId);
    expect(failure?.message).not.toContain(B.clinicId);
  });

  it("withNoTenant loses an injected clinic too — '' is not any clinic's id", async () => {
    let failure: unknown;
    try {
      await app.withNoTenant((tx) =>
        tx.execute(sql`SELECT set_config('app.clinic_id', ${A.clinicId}, true)`),
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TenantContextViolationError);
  });
});

describe("fn cannot end the transaction by hand", () => {
  it("a COMMIT inside fn rejects even though fn itself resolved", async () => {
    let failure: unknown;
    try {
      await app.withTenant(A.clinicId, async (tx) => {
        await tx.execute(sql`COMMIT`);
        return "committed by hand";
      });
    } catch (error) {
      failure = error;
    }
    // الـ COMMIT بيرمي قيمة الـ transaction-local بعيد، فالـ closing check بيلاقي
    // current_setting('app.clinic_id') بـ NULL ويرفض. مفيش شغل اتكتب هنا يبقى متأثر — لو كان في
    // شغل قبل الـ COMMIT بيكمل، وده بالظبط السبب اللي الـ RLS لوحده مش كافي.
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("clinic");
  });

  it("a ROLLBACK inside fn rejects as well", async () => {
    let failure: unknown;
    try {
      await app.withTenant(A.clinicId, async (tx) => {
        await tx.execute(sql`ROLLBACK`);
        return "rolled back by hand";
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TenantContextViolationError);
  });

  it("the pool is still usable after a refused hand-rolled COMMIT", async () => {
    const seen = await app.withTenant(A.clinicId, (tx) => ownPatients(tx));
    expect(seen).toEqual([A.patientId]);
  });
});

describe("fn cannot loosen the time bound", () => {
  it("SET statement_timeout = 0 inside fn rejects", async () => {
    let failure: unknown;
    try {
      await app.withTenant(A.clinicId, (tx) => tx.execute(sql`SET statement_timeout = 0`));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("statement-timeout");
  });

  it("SET idle_in_transaction_session_timeout = 0 inside fn rejects", async () => {
    let failure: unknown;
    try {
      await app.withTenant(A.clinicId, (tx) =>
        tx.execute(sql`SET idle_in_transaction_session_timeout = 0`),
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TenantContextViolationError);
    expect((failure as TenantContextViolationError).breach).toBe("idle-timeout");
  });
});

describe("fn cannot reach a more powerful role", () => {
  it("SET ROLE to the owner is refused by the server — no membership, no switch", async () => {
    let failure: { code?: string } | undefined;
    try {
      // `SET ROLE` needs membership. The opening check refuses any membership at all, so eyadex_app
      // cannot become eyadex_owner (or any BYPASSRLS role) — the server turns this down itself.
      await app.withTenant(A.clinicId, (tx) =>
        tx.execute(sql`SET ROLE ${sql.identifier(roleOf(TEST_URLS.ownerUrl))}`),
      );
    } catch (error) {
      failure = error as { code?: string };
    }
    expect(failure?.code).toBe("42501");
  });

  it("SET SESSION AUTHORIZATION to the owner is refused too — it needs superuser", async () => {
    let failure: { code?: string } | undefined;
    try {
      await app.withTenant(A.clinicId, (tx) =>
        tx.execute(sql`SET SESSION AUTHORIZATION ${sql.identifier(roleOf(TEST_URLS.ownerUrl))}`),
      );
    } catch (error) {
      failure = error as { code?: string };
    }
    expect(failure?.code).toBe("42501");
  });

  it("setting the role back to itself is a no-op the closing check sees through", async () => {
    // Legal, and harmless: current_user and session_user are unchanged, so the wrapper commits.
    const result = await app.withTenant(A.clinicId, async (tx) => {
      await tx.execute(sql`SET ROLE ${sql.identifier(roleOf(TEST_URLS.appUrl))}`);
      return await ownPatients(tx);
    });
    expect(result).toEqual([A.patientId]);
  });

  it("the pool still runs for the right role afterwards", async () => {
    const seen = await app.withTenant(A.clinicId, (tx) => ownPatients(tx));
    expect(seen).toEqual([A.patientId]);
  });
});

describe("wrappers never nest", () => {
  it("a wrapper called from inside another one rejects before taking a connection", async () => {
    let inner: unknown;
    const outer = await app
      .withTenant(A.clinicId, async (tx) => {
        inner = await app
          .withNoTenant(() => Promise.resolve("never"))
          .then(() => undefined)
          .catch((error: unknown) => error);
        return await ownPatients(tx);
      })
      .catch((error: unknown) => error);
    expect(inner).toBeInstanceOf(TypeError);
    expect((inner as TypeError).message).toMatch(/nested database work/);
    // الـ transaction الخارجية ما تأثّرتش بالـ call المرفوض جواها
    expect(outer).toEqual([A.patientId]);
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
