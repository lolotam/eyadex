import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../index.ts";
import {
  createOwner,
  newTestId,
  runAsOwner,
  secretsOf,
  seedTwoClinics,
  TEST_URLS,
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

describe("a connection string that is not the declared role is refused", () => {
  it("a role that differs only in case is reported as another role, not as a changed one", async () => {
    // الاسم متقتبس عمداً: PostgreSQL بيفرّغ الحروف الكبيرة في الأسماء غير المقتبسة، فالاسم
    // `EYADEX_APP` ده **دور تاني خالص** عن `eyadex_app` — وده بالظبط اللي بنختبره. والاتنين
    // مقتبسين في CREATE و DROP عشان الـ SQL متكسرش ولا يمسّ دور الـ runtime الحقيقي.
    const password = `t-${newTestId().replaceAll("-", "")}`;
    const url = `postgres://EYADEX_APP:${password}@${new URL(TEST_URLS.appUrl).host}/eyadex`;
    const differently = createDatabase({
      url,
      role: "eyadex_app",
      ids: { newId: () => A.clinicId },
    });
    let called = false;
    try {
      await runAsOwner(owner, 'DROP ROLE IF EXISTS "EYADEX_APP"');
      await runAsOwner(owner, `CREATE ROLE "EYADEX_APP" LOGIN NOBYPASSRLS PASSWORD '${password}'`);
      const failure = await differently
        .withTenant(A.clinicId, async () => {
          called = true;
          return "must not run";
        })
        .then(() => undefined)
        .catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      // "another role": الـ connection دخلت من الأساس بدور تاني. مش "role changed" — مفيش
      // SET ROLE حصل، والرسالة اللي بتقول كده كانت بتيجي من فحص خاطئ.
      expect((failure as Error).message).toMatch(/another role/);
      expect((failure as Error).message).not.toMatch(/role changed/);
      expect((failure as Error).message).toContain("eyadex_app");
      for (const secret of secretsOf(url)) {
        expect((failure as Error).message).not.toContain(secret);
      }
      expect(called).toBe(false);
      await expect(differently.ping()).rejects.toThrow(/another role/);
    } finally {
      await differently.close();
      await runAsOwner(owner, 'DROP ROLE IF EXISTS "EYADEX_APP"');
    }
  });

  it("the owner URL under role eyadex_app never runs fn", async () => {
    const privileged = createDatabase({
      url: TEST_URLS.ownerUrl,
      role: "eyadex_app",
      ids: { newId: () => A.clinicId },
    });
    let called = false;
    const work = async (): Promise<string> => {
      called = true;
      return A.clinicId;
    };
    try {
      const failure = await privileged
        .withTenant(A.clinicId, work)
        .then(() => undefined)
        .catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      // بتسمّي الدور المتوقّع وبس: لا الرابط ولا كلمة السر ولا الـ host ولا المنفذ
      expect((failure as Error).message).toContain("eyadex_app");
      for (const secret of secretsOf(TEST_URLS.ownerUrl)) {
        expect((failure as Error).message).not.toContain(secret);
      }
      const pingFailure = await privileged
        .ping()
        .then(() => undefined)
        .catch((error: Error) => error);
      expect(pingFailure).toBeInstanceOf(Error);
      for (const secret of secretsOf(TEST_URLS.ownerUrl)) {
        expect((pingFailure as Error).message).not.toContain(secret);
      }
      expect(called).toBe(false);
    } finally {
      await privileged.close();
    }
  });

  it("the platform URL under role eyadex_app is refused as a role mismatch", async () => {
    const mismatch = createDatabase({
      url: TEST_URLS.platformUrl,
      role: "eyadex_app",
      ids: { newId: () => A.clinicId },
    });
    let called = false;
    try {
      const failure = await mismatch
        .withTenant(A.clinicId, async () => {
          called = true;
          return "must not run";
        })
        .then(() => undefined)
        .catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("eyadex_app");
      for (const secret of secretsOf(TEST_URLS.platformUrl)) {
        expect((failure as Error).message).not.toContain(secret);
      }
      expect(called).toBe(false);
    } finally {
      await mismatch.close();
    }
  });
});

describe("ping and close", () => {
  it("ping resolves for the declared role, and close makes later calls reject", async () => {
    const app = createDatabase({
      url: TEST_URLS.appUrl,
      role: "eyadex_app",
      ids: { newId: () => A.clinicId },
    });
    await expect(app.ping()).resolves.toBeUndefined();
    await expect(app.withTenant(A.clinicId, async () => "committed")).resolves.toBe("committed");
    await expect(app.close()).resolves.toBeUndefined();
    await expect(app.ping()).rejects.toThrow();
    await expect(app.withTenant(A.clinicId, async () => "after close")).rejects.toThrow();
  });

  it("ping resolves for the platform role too", async () => {
    const platform = createDatabase({
      url: TEST_URLS.platformUrl,
      role: "eyadex_platform",
      ids: { newId: () => A.clinicId },
    });
    try {
      await expect(platform.ping()).resolves.toBeUndefined();
    } finally {
      await platform.close();
    }
  });
});
