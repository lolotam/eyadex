import type { PlatformFinanceTotals } from "../finance-client";
import { clinicMonth, financeState } from "./mock-finance-state";
import { paymentState } from "./mock-payment-state";
import type { MockState } from "./mock-store";

type Sum = { month: string; currency: string; invoiced: bigint; collected: bigint; refunded: bigint };

/**
 * The platform's monthly totals of one clinic (FIN-3): invoiced, collected and refunded per clinic-timezone
 * month and currency. Only sums leave here: no row, no patient, no count reaches the platform.
 *
 * @param db الحالة
 * @param clinicId العيادة
 * @param timezone منطقة العيادة الزمنية
 * @returns المجاميع لكل شهر وعملة
 */
export function platformTotalsOf(
  db: MockState,
  clinicId: string,
  timezone: string,
): PlatformFinanceTotals {
  const sums = new Map<string, Sum>();
  const add = (at: string, currency: string, field: "invoiced" | "collected" | "refunded", minor: string) => {
    const month = clinicMonth(at, timezone);
    const k = `${month}:${currency}`;
    const row = sums.get(k) ?? { month, currency, invoiced: 0n, collected: 0n, refunded: 0n };
    row[field] += BigInt(minor);
    sums.set(k, row);
  };
  for (const i of financeState(db).invoices) {
    if (i.clinicId === clinicId && i.status !== "void") add(i.issuedAt, i.currency, "invoiced", i.totalMinor);
  }
  const s = paymentState(db);
  for (const p of s.payments) {
    if (p.clinicId === clinicId) add(p.receivedAt, p.currency, "collected", p.amountMinor);
  }
  for (const r of s.refunds) {
    if (r.clinicId === clinicId) add(r.refundedAt, r.currency, "refunded", r.amountMinor);
  }
  return {
    months: [...sums.values()]
      .sort((x, y) => x.month.localeCompare(y.month))
      .map((r) => ({
        month: r.month,
        currency: r.currency as never,
        invoicedMinor: r.invoiced.toString(),
        collectedMinor: r.collected.toString(),
        refundedMinor: r.refunded.toString(),
      })),
  };
}
