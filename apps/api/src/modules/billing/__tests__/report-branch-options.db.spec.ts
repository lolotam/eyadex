import { randomUUID } from "node:crypto";
import { branchOptionListResponseSchema } from "@eyadex/contracts/role-admin";
import type { Database, Tx } from "@eyadex/db";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { DATABASE } from "../../../shared/database.provider.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { call, closeHarness, PLATFORM } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { setModule } from "../../medical/__tests__/medical-fixtures.ts";
import { PgFilingBranches } from "../../tenancy/persistence/pg-filing-branches.ts";
import { CLOCK, type Clock } from "../../tenancy/index.ts";
import { listReportBranchOptions } from "../queries/report-branch-options.ts";
import { reportFixture, type ReportFixture } from "./report-fixtures.ts";

const cases = [
  ["daily-takings", ["view:report_takings:branch", "view:payments:branch"], false],
  [
    "period-summary",
    ["view:report_takings:branch", "view:invoices:branch", "view:payments:branch"],
    false,
  ],
  ["by-service", ["view:report_analytics:branch", "view:invoices:branch"], false],
  ["by-doctor", ["view:report_analytics:branch", "view:invoices:branch"], false],
  ["outstanding", ["view:report_patients:branch", "view:invoices:branch"], false],
  ["patient-credit", ["view:report_patients:clinic", "view:payments:clinic"], true],
  ["refunds", ["view:report_patients:branch", "view:payments:branch"], false],
  ["discounts", ["view:report_patients:branch", "view:invoices:branch"], false],
  ["cash-closings", ["view:report_takings:branch", "view:cash_closings:branch"], false],
  ["own-summary", ["view:report_own:own", "view:invoices:own"], true],
] as const;

let f: ReportFixture;
let roleId: string;
let reader: Awaited<ReturnType<typeof memberOn>>;
const allIds = () => [f.C.branchD, f.C.branchR, f.C.branchX].sort();
const options = (route: string, cookie = reader.cookie, query = "") =>
  send(f.h, cookie, "GET", `/v1/finance-reports/${route}/branch-options${query}`);

async function keys(values: readonly string[]) {
  await f.h.owner.begin(async (tx) => {
    await tx`DELETE FROM role_permissions WHERE clinic_id = ${f.C.clinicId} AND role_id = ${roleId}`;
    for (const key of values)
      await tx`INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
        SELECT ${f.C.clinicId}, ${randomUUID()}, ${roleId}, id, now() FROM permissions WHERE key = ${key}`;
  });
  await f.invalidate.clinicChanged(f.C.clinicId);
}

beforeAll(async () => {
  f = await reportFixture();
  roleId = await customRole(f.h, f.C.clinicId, []);
  reader = await memberOn(f.h, f.C.admin, roleId, { allBranches: false, branchIds: [f.C.branchR] });
  await f.invalidate.clinicChanged(f.C.clinicId);
}, 120_000);
afterAll(() => closeHarness(f?.h));

it.each(cases)(
  "%s names only report-reachable branches without unrelated keys",
  async (route, grants, all) => {
    await keys(grants);
    const res = await options(route);
    expect(res.statusCode, res.body).toBe(200);
    const page = branchOptionListResponseSchema.parse(res.json());
    expect(page.items.map((b) => b.id).sort()).toEqual(all ? allIds() : [f.C.branchR]);
    expect(page.total).toBe(all ? 3 : 1);
    for (const branch of page.items) {
      expect(Object.keys(branch).sort()).toEqual(["id", "isActive", "nameAr", "nameEn"]);
      expect(branch.nameAr).not.toBe("");
      expect(branch.nameEn).not.toBe("");
    }
  },
);

it.each(cases)("%s requires every covering key, not just the route key", async (route, grants) => {
  for (const missing of grants.slice(1)) {
    await keys(grants.filter((key) => key !== missing));
    const res = await options(route);
    expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
  }
});

it("does not widen analytics reach with an unrelated clinic grant or fall back from uncovered clinic scope", async () => {
  await keys(["view:report_analytics:branch", "view:invoices:branch", "view:payments:clinic"]);
  const res = await options("by-service");
  expect(branchOptionListResponseSchema.parse(res.json()).items.map((b) => b.id)).toEqual([
    f.C.branchR,
  ]);
  await keys([
    "view:report_analytics:clinic",
    "view:report_analytics:branch",
    "view:invoices:branch",
  ]);
  const denied = await options("by-service");
  expect([denied.statusCode, code(denied)]).toEqual([403, "forbidden"]);
});

it("keeps inactive historical branches and stable pagination, without a new audit event", async () => {
  await f.h
    .owner`UPDATE branches SET is_active = false WHERE clinic_id = ${f.C.clinicId} AND id = ${f.C.branchX}`;
  await f.invalidate.clinicChanged(f.C.clinicId);
  await keys(["view:report_analytics:clinic", "view:invoices:clinic"]);
  const [before] = await f.h
    .owner`SELECT count(*)::int AS n FROM audit_log WHERE clinic_id = ${f.C.clinicId}`;
  let cursor: string | null = null;
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const res = await options(
      "by-service",
      reader.cookie,
      `?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
    );
    expect(res.statusCode, res.body).toBe(200);
    const page = branchOptionListResponseSchema.parse(res.json());
    expect(page.total).toBe(3);
    ids.push(...page.items.map((b) => b.id));
    if (page.items[0]?.id === f.C.branchX) expect(page.items[0].isActive).toBe(false);
    cursor = page.nextCursor;
  }
  expect(ids).toEqual(allIds());
  expect(cursor).toBeNull();
  for (const query of ["?cursor=bad", "?limit=0", "?limit=101"])
    expect((await options("by-service", reader.cookie, query)).statusCode).toBe(400);
  const foreign = await options(
    "by-service",
    reader.cookie,
    `?cursor=${f.other.branchD.replaceAll("-", "")}`,
  );
  expect(
    branchOptionListResponseSchema
      .parse(foreign.json())
      .items.every((b) => allIds().includes(b.id)),
  ).toBe(true);
  const [after] = await f.h
    .owner`SELECT count(*)::int AS n FROM audit_log WHERE clinic_id = ${f.C.clinicId}`;
  expect(after).toEqual(before);
});

it("checks route permission before query, and covering permissions after query validation", async () => {
  await keys([]);
  let res = await options("by-service", reader.cookie, "?limit=0");
  expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
  await keys(["view:report_analytics:branch"]);
  res = await options("by-service", reader.cookie, "?limit=0");
  expect([res.statusCode, code(res)]).toEqual([400, "validation"]);
  res = await options("by-service");
  expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
});

it("applies current account, role, clinic and module guard order, and refuses platform access", async () => {
  await keys(["view:report_analytics:branch", "view:invoices:branch"]);
  const check = async (expected: string, status = 403) => {
    const res = await options("by-service", reader.cookie, "?limit=0");
    expect([res.statusCode, code(res)]).toEqual([status, expected]);
  };
  await setModule(f.h, f.invalidate, f.C.clinicId, "finance", false);
  try {
    await check("module_disabled");
  } finally {
    await setModule(f.h, f.invalidate, f.C.clinicId, "finance", true);
  }
  await f.h.owner`UPDATE clinics SET status = 'suspended' WHERE id = ${f.C.clinicId}`;
  await f.invalidate.clinicChanged(f.C.clinicId);
  try {
    await check("subscription_blocked");
  } finally {
    await f.h.owner`UPDATE clinics SET status = 'active' WHERE id = ${f.C.clinicId}`;
    await f.invalidate.clinicChanged(f.C.clinicId);
  }
  await f.h
    .owner`UPDATE roles SET is_active = false WHERE clinic_id = ${f.C.clinicId} AND id = ${roleId}`;
  await f.invalidate.clinicChanged(f.C.clinicId);
  try {
    await check("forbidden");
  } finally {
    await f.h
      .owner`UPDATE roles SET is_active = true WHERE clinic_id = ${f.C.clinicId} AND id = ${roleId}`;
    await f.invalidate.clinicChanged(f.C.clinicId);
  }
  await f.h
    .owner`UPDATE memberships SET status = 'deactivated' WHERE clinic_id = ${f.C.clinicId} AND id = ${reader.memberId}`;
  await f.invalidate.clinicChanged(f.C.clinicId);
  try {
    await check("account_disabled", 401);
  } finally {
    await f.h
      .owner`UPDATE memberships SET status = 'active' WHERE clinic_id = ${f.C.clinicId} AND id = ${reader.memberId}`;
    await f.invalidate.clinicChanged(f.C.clinicId);
  }
  const platform = await call(f.h, {
    method: "GET",
    host: PLATFORM,
    cookie: reader.cookie,
    url: "/v1/finance-reports/by-service/branch-options",
  });
  expect([401, 403, 404]).toContain(platform.statusCode);
  expect(platform.body).not.toContain(f.C.branchR);
});

it("judges clinic expiry on the injected clock at the exact exclusive boundary", async () => {
  await keys(["view:report_analytics:branch", "view:invoices:branch"]);
  const [row] = await f.h.owner`SELECT expires_at FROM clinics WHERE id = ${f.C.clinicId}`;
  const expiry = new Date(row!["expires_at"] as string).getTime();
  const clock = vi.spyOn(f.h.app.get<Clock>(CLOCK), "now");
  try {
    clock.mockReturnValue(new Date(expiry - 1));
    expect((await options("by-service")).statusCode).toBe(200);
    clock.mockReturnValue(new Date(expiry));
    const res = await options("by-service", reader.cookie, "?limit=0");
    expect([res.statusCode, code(res)]).toEqual([403, "subscription_blocked"]);
  } finally {
    clock.mockRestore();
  }
});

it("isolates both HTTP and the actual tenancy branch reader under eyadex_app, including no tenant", async () => {
  const theirs = await options("by-service", f.other.admin.cookie);
  const page = branchOptionListResponseSchema.parse(theirs.json());
  expect(page.items.map((b) => b.id).sort()).toEqual(
    [f.other.branchD, f.other.branchR, f.other.branchX].sort(),
  );
  expect(page.items.some((b) => allIds().includes(b.id))).toBe(false);
  const db = f.h.app.get<Database>(DATABASE);
  const reach = { scope: "clinic", branches: { all: true } } as const;
  const load = (clinic: string) => (tx: Tx) =>
    listReportBranchOptions(tx, clinic, reach, { limit: 20 }, new PgFilingBranches());
  expect((await db.withTenant(f.C.clinicId, load(f.C.clinicId))).total).toBe(3);
  expect((await db.withTenant(f.C.clinicId, load(f.other.clinicId))).total).toBe(0);
  expect((await db.withNoTenant(load(f.C.clinicId))).total).toBe(0);
});
