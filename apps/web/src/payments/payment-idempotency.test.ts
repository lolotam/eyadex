import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { keyFor } from "./idempotency-key";
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
