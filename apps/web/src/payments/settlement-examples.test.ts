import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import {
  admin,
  api,
  applyCredit,
  breachesOf,
  editTotal,
  issue,
  patientAt,
  pay,
  refusal,
  voidIt,
} from "./payment-mock-kit";

beforeEach(() => resetMockData());

const settlementOf = async (id: string) => (await api.finance.getInvoice(admin(), id)).settlement;
const creditOf = async (id: string) =>
  (await api.payments.invoicePayments(admin(), id)).creditBalanceMinor;

// Spec §4.3 worked examples this card covers (S7, S8, S10 are refunds: card 2), through the mock's public
// methods, with every invariant checked after each step.
describe("settlement worked examples S1–S6, S9, S11", () => {
  it("S1–S6 on one patient keeps paid, owed, state and credit as the table says", async () => {
    const patient = patientAt();
    const i1 = await issue("10000", patient);
    const steps: { name: string; run: () => Promise<unknown>; check: () => Promise<void> }[] = [
      {
        name: "S1 pay 4000 cash",
        run: () => pay(i1.id, "4000", "cash"),
        check: async () =>
          expect(await settlementOf(i1.id)).toEqual({
            state: "partly_paid",
            paidMinor: "4000",
            owedMinor: "6000",
          }),
      },
      {
        name: "S2 pay 6000 KNET",
        run: () => pay(i1.id, "6000", "knet"),
        check: async () => {
          expect(await settlementOf(i1.id)).toEqual({
            state: "paid",
            paidMinor: "10000",
            owedMinor: "0",
          });
          expect(await creditOf(i1.id)).toBe("0");
        },
      },
      {
        name: "S3 edit to 7000 releases 3000 from the newest allocation",
        run: () => editTotal(i1.id, "7000"),
        check: async () => {
          expect(await settlementOf(i1.id)).toEqual({
            state: "paid",
            paidMinor: "7000",
            owedMinor: "0",
          });
          const view = await api.payments.invoicePayments(admin(), i1.id);
          expect(view.creditBalanceMinor).toBe("3000");
          const released = view.movements.filter((m) => m.kind === "credit_released");
          expect(released).toMatchObject([{ amountMinor: "3000", cause: "invoice_edited" }]);
          // A2 (the KNET receipt) is the one that shrank: 3000 of it stays refundable.
          const knet = view.movements.find((m) => m.kind === "payment" && m.method === "knet");
          expect(knet).toMatchObject({ refundableMinor: "3000" });
        },
      },
      {
        name: "S4 edit to 9000 never re-takes the credit",
        run: () => editTotal(i1.id, "9000"),
        check: async () => {
          expect(await settlementOf(i1.id)).toEqual({
            state: "partly_paid",
            paidMinor: "7000",
            owedMinor: "2000",
          });
          expect(await creditOf(i1.id)).toBe("3000");
        },
      },
    ];
    for (const step of steps) {
      await step.run();
      await step.check();
      expect(breachesOf(patient.id), step.name).toEqual([]);
    }
    const i2 = await issue("5000", patient);
    await applyCredit(i2.id, "3000");
    expect(await settlementOf(i2.id)).toEqual({
      state: "partly_paid",
      paidMinor: "3000",
      owedMinor: "2000",
    });
    expect(await creditOf(i2.id)).toBe("0");
    expect(breachesOf(patient.id), "S5").toEqual([]);
    const voided = await voidIt(i2.id);
    expect(voided.settlement).toBeNull();
    const after = await api.payments.invoicePayments(admin(), i2.id);
    expect(after.creditBalanceMinor).toBe("3000");
    expect(after.movements.at(-1)).toMatchObject({
      kind: "credit_released",
      amountMinor: "3000",
      cause: "invoice_voided",
    });
    expect(breachesOf(patient.id), "S6").toEqual([]);
  });

  it("S9 refuses paying above what is owed and changes nothing", async () => {
    const i3 = await issue("5000");
    expect(await refusal(pay(i3.id, "6000"))).toBe("payment_exceeds_balance");
    expect(await settlementOf(i3.id)).toEqual({
      state: "unpaid",
      paidMinor: "0",
      owedMinor: "5000",
    });
    expect(breachesOf(patientAt().id)).toEqual([]);
  });

  it("S11 a zero-total invoice is paid and refuses a payment as invoice_settled", async () => {
    const i4 = await issue("0");
    expect(await settlementOf(i4.id)).toEqual({ state: "paid", paidMinor: "0", owedMinor: "0" });
    expect(await refusal(pay(i4.id, "1"))).toBe("invoice_settled");
  });
});
