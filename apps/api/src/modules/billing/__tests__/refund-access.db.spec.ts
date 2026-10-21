import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn, setModule } from "../../medical/__tests__/medical-fixtures.ts";
import {
  closeCash,
  financeClinic,
  manualInvoice,
  moneyStaff,
  pay,
  previewClosing,
  refund,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Finance F2 slice 5 (spec §4.6, §4.8): who may refund and close the cash, and who may read them — the
// keys, the branch scope (the invoice's branch, the closing's branch), another clinic and the finance
// module off. Every guard runs in the CLAUDE.md §6 order; outside the reach is not_found (ISO-02).
let h: Harness;
let C: FinanceClinic;
let C2: FinanceClinic;
let invalidate: AuthorizationInvalidator;
let staff: Awaited<ReturnType<typeof moneyStaff>>;

type RefundAnswer = { refund: { id: string; branchId: string } };
type ListedRefund = { id: string; patientName: string; method: string };
type Preview = { previousClosingId: string | null; throughCashSeq: string; expectedMinor: string };

const REASON = "returned a service";
const paidOn = async (clinic: FinanceClinic, branchId: string, total = "1000") => {
  const patient = await patientIn(h, clinic, branchId);
  const invoice = await manualInvoice(h, clinic.admin.cookie, patient, branchId, total);
  const paid = await pay(h, clinic.admin.cookie, invoice.id, {
    method: "knet",
    amountMinor: total,
  });
  expect(paid.statusCode, paid.body).toBe(201);
  return { invoice, paymentId: (paid.json() as { payment: { id: string } }).payment.id };
};
const fromPayment = (paymentId: string, amountMinor = "100") => ({
  source: "payment",
  paymentId,
  amountMinor,
  method: "knet",
  reason: REASON,
});
const closeFrom = (branchId: string, preview: Preview) => ({
  branchId,
  previousClosingId: preview.previousClosingId,
  throughCashSeq: preview.throughCashSeq,
  countedMinor: preview.expectedMinor.startsWith("-") ? "0" : preview.expectedMinor,
  note: "counted",
});

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
  staff = await moneyStaff(h, C, invalidate);
  C2 = await financeClinic(h, invalidate);
  await setPrefixes(h, C2);
});

afterAll(() => closeHarness(h));

describe("the refunds key (spec §4.1, F2-Q15)", () => {
  it("refuses a refund to the receptionist, who records payments but holds no create:refunds", async () => {
    const { invoice, paymentId } = await paidOn(C, C.branchR);
    const res = await refund(h, C.receptionist.cookie, invoice.id, fromPayment(paymentId));
    expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
  });

  it("refuses the refunds list to a member without view:payments", async () => {
    const list = await send(h, C.desk.cookie, "GET", "/v1/refunds");
    expect([list.statusCode, code(list)]).toEqual([403, "forbidden"]);
    const doctor = await send(h, C.doctor.cookie, "GET", "/v1/refunds");
    expect([doctor.statusCode, code(doctor)]).toEqual([403, "forbidden"]);
  });
});

describe("the branch scope of a refund (F2-Q8)", () => {
  it("lets the refunder of branch R refund there and hides branch D's invoices and refunds", async () => {
    const onR = await paidOn(C, C.branchR);
    const mine = await refund(h, staff.refunder.cookie, onR.invoice.id, fromPayment(onR.paymentId));
    expect(mine.statusCode, mine.body).toBe(201);
    const onD = await paidOn(C, C.branchD);
    const other = await refund(
      h,
      staff.refunder.cookie,
      onD.invoice.id,
      fromPayment(onD.paymentId),
    );
    expect([other.statusCode, code(other)]).toEqual([404, "not_found"]);
    const byAdmin = await refund(h, C.admin.cookie, onD.invoice.id, fromPayment(onD.paymentId));
    expect(byAdmin.statusCode, byAdmin.body).toBe(201);
    const id = (byAdmin.json() as RefundAnswer).refund.id;
    const shown = await send(h, staff.refunder.cookie, "GET", `/v1/refunds/${id}`);
    expect([shown.statusCode, code(shown)]).toEqual([404, "not_found"]);
    const list = await send(h, staff.refunder.cookie, "GET", "/v1/refunds?limit=100");
    expect(list.statusCode, list.body).toBe(200);
    const branches = (list.json() as { items: { branchId: string }[] }).items.map(
      (r) => r.branchId,
    );
    expect(branches.length > 0 && branches.every((branch) => branch === C.branchR)).toBe(true);
  });

  it("answers not_found to a replay once the refund's branch left the caller's reach (R3-6)", async () => {
    const onR = await paidOn(C, C.branchR);
    const key = randomUUID();
    const body = fromPayment(onR.paymentId);
    const first = await refund(h, staff.refunder.cookie, onR.invoice.id, body, key);
    expect(first.statusCode, first.body).toBe(201);
    await h.owner`UPDATE membership_branches SET branch_id = ${C.branchD}
                  WHERE clinic_id = ${C.clinicId} AND membership_id = ${staff.refunder.memberId}`;
    await invalidate.clinicChanged(C.clinicId);
    try {
      const replay = await refund(h, staff.refunder.cookie, onR.invoice.id, body, key);
      expect([replay.statusCode, code(replay)]).toEqual([404, "not_found"]);
    } finally {
      await h.owner`UPDATE membership_branches SET branch_id = ${C.branchR}
                    WHERE clinic_id = ${C.clinicId} AND membership_id = ${staff.refunder.memberId}`;
      await invalidate.clinicChanged(C.clinicId);
    }
  });
});

describe("the cash closing keys and branch scope (spec §4.1)", () => {
  it("refuses the preview and the close to the receptionist, who holds no cash closing key", async () => {
    const preview = await previewClosing(h, C.receptionist.cookie, C.branchR);
    expect([preview.statusCode, code(preview)]).toEqual([403, "forbidden"]);
    const list = await send(h, C.receptionist.cookie, "GET", "/v1/cash-closings");
    expect([list.statusCode, code(list)]).toEqual([403, "forbidden"]);
  });

  it("lets the closer of branch R close there and hides branch D's drawer and closings", async () => {
    const other = await previewClosing(h, staff.closer.cookie, C.branchD);
    expect([other.statusCode, code(other)]).toEqual([404, "not_found"]);
    const preview = await previewClosing(h, staff.closer.cookie, C.branchR);
    expect(preview.statusCode, preview.body).toBe(200);
    const closed = await closeCash(
      h,
      staff.closer.cookie,
      closeFrom(C.branchR, preview.json() as Preview),
    );
    expect(closed.statusCode, closed.body).toBe(201);
    const onD = await previewClosing(h, C.admin.cookie, C.branchD);
    const notMine = await closeCash(
      h,
      staff.closer.cookie,
      closeFrom(C.branchD, onD.json() as Preview),
    );
    expect([notMine.statusCode, code(notMine)]).toEqual([404, "not_found"]);
    const byAdmin = await closeCash(h, C.admin.cookie, closeFrom(C.branchD, onD.json() as Preview));
    expect(byAdmin.statusCode, byAdmin.body).toBe(201);
    const id = (byAdmin.json() as { cashClosing: { id: string } }).cashClosing.id;
    const shown = await send(h, staff.closer.cookie, "GET", `/v1/cash-closings/${id}`);
    expect([shown.statusCode, code(shown)]).toEqual([404, "not_found"]);
    const list = await send(h, staff.closer.cookie, "GET", "/v1/cash-closings");
    expect(list.statusCode, list.body).toBe(200);
    const branches = (list.json() as { items: { branchId: string }[] }).items.map(
      (k) => k.branchId,
    );
    expect(branches).toEqual([C.branchR]);
  });

  it("answers not_found for a branch of no clinic", async () => {
    const res = await previewClosing(h, C.admin.cookie, randomUUID());
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
  });
});

describe("another clinic's refunds and closings (ISO-02)", () => {
  it("hides the first clinic's invoice, refund and closing from the second clinic's admin", async () => {
    const { invoice, paymentId } = await paidOn(C, C.branchD);
    const foreign = await refund(h, C2.admin.cookie, invoice.id, fromPayment(paymentId));
    expect([foreign.statusCode, code(foreign)]).toEqual([404, "not_found"]);
    const mine = await refund(h, C.admin.cookie, invoice.id, fromPayment(paymentId));
    expect(mine.statusCode, mine.body).toBe(201);
    const id = (mine.json() as RefundAnswer).refund.id;
    const shown = await send(h, C2.admin.cookie, "GET", `/v1/refunds/${id}`);
    expect([shown.statusCode, code(shown)]).toEqual([404, "not_found"]);
    const preview = await previewClosing(h, C2.admin.cookie, C.branchD);
    expect([preview.statusCode, code(preview)]).toEqual([404, "not_found"]);
    const [closing] =
      await h.owner`SELECT id FROM cash_closings WHERE clinic_id = ${C.clinicId} LIMIT 1`;
    const closingShown = await send(
      h,
      C2.admin.cookie,
      "GET",
      `/v1/cash-closings/${closing!["id"]}`,
    );
    expect([closingShown.statusCode, code(closingShown)]).toEqual([404, "not_found"]);
  });
});

describe("the finance module off", () => {
  it("refuses a refund, a preview and the closings list with module_disabled", async () => {
    const { invoice, paymentId } = await paidOn(C2, C2.branchD);
    await setModule(h, invalidate, C2.clinicId, "finance", false);
    try {
      const refunded = await refund(h, C2.admin.cookie, invoice.id, fromPayment(paymentId));
      expect([refunded.statusCode, code(refunded)]).toEqual([403, "module_disabled"]);
      const preview = await previewClosing(h, C2.admin.cookie, C2.branchD);
      expect([preview.statusCode, code(preview)]).toEqual([403, "module_disabled"]);
      const list = await send(h, C2.admin.cookie, "GET", "/v1/cash-closings");
      expect([list.statusCode, code(list)]).toEqual([403, "module_disabled"]);
    } finally {
      await setModule(h, invalidate, C2.clinicId, "finance", true);
    }
  });
});

describe("reading the refunds (spec §4.6)", () => {
  it("lists the refunds newest first with the patient's name, and shows one", async () => {
    const list = await send(h, C.admin.cookie, "GET", "/v1/refunds?limit=2");
    expect(list.statusCode, list.body).toBe(200);
    const page = list.json() as {
      items: ListedRefund[];
      nextCursor: string | null;
      total: number;
    };
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThan(2);
    expect(page.items[0]!.id > page.items[1]!.id).toBe(true);
    expect(typeof page.items[0]!.patientName).toBe("string");
    const next = await send(
      h,
      C.admin.cookie,
      "GET",
      `/v1/refunds?limit=2&cursor=${page.nextCursor}`,
    );
    expect(next.statusCode, next.body).toBe(200);
    expect((next.json() as { items: { id: string }[] }).items[0]!.id < page.items[1]!.id).toBe(
      true,
    );
    const one = await send(h, C.admin.cookie, "GET", `/v1/refunds/${page.items[0]!.id}`);
    expect(one.statusCode, one.body).toBe(200);
    expect((one.json() as { refund: unknown }).refund).toEqual(page.items[0]);
    const knetOnly = await send(h, C.admin.cookie, "GET", "/v1/refunds?method=knet");
    const methods = (knetOnly.json() as { items: { method: string }[] }).items.map((r) => r.method);
    expect(methods.length > 0 && methods.every((method) => method === "knet")).toBe(true);
    const unknown = await send(h, C.admin.cookie, "GET", `/v1/refunds/${randomUUID()}`);
    expect([unknown.statusCode, code(unknown)]).toEqual([404, "not_found"]);
  });
});
