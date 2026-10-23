import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { keyFor, useHeldKeys } from "./idempotency-key";
import { admin, as, issue, patientAt, pay, refusal, roleOf } from "./payment-mock-kit";

beforeEach(() => resetMockData());

describe("payment idempotency (lesson 2.3)", () => {
  it("a replay returns the first answer, with its first settlement, and takes no receipt number", async () => {
    const invoice = await issue("10000");
    const key = crypto.randomUUID();
    const first = await pay(invoice.id, "4000", "cash", admin(), key);
    const other = await pay(invoice.id, "1000", "knet");
    expect(Number(other.payment.receiptNumber.slice(-6))).toBe(2);
    const again = await pay(invoice.id, "4000", "cash", admin(), key);
    expect(again).toEqual(first);
    expect(again.settlement.owedMinor).toBe("6000");
    const next = await pay(invoice.id, "1000", "knet");
    expect(Number(next.payment.receiptNumber.slice(-6))).toBe(3);
  });

  it("the same key with another invoice or another body is idempotency_conflict", async () => {
    const one = await issue("5000");
    const two = await issue("5000");
    const key = crypto.randomUUID();
    await pay(one.id, "1000", "cash", admin(), key);
    expect(await refusal(pay(two.id, "1000", "cash", admin(), key))).toBe("idempotency_conflict");
    expect(await refusal(pay(one.id, "2000", "cash", admin(), key))).toBe("idempotency_conflict");
    expect(await refusal(pay(one.id, "1000", "knet", admin(), key))).toBe("idempotency_conflict");
  });

  it("NEGATIVE: a replay is not_found once the receipt's branch left the caller's reach", async () => {
    const patient = patientAt();
    const invoice = await issue("5000", patient);
    const { role, member } = roleOf("receptionist");
    role.permissions = [...new Set([...role.permissions, "create:payments:branch"])];
    member.allBranches = false;
    member.branchIds = [patient.registrationBranchId];
    const key = crypto.randomUUID();
    await pay(invoice.id, "1000", "cash", as("receptionist"), key);
    member.branchIds = [];
    expect(await refusal(pay(invoice.id, "1000", "cash", as("receptionist"), key))).toBe(
      "not_found",
    );
  });

  it("a refused payment takes no receipt number", async () => {
    const invoice = await issue("5000");
    await refusal(pay(invoice.id, "6000"));
    const ok = await pay(invoice.id, "5000");
    expect(ok.payment.receiptNumber.slice(-6)).toBe("000001");
  });
});

describe("the dialog's key", () => {
  it("keeps the key for a retry of the same request and makes a new one when it changes", () => {
    let n = 0;
    const make = () => `k${++n}`;
    const a = keyFor(null, "same", make);
    expect(keyFor(a, "same", make)).toBe(a);
    const b = keyFor(a, "changed", make);
    expect(b.key).not.toBe(a.key);
  });
});

// PR #108: the paid amount moved under a held key, so a payment may already be recorded.
describe("the report of a stale held key", () => {
  const INVOICE = "00000000-0000-7000-8000-00000000000a";
  const OTHER = "00000000-0000-7000-8000-00000000000d";
  type Props = { invoiceId: string; paidMinor: string };
  const held = (initial: Props) =>
    renderHook((props: Props) => useHeldKeys(props), { initialProps: initial });

  it("warns when the paid amount moved, and the next send uses a new key", async () => {
    const { result, rerender } = held({ invoiceId: INVOICE, paidMinor: "1000" });
    const first = result.current.keyOf("pay", { amountMinor: "4000" });
    expect(result.current.paidChanged.pay).toBe(false);
    rerender({ invoiceId: INVOICE, paidMinor: "5000" });
    await waitFor(() => expect(result.current.paidChanged.pay).toBe(true));
    expect(result.current.keyOf("pay", { amountMinor: "4000" })).not.toBe(first);
  });

  it("warns nothing and reuses the key when the paid amount did not move", () => {
    const { result, rerender } = held({ invoiceId: INVOICE, paidMinor: "1000" });
    const first = result.current.keyOf("pay", { amountMinor: "4000" });
    rerender({ invoiceId: INVOICE, paidMinor: "1000" });
    expect(result.current.paidChanged.pay).toBe(false);
    expect(result.current.keyOf("pay", { amountMinor: "4000" })).toBe(first);
  });

  it("warns nothing when another invoice is shown", () => {
    const { result, rerender } = held({ invoiceId: INVOICE, paidMinor: "1000" });
    result.current.keyOf("pay", { amountMinor: "4000" });
    rerender({ invoiceId: OTHER, paidMinor: "5000" });
    expect(result.current.paidChanged.pay).toBe(false);
  });

  it("warns nothing on another invoice: the warning was about the first one", async () => {
    const { result, rerender } = held({ invoiceId: INVOICE, paidMinor: "1000" });
    result.current.keyOf("pay", { amountMinor: "4000" });
    result.current.keyOf("credit", { amountMinor: "2000" });
    rerender({ invoiceId: INVOICE, paidMinor: "5000" });
    await waitFor(() => expect(result.current.paidChanged.pay).toBe(true));
    await waitFor(() => expect(result.current.paidChanged.credit).toBe(true));
    rerender({ invoiceId: OTHER, paidMinor: "5000" });
    await waitFor(() => expect(result.current.paidChanged.pay).toBe(false));
    expect(result.current.paidChanged.credit).toBe(false);
  });

  it("warns again on the invoice the key was held on", async () => {
    const { result, rerender } = held({ invoiceId: INVOICE, paidMinor: "1000" });
    result.current.keyOf("pay", { amountMinor: "4000" });
    rerender({ invoiceId: INVOICE, paidMinor: "5000" });
    await waitFor(() => expect(result.current.paidChanged.pay).toBe(true));
    rerender({ invoiceId: OTHER, paidMinor: "5000" });
    await waitFor(() => expect(result.current.paidChanged.pay).toBe(false));
    rerender({ invoiceId: INVOICE, paidMinor: "5000" });
    await waitFor(() => expect(result.current.paidChanged.pay).toBe(true));
  });

  it("a confirmed success clears the report", async () => {
    const { result, rerender } = held({ invoiceId: INVOICE, paidMinor: "1000" });
    result.current.keyOf("pay", { amountMinor: "4000" });
    rerender({ invoiceId: INVOICE, paidMinor: "5000" });
    await waitFor(() => expect(result.current.paidChanged.pay).toBe(true));
    act(() => {
      result.current.drop("pay");
    });
    expect(result.current.paidChanged.pay).toBe(false);
  });

  it("the credit reports on its own: it warns and the next send uses a new key", async () => {
    const { result, rerender } = held({ invoiceId: INVOICE, paidMinor: "1000" });
    const first = result.current.keyOf("credit", { amountMinor: "2000" });
    rerender({ invoiceId: INVOICE, paidMinor: "3000" });
    await waitFor(() => expect(result.current.paidChanged.credit).toBe(true));
    expect(result.current.paidChanged.pay).toBe(false);
    expect(result.current.keyOf("credit", { amountMinor: "2000" })).not.toBe(first);
  });

  // PR #111 review: a paid amount that changed warns, in either direction.
  it("warns when the paid amount went up", async () => {
    const { result, rerender } = held({ invoiceId: INVOICE, paidMinor: "1000" });
    result.current.keyOf("pay", { amountMinor: "4000" });
    rerender({ invoiceId: INVOICE, paidMinor: "5000" });
    await waitFor(() => expect(result.current.paidChanged.pay).toBe(true));
  });

  // PR #111 review: the warning means "the paid amount changed", in either direction.
  it("warns when the paid amount went down", async () => {
    const { result, rerender } = held({ invoiceId: INVOICE, paidMinor: "5000" });
    const first = result.current.keyOf("pay", { amountMinor: "4000" });
    rerender({ invoiceId: INVOICE, paidMinor: "1000" });
    await waitFor(() => expect(result.current.paidChanged.pay).toBe(true));
    // A paid amount that went down is a refund or an edit that released money into credit: the net
    // moved, so the movements are read before sending again. The key rule does not change: a paid
    // amount that is not the one the key was minted under drops the key, so the next send is a new
    // request.
    expect(result.current.keyOf("pay", { amountMinor: "4000" })).not.toBe(first);
  });

  // PR #111 review: the warning stays until a confirmed success.
  it("keeps the warning after a new key and a failed retry, and clears it on a success", async () => {
    const { result, rerender } = held({ invoiceId: INVOICE, paidMinor: "1000" });
    const first = result.current.keyOf("pay", { amountMinor: "4000" });
    rerender({ invoiceId: INVOICE, paidMinor: "5000" });
    await waitFor(() => expect(result.current.paidChanged.pay).toBe(true));
    // The retry mints a new key under the paid amount as it is now, and the warning stays.
    let retry = "";
    act(() => {
      retry = result.current.keyOf("pay", { amountMinor: "4000" });
    });
    expect(retry).not.toBe(first);
    expect(result.current.paidChanged.pay).toBe(true);
    // The retry failed: its key is kept for a replay, so the warning stays too.
    rerender({ invoiceId: INVOICE, paidMinor: "5000" });
    expect(result.current.paidChanged.pay).toBe(true);
    // A confirmed success drops the key, and the warning with it.
    act(() => {
      result.current.drop("pay");
    });
    expect(result.current.paidChanged.pay).toBe(false);
  });

  // PR #111 review: every invoice keeps its own key.
  it("keeps every invoice's key: a send on another invoice does not take this one", () => {
    const { result, rerender } = held({ invoiceId: INVOICE, paidMinor: "1000" });
    const first = result.current.keyOf("pay", { amountMinor: "4000" });
    rerender({ invoiceId: OTHER, paidMinor: "1000" });
    const other = result.current.keyOf("pay", { amountMinor: "4000" });
    expect(other).not.toBe(first);
    rerender({ invoiceId: INVOICE, paidMinor: "1000" });
    expect(result.current.keyOf("pay", { amountMinor: "4000" })).toBe(first);
  });

  // PR #111 review: a warned key is never reused, not even when the paid amount comes back.
  it("never reuses a warned key, even when the paid amount returns to its old value", async () => {
    const { result, rerender } = held({ invoiceId: INVOICE, paidMinor: "1000" });
    const first = result.current.keyOf("pay", { amountMinor: "4000" });
    rerender({ invoiceId: INVOICE, paidMinor: "5000" });
    await waitFor(() => expect(result.current.paidChanged.pay).toBe(true));
    // The paid amount returns to the value the key was minted under, and the user sends the same
    // values again: the earlier request may still be recorded, so the key must not answer it again.
    rerender({ invoiceId: INVOICE, paidMinor: "1000" });
    expect(result.current.keyOf("pay", { amountMinor: "4000" })).not.toBe(first);
    // The warning stays until a confirmed success drops the key.
    expect(result.current.paidChanged.pay).toBe(true);
  });
});
