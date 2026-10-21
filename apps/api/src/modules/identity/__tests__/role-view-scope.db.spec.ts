import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { roleSummarySchema } from "@eyadex/contracts/access";

import {
  APP,
  call,
  closeHarness,
  openHarness,
  type Harness,
} from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "./access-fixtures.ts";
import { code } from "./branch-fixtures.ts";
import { createRole, names, patchRole, roleAction, roleAudit, roleRow } from "./role-fixtures.ts";
import { customRole } from "./user-fixtures.ts";

// Issue #93: a write key needs a view key whose scope covers it. A role stored before the rule is read
// as it is and refused only on its next save; nothing rewrites it.
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;

const NARROW = ["create:payments:clinic", "view:payments:branch"];
const WIDENED = ["create:payments:clinic", "view:payments:clinic"];

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  // Finance keys are dropped from a save while the module is off (FLAG-02), so it is switched on here.
  await h.owner`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
                VALUES (${A.admin.clinicId}, gen_random_uuid(), 'finance', true, now())
                ON CONFLICT (clinic_id, module) DO UPDATE SET enabled = true`;
});

afterAll(async () => {
  await closeHarness(h);
});

describe("the view-scope rule on the role API", () => {
  it.each([
    ["payments", NARROW],
    ["refunds through payments", ["view:payments:branch", "create:refunds:clinic"]],
    ["cash closings", ["view:cash_closings:branch", "create:cash_closings:clinic"]],
    ["invoices", ["view:invoices:branch", "create:invoices:clinic"]],
  ])("NEGATIVE: create refuses a %s write wider than its view", async (_label, keys) => {
    const body = { ...names(), permissionKeys: keys };
    const res = await createRole(h, A.admin.cookie, body);
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe("validation");
    expect(await h.owner`SELECT id FROM roles WHERE name_en = ${body.nameEn}`).toHaveLength(0);
  });

  it("create accepts the same keys once the view covers the write", async () => {
    const res = await createRole(h, A.admin.cookie, { ...names(), permissionKeys: WIDENED });
    expect(res.statusCode).toBe(201);
    expect(roleSummarySchema.parse(res.json()).permissionKeys).toEqual(WIDENED);
  });

  it("a stored role that breaks the rule is listed untouched and refused on its next save", async () => {
    const id = await customRole(h, A.admin.clinicId, NARROW);
    const list = await call(h, {
      method: "GET",
      url: "/v1/roles?limit=100",
      host: APP,
      cookie: A.admin.cookie,
    });
    expect(list.statusCode).toBe(200);
    const listed = (list.json() as { items: { id: string; permissionKeys: string[] }[] }).items;
    expect(listed.find((r) => r.id === id)?.permissionKeys).toEqual(NARROW);

    // Any save sends the whole key set, so a rename alone is refused too until the view is widened.
    const row = await roleRow(h, id);
    const same = { nameAr: row.name_ar, nameEn: row.name_en, permissionKeys: NARROW };
    const refused = await patchRole(h, A.admin.cookie, id, { ...same, nameEn: `${row.name_en} 2` });
    expect(refused.statusCode).toBe(400);
    expect(code(refused)).toBe("validation");
    expect((await roleRow(h, id)).keys).toEqual(NARROW);
    expect(await roleAudit(h, A.admin.clinicId, id)).toHaveLength(0);

    // Status changes carry no keys, so they still work on the stored role.
    expect((await roleAction(h, A.admin.cookie, id, "deactivate")).statusCode).toBe(200);
    expect((await roleAction(h, A.admin.cookie, id, "reactivate")).statusCode).toBe(200);

    const fixed = await patchRole(h, A.admin.cookie, id, { ...same, permissionKeys: WIDENED });
    expect(fixed.statusCode).toBe(200);
    expect((await roleRow(h, id)).keys).toEqual(WIDENED);
  });
});
