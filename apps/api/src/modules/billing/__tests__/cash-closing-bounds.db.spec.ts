import { MAX_CASH_MINOR } from "@eyadex/contracts/money";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code } from "../../appointments/__tests__/scheduling-fixtures.ts";
import {
  financeClinic,
  namedPatient,
  previewClosing,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";
import { closingSteps } from "./money-fixtures.ts";

// Issue #100: an open period whose cash net leaves ±MAX_CASH_MINOR is a domain refusal on both the
// preview and the close, never a response its own schema refuses or a 500 from the closing's CHECK.
// No API call can reach the bound, so the owner role raises one receipt's amount to sit on it.
let h: Harness;
let C: FinanceClinic;
let steps: ReturnType<typeof closingSteps>;
let paymentId = "";

const setAmount = (amount: bigint) =>
  h.owner`UPDATE payments SET amount_minor = ${String(amount)}::bigint
          WHERE clinic_id = ${C.clinicId} AND id = ${paymentId}`;

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await financeClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  await setPrefixes(h, C);
  steps = closingSteps(h, C);
  const patient = await namedPatient(h, C, C.branchR, "مراجع الحد");
  paymentId = (await steps.paid(patient, "1000", "cash")).paymentId;
});

afterAll(() => closeHarness(h));

describe("the bound of the cash drawer (#100)", () => {
  it("previews an expectation that sits exactly on the bound", async () => {
    await setAmount(MAX_CASH_MINOR);
    const shown = await steps.preview();
    expect(shown.expectedMinor).toBe(String(MAX_CASH_MINOR));
  });

  it("refuses the preview and the close one unit past it, and writes no closing", async () => {
    const shown = await steps.preview();
    await setAmount(MAX_CASH_MINOR + 1n);
    const previewed = await previewClosing(h, C.admin.cookie, C.branchR);
    expect([previewed.statusCode, code(previewed)]).toEqual([409, "cash_drawer_out_of_range"]);
    const closed = await steps.closeWith(shown, "0", "Count beyond the bound");
    expect([closed.statusCode, code(closed)]).toEqual([409, "cash_drawer_out_of_range"]);
    const rows = await h.owner`SELECT count(*)::int AS n FROM cash_closings
                               WHERE clinic_id = ${C.clinicId}`;
    expect(rows[0]).toEqual({ n: 0 });
  });
});
