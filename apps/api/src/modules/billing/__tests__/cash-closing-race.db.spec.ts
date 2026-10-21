import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import {
  closeCash,
  financeClinic,
  manualInvoice,
  pay,
  previewClosing,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";
import { holdRows, raceOn } from "./race-fixtures.ts";

// Finance F2 slice 5 (spec §4.4, §4.8): a cash payment racing a closing of its branch. Both wait on the
// branch's drawer row, held here by an owner session, so they really race: the payment lands in this
// closing or after it — never in none and never in two — and the closing never covers cash it did not
// show (cash_drawer_changed). The closing takes no patient lock, so it never deadlocks with a payment.
let h: Harness;
let C: FinanceClinic;

type Preview = { previousClosingId: string | null; throughCashSeq: string; expectedMinor: string };

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

describe("a cash payment racing a closing of its branch (spec §4.8)", () => {
  it("puts the payment in exactly one period, whichever of the two wins the drawer", async () => {
    const patient = await patientIn(h, C, C.branchR);
    // A first cash payment creates the drawer row the owner session holds below.
    const before = await manualInvoice(h, C.admin.cookie, patient, C.branchR, "1000");
    expect(
      (await pay(h, C.admin.cookie, before.id, { method: "cash", amountMinor: "1000" })).statusCode,
    ).toBe(201);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchR, "2000");
    const shown = (await previewClosing(h, C.admin.cookie, C.branchR)).json() as Preview;
    expect(shown).toMatchObject({ throughCashSeq: "1", expectedMinor: "1000" });
    const holding = await holdRows(
      h,
      (sql) =>
        sql`SELECT id FROM branch_cash_drawers
          WHERE clinic_id = ${C.clinicId} AND branch_id = ${C.branchR} FOR UPDATE`,
    );
    const [payment, closing] = await raceOn(h, holding, 2, [
      () => pay(h, C.admin.cookie, invoice.id, { method: "cash", amountMinor: "2000" }),
      () =>
        closeCash(h, C.admin.cookie, {
          branchId: C.branchR,
          previousClosingId: shown.previousClosingId,
          throughCashSeq: shown.throughCashSeq,
          countedMinor: shown.expectedMinor,
        }),
    ]);
    expect(payment!.statusCode, payment!.body).toBe(201);
    const cashSeq = (payment!.json() as { payment: { cashSeq: string } }).payment.cashSeq;
    expect(cashSeq).toBe("2");
    const [drawer] =
      await h.owner`SELECT last_cash_seq::text AS cash, last_closed_seq::text AS closed
                                   FROM branch_cash_drawers
                                   WHERE clinic_id = ${C.clinicId} AND branch_id = ${C.branchR}`;
    if (closing!.statusCode === 201) {
      // The closing won: it covers (0, 1], and the payment is the first cash of the next period.
      expect(drawer).toEqual({ cash: "2", closed: "1" });
      const next = (await previewClosing(h, C.admin.cookie, C.branchR)).json() as Preview;
      expect(next).toMatchObject({ throughCashSeq: "2", expectedMinor: "2000" });
    } else {
      // The payment won: the closing's preview no longer matches the drawer, so nothing was closed.
      expect([closing!.statusCode, code(closing!)]).toEqual([409, "cash_drawer_changed"]);
      expect(drawer).toEqual({ cash: "2", closed: "0" });
    }
    const covering = await h.owner`SELECT count(*)::int AS n FROM cash_closings
                                   WHERE clinic_id = ${C.clinicId} AND branch_id = ${C.branchR}
                                     AND from_cash_seq < 2 AND to_cash_seq >= 2`;
    expect(covering[0]).toEqual({ n: 0 });
  });
});
