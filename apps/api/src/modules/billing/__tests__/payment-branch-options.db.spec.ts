import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { setModule } from "../../medical/__tests__/medical-fixtures.ts";
import { financeClinic, type FinanceClinic } from "./billing-fixtures.ts";

// Finance F2 (spec §4.6): the branches the receipts screen names and filters by. `view:payments` alone
// is enough — the reader does not need `view:branches` — and the reach is the payments reach.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;

type BranchOption = { id: string; nameAr: string; nameEn: string; isActive: boolean };
type BranchPage = { items: BranchOption[]; nextCursor: string | null; total: number };

/** GET /v1/payments/branch-options, as the caller sees it. */
const options = (cookie: string, query = "") =>
  send(h, cookie, "GET", `/v1/payments/branch-options${query}`);

/** The clinic's three branches, sorted the way the option list sorts its ids. */
const everyBranch = () => [C.branchD, C.branchR, C.branchX].sort();

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
});

afterAll(() => closeHarness(h));

describe("the branches of the receipts screen (spec §4.6)", () => {
  it("names every branch of the clinic to a clinic-scope payments reader", async () => {
    const res = await options(C.admin.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as BranchPage;
    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.id).sort()).toEqual(everyBranch());
  });

  it("names the branches of the member only to a branch-scope reader", async () => {
    const res = await options(C.receptionist.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as BranchPage;
    expect(page.items.map((item) => item.id)).toEqual([C.branchR]);
    expect(page.total).toBe(1);
  });

  it("refuses a member without view:payments", async () => {
    const res = await options(C.doctor.cookie);
    expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
  });

  it("never names another clinic's branches", async () => {
    const other = await clinicWithMembers(h);
    await setModule(h, invalidate, other.admin.clinicId, "finance", true);
    const theirs = await options(other.admin.cookie);
    expect(theirs.statusCode, theirs.body).toBe(200);
    const theirPage = theirs.json() as BranchPage;
    expect(theirPage.items.map((item) => item.id)).toEqual([other.doctor.branchId]);
    const ours = await options(C.admin.cookie);
    expect(ours.statusCode, ours.body).toBe(200);
    const ourPage = ours.json() as BranchPage;
    expect(ourPage.items.map((item) => item.id)).not.toContain(other.doctor.branchId);
  });

  it("names a branch closed after its receipts, so the receipts stay named", async () => {
    await h.owner`UPDATE branches SET is_active = false, updated_at = now()
                   WHERE clinic_id = ${C.clinicId} AND id = ${C.branchX}`;
    const res = await options(C.admin.cookie);
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as BranchPage;
    expect(page.total).toBe(3);
    expect(page.items.find((item) => item.id === C.branchX)).toMatchObject({ isActive: false });
  });

  it("pages with a cursor and refuses a cursor it never made", async () => {
    const first = await options(C.admin.cookie, "?limit=1");
    expect(first.statusCode, first.body).toBe(200);
    const one = first.json() as BranchPage;
    expect(one.items).toHaveLength(1);
    expect(one.nextCursor).toBeTypeOf("string");
    const second = await options(C.admin.cookie, `?limit=1&cursor=${one.nextCursor}`);
    expect(second.statusCode, second.body).toBe(200);
    const two = second.json() as BranchPage;
    expect(two.items).toHaveLength(1);
    expect(two.items[0]!.id).not.toBe(one.items[0]!.id);
    expect(two.nextCursor).toBeTypeOf("string");
    const third = await options(C.admin.cookie, `?limit=1&cursor=${two.nextCursor}`);
    expect(third.statusCode, third.body).toBe(200);
    const three = third.json() as BranchPage;
    expect(three.items).toHaveLength(1);
    expect(three.nextCursor).toBeNull();
    const ids = [one, two, three].flatMap((page) => page.items.map((item) => item.id));
    expect(ids.sort()).toEqual(everyBranch());
    const bad = await options(C.admin.cookie, "?cursor=not-a-cursor");
    expect([bad.statusCode, code(bad)]).toEqual([400, "validation"]);
  });
});
