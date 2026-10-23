import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cashClosingListResponseSchema,
  cashClosingPreviewResponseSchema,
  cashClosingResponseSchema,
  type CashClosingPreview,
} from "@eyadex/contracts/finance";
import type { Persona } from "@eyadex/contracts/session";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import {
  admin,
  api,
  as,
  auditOf,
  clinicPatients,
  issue,
  pay,
  patientAt,
  refusal,
  roleOf,
} from "./closing-mock-kit";

beforeEach(() => {
  resetMockData();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-10T09:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const branch = () => patientAt().registrationBranchId;
const preview = (p: Persona = admin(), branchId = branch()) =>
  api.cashClosings.preview(p, branchId);
const close = (
  pv: CashClosingPreview,
  countedMinor: string,
  note?: string,
  p: Persona = admin(),
  key: string = crypto.randomUUID(),
) =>
  api.cashClosings.close(
    p,
    {
      branchId: pv.branchId,
      previousClosingId: pv.previousClosingId,
      throughCashSeq: pv.throughCashSeq,
      countedMinor,
      ...(note === undefined ? {} : { note }),
    },
    key,
  );
const refundCash = (invoiceId: string, paymentId: string, amountMinor: string) =>
  api.payments.refund(
    admin(),
    invoiceId,
    { source: "payment", paymentId, amountMinor, method: "cash", reason: "خطأ" },
    crypto.randomUUID(),
  );

describe("cash closing preview (spec §4.4)", () => {
  it("sums only cash in the period; other methods appear in the day's totals for information", async () => {
    const invoice = await issue("10000");
    const p1 = (await pay(invoice.id, "4000", "cash")).payment;
    await pay(invoice.id, "3000", "knet");
    await refundCash(invoice.id, p1.id, "1000");
    const pv = await preview();
    expect(cashClosingPreviewResponseSchema.safeParse(pv).success).toBe(true);
    expect([pv.cashInMinor, pv.cashOutMinor, pv.expectedMinor]).toEqual(["4000", "1000", "3000"]);
    expect(pv.movements.map((m) => m.kind)).toEqual(["payment", "refund"]);
    expect(pv.methodTotals.find((m) => m.method === "knet")).toMatchObject({ inMinor: "3000" });
    expect(pv.businessDate).toBe("2026-03-10");
  });

  it("expected goes negative when cash refunds exceed cash taken in the period", async () => {
    const invoice = await issue("5000");
    const p1 = (await pay(invoice.id, "5000", "cash")).payment;
    await close(await preview(), "5000");
    vi.setSystemTime(new Date("2026-03-11T09:00:00Z"));
    await refundCash(invoice.id, p1.id, "2000");
    expect((await preview()).expectedMinor).toBe("-2000");
  });

  it("no patient name or patient id reaches the preview, the closing, the list or the detail", async () => {
    const patient = patientAt();
    const invoice = await issue("5000", patient);
    await pay(invoice.id, "5000", "cash");
    const pv = await preview();
    const closing = await close(pv, "5000");
    const list = await api.cashClosings.list(admin(), {});
    const detail = await api.cashClosings.get(admin(), closing.id);
    const text = JSON.stringify([pv, closing, list, detail]);
    expect(text).not.toContain(patient.fullName);
    expect(text).not.toContain(patient.id);
    expect(text).not.toContain("patient");
  });
});

describe("closing refusals, in the API's order", () => {
  it("forbidden without the key; another branch's drawer is not_found", async () => {
    const { a, b } = (() => {
      const x = clinicPatients()[0]!;
      const y = clinicPatients().find((p) => p.registrationBranchId !== x.registrationBranchId)!;
      return { a: x, b: y };
    })();
    const { role, member } = roleOf("receptionist");
    role.permissions = ["view:cash_closings:branch"];
    const desk = as("receptionist");
    expect(await refusal(preview(desk, a.registrationBranchId))).toBe("forbidden");
    role.permissions = ["create:cash_closings:branch", "view:cash_closings:branch"];
    member.allBranches = false;
    member.branchIds = [b.registrationBranchId];
    expect(await refusal(preview(desk, a.registrationBranchId))).toBe("not_found");
    const mine = await preview(desk, b.registrationBranchId);
    expect(
      await refusal(close({ ...mine, branchId: a.registrationBranchId }, "0", undefined, desk)),
    ).toBe("not_found");
    const other = await close(await preview(admin(), a.registrationBranchId), "0");
    expect(await refusal(api.cashClosings.get(desk, other.id))).toBe("not_found");
    expect((await api.cashClosings.list(desk, {})).items).toEqual([]);
  });

  it("cash_drawer_changed when cash moved since the preview, before the note check", async () => {
    const invoice = await issue("5000");
    const pv = await preview();
    await pay(invoice.id, "1000", "cash");
    expect(await refusal(close(pv, "999"))).toBe("cash_drawer_changed");
    // A non-cash payment does not move the drawer.
    const fresh = await preview();
    await pay(invoice.id, "1000", "knet");
    expect((await close(fresh, "1000")).expectedMinor).toBe("1000");
  });

  it("cash_closing_exists on the same business day, before the note check", async () => {
    await close(await preview(), "0");
    expect(await refusal(close(await preview(), "5"))).toBe("cash_closing_exists");
  });

  it("closing_note_required when the count differs; an empty note is no note", async () => {
    const invoice = await issue("5000");
    await pay(invoice.id, "5000", "cash");
    const pv = await preview();
    expect(await refusal(close(pv, "4500"))).toBe("closing_note_required");
    expect(await refusal(close(pv, "4500", ""))).toBe("closing_note_required");
    const closing = await close(pv, "4500", "نقص في الفكة");
    expect(closing.differenceMinor).toBe("-500");
    expect(cashClosingResponseSchema.safeParse({ cashClosing: closing }).success).toBe(true);
  });

  it("a retry with the same key replays the closing; another body under it is a conflict", async () => {
    const pv = await preview();
    const first = await close(pv, "0", undefined, admin(), "k-1");
    expect((await close(pv, "0", undefined, admin(), "k-1")).id).toBe(first.id);
    expect(await refusal(close(pv, "1", "x", admin(), "k-1"))).toBe("idempotency_conflict");
    expect((await api.cashClosings.list(admin(), {})).total).toBe(1);
  });
});

describe("closings over days", () => {
  it("two closings in a row with no cash both succeed on different days", async () => {
    const first = await close(await preview(), "0");
    vi.setSystemTime(new Date("2026-03-11T09:00:00Z"));
    const pv = await preview();
    expect(pv.previousClosingId).toBe(first.id);
    const second = await close(pv, "0");
    expect([first.businessDate, second.businessDate]).toEqual(["2026-03-10", "2026-03-11"]);
    const list = await api.cashClosings.list(admin(), {});
    expect(cashClosingListResponseSchema.safeParse(list).success).toBe(true);
    expect(list.items.map((k) => k.id)).toEqual([second.id, first.id]);
  });

  it("a payment after a closing lands in the next period, not the closed one", async () => {
    const invoice = await issue("5000");
    await pay(invoice.id, "1000", "cash");
    const first = await close(await preview(), "1000");
    await pay(invoice.id, "2000", "cash");
    const next = await preview();
    expect([next.fromCashSeq, next.expectedMinor]).toEqual([first.toCashSeq, "2000"]);
    expect((await api.cashClosings.get(admin(), first.id)).movements).toHaveLength(1);
  });
});

describe("closing audit", () => {
  it("one administrative row with the note's length only", async () => {
    const invoice = await issue("5000");
    await pay(invoice.id, "5000", "cash");
    await close(await preview(), "4000", "عجز بسيط");
    const [row, ...more] = auditOf("cash_closing.closed");
    expect(more).toEqual([]);
    expect(row).toMatchObject({ entity: "cash_closing", category: "administrative" });
    expect(row!.after).toMatchObject({ noteLength: 8, differenceMinor: "-1000" });
    expect(JSON.stringify(row)).not.toContain("عجز بسيط");
  });
});
