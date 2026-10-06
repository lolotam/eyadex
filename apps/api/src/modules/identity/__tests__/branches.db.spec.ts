import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { branchDetailSchema, branchListResponseSchema } from "@eyadex/contracts/branches";

import {
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers, get } from "./access-fixtures.ts";
import {
  branchAction,
  branchAudit,
  code,
  createBranch,
  patchBranch,
  setMaxBranches,
} from "./branch-fixtures.ts";

// RBAC-01, ISO-02, AUD-01 and idempotency for /v1/branches (ADR-0011).
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let B: Awaited<ReturnType<typeof clinicWithMembers>>;

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  B = await clinicWithMembers(h);
  await setMaxBranches(h, A.admin.clinicId, 50);
  await setMaxBranches(h, B.admin.clinicId, 50);
});

afterAll(async () => {
  await closeHarness(h);
});

describe("RBAC-01: every branch endpoint", () => {
  const id = () => A.doctor.branchId;
  const calls = {
    list: (cookie?: string, host?: string) => get(h, "/v1/branches", cookie, host),
    create: (cookie?: string, host?: string) => createBranch(h, cookie, undefined, undefined, host),
    update: (cookie?: string, host?: string) =>
      patchBranch(h, cookie, id(), { nameEn: "Renamed" }, host),
    deactivate: (cookie?: string, host?: string) =>
      branchAction(h, cookie, id(), "deactivate", host),
    reactivate: (cookie?: string, host?: string) =>
      branchAction(h, cookie, id(), "reactivate", host),
  };

  for (const [name, run] of Object.entries(calls)) {
    it(`${name}: a role without the key gets 403`, async () => {
      const res = await run(A.doctor.cookie);
      expect(res.statusCode).toBe(403);
      expect(code(res)).toBe("forbidden");
    });
    it(`${name}: no session gets 401`, async () => {
      expect((await run()).statusCode).toBe(401);
    });
    it(`${name}: the platform host gets 404`, async () => {
      expect((await run(A.admin.cookie, PLATFORM)).statusCode).toBe(404);
    });
  }
});

describe("create, update, list (AUD-01)", () => {
  it("creates a branch with contact details and one allowlisted audit row", async () => {
    const res = await createBranch(h, A.admin.cookie, {
      nameAr: "فرع السالمية",
      nameEn: "Salmiya",
      address: "  Block 4  ",
      phone: "",
    });
    expect(res.statusCode).toBe(201);
    const branch = branchDetailSchema.strict().parse(res.json());
    expect(branch).toMatchObject({ address: "Block 4", phone: null, isActive: true });
    const audit = await branchAudit(h, A.admin.clinicId, branch.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "branch.created",
      category: "administrative",
      actor_user_id: A.admin.userId,
      details: {
        after: {
          nameAr: "فرع السالمية",
          nameEn: "Salmiya",
          address: "Block 4",
          phone: null,
          isActive: true,
        },
      },
    });
    expect(Object.keys(audit[0]!["details"] as object)).toEqual(["after"]);
  });

  it("updates names/address/phone with one before/after audit row; a no-op writes nothing", async () => {
    const created = (await createBranch(h, A.admin.cookie)).json() as { id: string };
    const res = await patchBranch(h, A.admin.cookie, created.id, { phone: "+96512345678" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ phone: "+96512345678" });
    expect(
      (await patchBranch(h, A.admin.cookie, created.id, { phone: "+96512345678" })).statusCode,
    ).toBe(200);
    const audit = await branchAudit(h, A.admin.clinicId, created.id);
    expect(audit.map((r) => r["action"])).toEqual(["branch.created", "branch.updated"]);
    // The append-only audit never keeps a full phone number: last 3 digits only.
    expect(audit[1]!["details"]).toMatchObject({
      before: { phone: null },
      after: { phone: "***678" },
    });
    expect(JSON.stringify(audit)).not.toContain("12345678");
  });

  it("free text in the audit snapshot is redacted when it carries a secret", async () => {
    const created = (await createBranch(h, A.admin.cookie)).json() as { id: string };
    const res = await patchBranch(h, A.admin.cookie, created.id, {
      address: "password=hunter2-not-real",
    });
    expect(res.statusCode).toBe(200);
    const audit = await branchAudit(h, A.admin.clinicId, created.id);
    expect(JSON.stringify(audit.at(-1)!["details"])).not.toContain("hunter2-not-real");
  });

  it("a phone number typed into a name or the address is masked in the audit", async () => {
    const created = (await createBranch(h, A.admin.cookie)).json() as { id: string };
    const res = await patchBranch(h, A.admin.cookie, created.id, {
      nameEn: "Salmiya +96512345678",
      address: "Block 4, call 5551 2345",
    });
    expect(res.statusCode).toBe(200);
    const audit = await branchAudit(h, A.admin.clinicId, created.id);
    const details = JSON.stringify(audit.at(-1)!["details"]);
    expect(details).not.toContain("12345678");
    expect(details).not.toContain("5551 2345");
    expect(details).toContain("***678");
    expect(details).toContain("***345");
  });

  it("rejects an empty PATCH and unknown fields", async () => {
    const id = A.doctor.branchId;
    expect(code(await patchBranch(h, A.admin.cookie, id, {}))).toBe("validation");
    expect(code(await patchBranch(h, A.admin.cookie, id, { isActive: false }))).toBe("validation");
  });

  it("lists with status filter, name search, cursor pages and a separate total", async () => {
    const tag = randomUUID().slice(0, 6);
    for (const n of [1, 2, 3]) {
      await createBranch(h, A.admin.cookie, { nameAr: "ف", nameEn: `Find_${tag} ${n}` });
    }
    const first = await get(h, `/v1/branches?search=find_${tag}&limit=2`, A.admin.cookie);
    const page = branchListResponseSchema.parse(first.json());
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
    const second = branchListResponseSchema.parse(
      (
        await get(
          h,
          `/v1/branches?search=find_${tag}&limit=2&cursor=${page.nextCursor}`,
          A.admin.cookie,
        )
      ).json(),
    );
    expect(second.items).toHaveLength(1);
    expect(second.total).toBe(3);
    expect(second.nextCursor).toBeNull();
    // `_` is literal in the search, not a wildcard.
    const literal = await get(h, `/v1/branches?search=find${tag}`, A.admin.cookie);
    expect(branchListResponseSchema.parse(literal.json()).total).toBe(0);
    const inactive = await get(h, "/v1/branches?status=inactive", A.admin.cookie);
    expect(branchListResponseSchema.parse(inactive.json()).items.every((b) => !b.isActive)).toBe(
      true,
    );
  });
});

describe("idempotency on create", () => {
  it("same key + same body → the same branch, one row, one audit row", async () => {
    const key = randomUUID();
    const body = { nameAr: "ف", nameEn: `Idem ${key.slice(0, 6)}` };
    const one = await createBranch(h, A.admin.cookie, body, key);
    const two = await createBranch(h, A.admin.cookie, body, key);
    expect(one.statusCode).toBe(201);
    expect(two.statusCode).toBe(201);
    expect(two.json().id).toBe(one.json().id);
    const rows = await h.owner`SELECT id FROM branches WHERE name_en = ${body.nameEn}`;
    expect(rows).toHaveLength(1);
    expect(await branchAudit(h, A.admin.clinicId, one.json().id)).toHaveLength(1);
  });

  it("same key + another body → idempotency_conflict", async () => {
    const key = randomUUID();
    await createBranch(h, A.admin.cookie, { nameAr: "ف", nameEn: "First" }, key);
    const res = await createBranch(h, A.admin.cookie, { nameAr: "ف", nameEn: "Second" }, key);
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("idempotency_conflict");
  });

  it("requires the header", async () => {
    const res = await createBranch(h, A.admin.cookie, undefined, "");
    expect(code(res)).toBe("validation");
  });
});

describe("ISO-02: clinic A never reaches clinic B's branches", () => {
  it("read, update, deactivate and reactivate of B's branch answer 404", async () => {
    const theirs = B.doctor.branchId;
    expect((await patchBranch(h, A.admin.cookie, theirs, { nameEn: "x" })).statusCode).toBe(404);
    expect((await branchAction(h, A.admin.cookie, theirs, "deactivate")).statusCode).toBe(404);
    expect((await branchAction(h, A.admin.cookie, theirs, "reactivate")).statusCode).toBe(404);
    const [row] = await h.owner`SELECT name_en, is_active FROM branches WHERE id = ${theirs}`;
    expect(row).toMatchObject({ name_en: "Branch", is_active: true });
  });

  it("the list never shows B's rows", async () => {
    const list = branchListResponseSchema.parse(
      (await get(h, "/v1/branches?limit=100", A.admin.cookie)).json(),
    );
    const theirs = await h.owner`SELECT id FROM branches WHERE clinic_id = ${B.admin.clinicId}`;
    const ids = new Set(list.items.map((b) => b.id));
    for (const row of theirs) expect(ids.has(row["id"] as string)).toBe(false);
  });

  it("a malformed id is 404, like an unknown one", async () => {
    expect((await branchAction(h, A.admin.cookie, "nope", "deactivate")).statusCode).toBe(404);
  });
});
