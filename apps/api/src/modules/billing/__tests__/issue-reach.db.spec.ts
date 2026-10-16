import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import { financeClinic, setPrefixes, type FinanceClinic } from "./billing-fixtures.ts";

// PR #78 review (R1-7, ISO-02): a clinic-wide create key does not widen the patients reach. A manual
// invoice for a file outside the caller's `view:patients` branches is not_found, as if it did not exist.
let h: Harness;
let C: FinanceClinic;
let clerk: { cookie: string };

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
  const role = await customRole(h, C.clinicId, [
    "view:patients:branch",
    "view:invoices:clinic",
    "create:invoices:clinic",
  ]);
  clerk = await memberOn(h, C.admin, role, { allBranches: false, branchIds: [C.branchD] });
  await invalidate.clinicChanged(C.clinicId);
});

afterAll(() => closeHarness(h));

const manual = (patientId: string, branchId: string) =>
  send(
    h,
    clerk.cookie,
    "POST",
    "/v1/invoices",
    {
      source: "manual",
      sourceId: null,
      patientId,
      branchId,
      lines: [
        {
          kind: "free",
          descriptionAr: "جلسة",
          descriptionEn: "Session",
          quantity: 1,
          unitPriceMinor: "1000",
          discount: null,
        },
      ],
      invoiceDiscount: null,
    },
    randomUUID(),
  );

describe("a manual invoice from a clinic-wide create key", () => {
  it("is not_found for a patient outside the caller's patients branches", async () => {
    const outside = await patientIn(h, C, C.branchR);
    const res = await manual(outside, C.branchR);
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
  });

  it("is issued for a patient inside them", async () => {
    const inside = await patientIn(h, C, C.branchD);
    expect((await manual(inside, C.branchD)).statusCode).toBe(201);
  });
});
