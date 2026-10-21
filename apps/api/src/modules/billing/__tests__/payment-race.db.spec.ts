import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP,
  call,
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import { DATABASE } from "../../../shared/database.provider.ts";
import { takeReceiptSeq } from "../persistence/pg-payment-writes.ts";
import {
  financeClinic,
  manualInvoice,
  pay,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Finance F2 (spec §4.4, §4.8): the money of one patient is serialised on the patient row, the
// receipt numbers of a branch are gap-free, and the cash drawer of a branch gives every cash movement
// its own number. Every race below is real: an owner session holds a row and the API's own request
// waits on it.
let h: Harness;
let C: FinanceClinic;

type Answer = {
  payment: { id: string; receiptNumber: string; cashSeq: string | null };
  settlement: { state: string; paidMinor: string; owedMinor: string };
};

/** The owner session that holds the patients' rows, until the requests below are waiting on them. */
type Holding = { release: () => Promise<void> };

const cash = (amountMinor: string) => ({ method: "cash", amountMinor });
const knet = (amountMinor: string) => ({ method: "knet", amountMinor });
const seqOf = (receiptNumber: string) => Number(receiptNumber.split("-").at(-1));
const PAID_5000 = { state: "paid", paidMinor: "5000", owedMinor: "0" };
const PAID_4000 = { state: "paid", paidMinor: "4000", owedMinor: "0" };
const UNPAID_4000 = { state: "unpaid", paidMinor: "0", owedMinor: "4000" };

/** The only line of an invoice: one free line of the given price. */
const free = (unitPriceMinor: string) => ({
  kind: "free",
  descriptionAr: "جلسة",
  descriptionEn: "Session",
  quantity: 1,
  unitPriceMinor,
  discount: null,
});

/** PATCH /v1/invoices/:id with `If-Match`: the invoice's new total comes from its only line. */
const editTo = (invoiceId: string, totalMinor: string, ifMatch: string) =>
  call(h, {
    method: "PATCH",
    url: `/v1/invoices/${invoiceId}`,
    host: APP,
    cookie: C.admin.cookie,
    body: { lines: [free(totalMinor)], invoiceDiscount: null },
    headers: { "if-match": ifMatch },
  });

/** The settlement of the invoice as the API reads it now. */
const settlementOf = async (invoiceId: string) => {
  const res = await send(h, C.admin.cookie, "GET", `/v1/invoices/${invoiceId}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { invoice: { settlement: unknown } }).invoice.settlement;
};

/** Until at least `n` sessions of this database wait on a row lock. */
async function rowLockWaiters(n: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_locks
                                WHERE locktype IN ('transactionid', 'tuple') AND NOT granted`;
    if ((row!["n"] as number) >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fewer than ${n} row-lock waiters`);
}

/**
 * An owner session that holds the patients' rows `FOR NO KEY UPDATE` until it is released: the API's own
 * patient lock (spec §4.4) waits there, so the requests below really race.
 */
async function holdPatients(patientIds: readonly string[]): Promise<Holding> {
  let open!: () => void;
  const held = new Promise<void>((resolve) => (open = resolve));
  let locked!: () => void;
  const taken = new Promise<void>((resolve) => (locked = resolve));
  const owner = h.owner.begin(async (sql) => {
    for (const id of patientIds) {
      await sql`SELECT id FROM patients
                WHERE clinic_id = ${C.clinicId} AND id = ${id} FOR NO KEY UPDATE`;
    }
    locked();
    await held;
  });
  await taken;
  return {
    release: async () => {
      open();
      await owner;
    },
  };
}

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

describe("two payments racing the last owed (spec §4.8)", () => {
  it("lets one of them pay the invoice and refuses the other", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "5000");
    const holding = await holdPatients([patient]);
    const paying = Promise.all([
      pay(h, C.admin.cookie, invoice.id, cash("5000")),
      pay(h, C.admin.cookie, invoice.id, cash("5000")),
    ]);
    try {
      await rowLockWaiters(2);
    } finally {
      await holding.release();
    }
    const answers = await paying;
    expect(answers.map((res) => res.statusCode).sort((a, b) => a - b)).toEqual([201, 409]);
    const refused = answers.find((res) => res.statusCode === 409)!;
    // The loser reads the balance after the winner committed: nothing is owed any more (spec §4.3).
    expect(code(refused)).toBe("invoice_settled");
    expect(await settlementOf(invoice.id)).toEqual(PAID_5000);
  });
});

describe("a payment and an edit of one invoice at once (spec §4.8, R2-8)", () => {
  it("settles both of them without a server error", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "10000");
    const holding = await holdPatients([patient]);
    const paying = Promise.all([
      pay(h, C.admin.cookie, invoice.id, cash("10000")),
      editTo(invoice.id, "4000", '"1"'),
    ]);
    try {
      await rowLockWaiters(2);
    } finally {
      await holding.release();
    }
    const [payment, edited] = await paying;
    expect([payment.statusCode, edited.statusCode].every((status) => status < 500)).toBe(true);
    const credits = await h.owner`SELECT amount_minor::text AS amount_minor, cause
                             FROM patient_credits
                             WHERE clinic_id = ${C.clinicId} AND patient_id = ${patient}
                             ORDER BY created_at, id`;
    if (payment.statusCode === 201) {
      // The payment won: the edit finds the invoice paid and gives the excess back as credit.
      expect(edited.statusCode).toBe(200);
      expect(credits).toHaveLength(1);
      expect(credits[0]).toMatchObject({ amount_minor: "6000", cause: "invoice_edited" });
      expect(await settlementOf(invoice.id)).toEqual(PAID_4000);
    } else {
      // The edit won: the invoice owes 4000 now, so the payment of 10000 is above what it owes.
      expect([payment.statusCode, code(payment)]).toEqual([409, "payment_exceeds_balance"]);
      expect(edited.statusCode).toBe(200);
      expect(credits).toHaveLength(0);
      expect(await settlementOf(invoice.id)).toEqual(UNPAID_4000);
    }
  });
});

describe("the receipt numbers of two concurrent payments (spec §4.8, R1-9)", () => {
  it("gives them consecutive numbers in one branch", async () => {
    const first = await patientIn(h, C, C.branchD);
    const second = await patientIn(h, C, C.branchD);
    const one = await manualInvoice(h, C.admin.cookie, first, C.branchD, "1000");
    const two = await manualInvoice(h, C.admin.cookie, second, C.branchD, "2000");
    const holding = await holdPatients([first, second]);
    const paying = Promise.all([
      pay(h, C.admin.cookie, one.id, knet("1000")),
      pay(h, C.admin.cookie, two.id, knet("2000")),
    ]);
    try {
      await rowLockWaiters(2);
    } finally {
      await holding.release();
    }
    const answers = await paying;
    expect(answers.map((res) => res.statusCode)).toEqual([201, 201]);
    const seqs = answers.map((res) => seqOf((res.json() as Answer).payment.receiptNumber));
    expect(Math.abs(seqs[0]! - seqs[1]!)).toBe(1);
  });
});

describe("a rolled-back payment gives its number back (spec §4.8, R1-9)", () => {
  it("takes the number the rolled-back transaction had taken", async () => {
    const db = h.app.get<Database>(DATABASE);
    const ids = systemUuidV7();
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "1000");
    const year = Number(invoice.number.split("-")[1]);
    let taken = 0;
    await expect(
      db.withTenant(C.clinicId, async (tx) => {
        taken = await takeReceiptSeq(tx, ids, C.clinicId, C.branchD, "receipt", year, new Date());
        throw new Error("the payment rolled back");
      }),
    ).rejects.toThrow();
    const res = await pay(h, C.admin.cookie, invoice.id, cash("1000"));
    expect(res.statusCode, res.body).toBe(201);
    expect(seqOf((res.json() as Answer).payment.receiptNumber)).toBe(taken);
  });
});

describe("the cash drawer of a branch (spec §4.4, §4.8)", () => {
  it("gives two concurrent cash payments consecutive cash numbers", async () => {
    const first = await patientIn(h, C, C.branchR);
    const second = await patientIn(h, C, C.branchR);
    const one = await manualInvoice(h, C.admin.cookie, first, C.branchR, "1000");
    const two = await manualInvoice(h, C.admin.cookie, second, C.branchR, "2000");
    const holding = await holdPatients([first, second]);
    const paying = Promise.all([
      pay(h, C.cashier.cookie, one.id, cash("1000")),
      pay(h, C.cashier.cookie, two.id, cash("2000")),
    ]);
    try {
      await rowLockWaiters(2);
    } finally {
      await holding.release();
    }
    const answers = await paying;
    expect(answers.map((res) => res.statusCode)).toEqual([201, 201]);
    const seqs = answers.map((res) => (res.json() as Answer).payment.cashSeq);
    expect(seqs.every((seq) => typeof seq === "string")).toBe(true);
    const numbers = seqs.map((seq) => Number(seq));
    expect(Math.abs(numbers[0]! - numbers[1]!)).toBe(1);
  });
});
