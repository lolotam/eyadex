import { beforeEach, describe, expect, it } from "vitest";
import { recordPayment } from "@/shared/api/mock/mock-payment-writes";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { admin, clinicIdAt, clinicPatients, getState, issue, pay } from "./payment-mock-kit";

beforeEach(() => resetMockData());

const at = (invoiceId: string, iso: string, method: "cash" | "knet" = "cash") =>
  recordPayment(
    getState(),
    admin(),
    invoiceId,
    { method, amountMinor: "100" },
    crypto.randomUUID(),
    new Date(iso),
  );

describe("receipt numbers and the cash drawer", () => {
  it("numbers PREFIX-R-YYYY-NNNNNN without gaps per branch, separately for each branch", async () => {
    const a = clinicPatients()[0]!;
    const b = clinicPatients().find((p) => p.registrationBranchId !== a.registrationBranchId)!;
    const ia = await issue("5000", a);
    const ib = await issue("5000", b);
    const n = async (id: string) => (await pay(id, "100")).payment.receiptNumber;
    const [a1, a2, b1, a3] = [await n(ia.id), await n(ia.id), await n(ib.id), await n(ia.id)];
    expect(a1).toMatch(/^[A-Z0-9]{2,6}-R-\d{4}-000001$/);
    expect([a2, a3].map((x) => x.slice(-6))).toEqual(["000002", "000003"]);
    expect(b1.slice(-6)).toBe("000001");
    expect(b1.split("-")[0]).not.toBe(a1.split("-")[0]);
  });

  it("starts again at 000001 in a new clinic-timezone year", async () => {
    getState().clinics.find((c) => c.id === clinicIdAt(0))!.timezone = "Asia/Kuwait";
    const invoice = await issue("5000");
    const late = at(invoice.id, "2026-12-31T20:00:00.000Z");
    const next = at(invoice.id, "2026-12-31T21:30:00.000Z");
    expect(late.payment.receiptNumber).toMatch(/-R-2026-000001$/);
    expect(next.payment.receiptNumber).toMatch(/-R-2027-000001$/);
  });

  it("gives a drawer position to cash only, one sequence per branch that never resets", async () => {
    const invoice = await issue("5000");
    const c1 = at(invoice.id, "2026-10-20T08:00:00.000Z");
    const k = at(invoice.id, "2026-10-20T08:01:00.000Z", "knet");
    const c2 = at(invoice.id, "2027-03-01T08:00:00.000Z");
    expect([c1.payment.cashSeq, k.payment.cashSeq, c2.payment.cashSeq]).toEqual(["1", null, "2"]);
  });

  it("dates a receipt by the clinic-timezone day across midnight UTC", async () => {
    getState().clinics.find((c) => c.id === clinicIdAt(0))!.timezone = "Asia/Kuwait";
    const invoice = await issue("5000");
    const answer = at(invoice.id, "2026-10-20T22:30:00.000Z");
    expect(answer.payment.businessDate).toBe("2026-10-21");
  });
});
