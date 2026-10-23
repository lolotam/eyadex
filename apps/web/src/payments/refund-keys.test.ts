import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import type { RefundSource } from "./refund-form";
import { useRefundKeys } from "./refund-keys";
import { auditOf, issue, pay, api, admin } from "./payment-mock-kit";

const receipt: RefundSource = {
  kind: "payment",
  paymentId: "00000000-0000-7000-8000-00000000000b",
  receiptNumber: "TT-R-2026-000001",
  capMinor: "4000",
};
const body = { source: "payment", paymentId: receipt.paymentId, amountMinor: "1000" };

describe("refund idempotency keys (PR #116 review)", () => {
  it("an unclear failure, a refetch with a lower paid amount, the same values → the same key", () => {
    const { result, rerender } = renderHook(({ paidMinor }) => [useRefundKeys(), paidMinor], {
      initialProps: { paidMinor: "4000" },
    });
    const first = (result.current[0] as ReturnType<typeof useRefundKeys>).keyOf(
      "inv",
      receipt,
      body,
    );
    rerender({ paidMinor: "3000" });
    const keys = result.current[0] as ReturnType<typeof useRefundKeys>;
    expect(keys.keyOf("inv", receipt, body)).toBe(first);
    expect(keys.keyOf("inv", receipt, { ...body, amountMinor: "500" })).not.toBe(first);
  });

  it("holds one key per invoice and source, and drops it only on success", () => {
    const { result } = renderHook(() => useRefundKeys());
    const k = result.current;
    const a = k.keyOf("inv", receipt, body);
    expect(k.keyOf("other", receipt, body)).not.toBe(a);
    expect(k.keyOf("inv", { kind: "credit", capMinor: "1" }, body)).not.toBe(a);
    k.drop("inv", receipt);
    expect(k.keyOf("inv", receipt, body)).not.toBe(a);
  });
});

describe("refund audit category", () => {
  beforeEach(() => resetMockData());
  it("a recorded refund's audit row is patient_access, as the API", async () => {
    const invoice = await issue("5000");
    const paid = await pay(invoice.id, "5000");
    await api.payments.refund(
      admin(),
      invoice.id,
      {
        source: "payment",
        paymentId: paid.payment.id,
        amountMinor: "1000",
        method: "cash",
        reason: "خطأ",
      },
      crypto.randomUUID(),
    );
    const rows = auditOf("refund.recorded");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe("patient_access");
  });
});
