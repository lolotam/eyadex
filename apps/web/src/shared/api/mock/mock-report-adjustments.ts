import { financeState, type StoredInvoice } from "./mock-finance-state";
import { paymentState } from "./mock-payment-state";
import type { ReportContext } from "./mock-report-access";
import { newId } from "./mock-store";
import {
  branchNameOf,
  dayOf,
  inRange,
  patientNameOf,
  reaches,
  reportPage,
  staffNameOf,
} from "./mock-report-kit";

type PageQuery = { from: string; to: string; cursor?: string | undefined; limit: number };
type Discount = StoredInvoice["invoiceDiscount"];

/** R7: one row per refund; `payment` when it spent a credit released by a refund of a receipt. */
export function refunds(ctx: ReportContext, q: PageQuery) {
  const s = paymentState(ctx.db);
  const rows = s.refunds
    .filter(
      (f) => f.clinicId === ctx.clinicId && reaches(ctx, f.branchId) && inRange(f.businessDate, q),
    )
    .map((f) => {
      const fromPayment = s.refundSources.some(
        (src) =>
          src.clinicId === ctx.clinicId &&
          src.refundId === f.id &&
          s.credits.some((c) => c.id === src.creditId && c.cause === "refund"),
      );
      return {
        rowId: f.id,
        refundId: f.id,
        refundNumber: f.refundNumber,
        branchId: f.branchId,
        businessDate: f.businessDate,
        patientId: f.patientId,
        method: f.method,
        source: fromPayment ? ("payment" as const) : ("credit" as const),
        amountMinor: f.amountMinor,
        refundedBy: f.refundedBy,
        reason: f.reason,
        currency: f.currency,
      };
    });
  const page = reportPage(rows, q);
  return {
    items: page.rows.map((r) => ({
      ...r,
      branchName: branchNameOf(ctx, r.branchId),
      patientName: patientNameOf(ctx, r.patientId),
      refundedByName: staffNameOf(ctx, r.refundedBy),
    })),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}

/** The same half-up arithmetic as invoice-totals.ts, on the line's gross. */
function lineDiscountMinor(discount: Discount, gross: bigint): bigint {
  if (discount === null) return 0n;
  if (discount.kind === "amount") return BigInt(discount.minor);
  return (gross * BigInt(discount.bp) + 5000n) / 10000n;
}

// Legacy lines need saved identities: deriving one from the invoice id can collapse cursor rows.
function restoreLineMeta(invoice: StoredInvoice, occupied: Set<string>) {
  invoice.lineMeta = invoice.lines.map((_, position) => {
    const saved = invoice.lineMeta?.[position];
    if (saved) return saved;
    let id = newId();
    while (occupied.has(id)) id = newId();
    occupied.add(id);
    return { id, discountedBy: null };
  });
  return invoice.lineMeta;
}

/** R8: each discounted live line and the invoice's own discount, on issued invoices issued in range. */
export function discounts(ctx: ReportContext, q: PageQuery) {
  const invoices = financeState(ctx.db).invoices;
  const occupied = new Set(invoices.flatMap((i) => [i.id, ...(i.lineMeta ?? []).map((l) => l.id)]));
  const rows = invoices.flatMap((i) => {
    const day = dayOf(i.issuedAt, ctx);
    if (i.clinicId !== ctx.clinicId || i.status !== "issued") return [];
    if (!reaches(ctx, i.branchId) || !inRange(day, q)) return [];
    const lineMeta = restoreLineMeta(i, occupied);
    const base = {
      invoiceId: i.id,
      invoiceNumber: i.number,
      branchId: i.branchId,
      businessDate: day,
      patientId: i.patientId,
      currency: i.currency,
    };
    const lineAmounts = i.lines.map((l) =>
      lineDiscountMinor(l.discount, BigInt(l.unitPriceMinor) * BigInt(l.quantity)),
    );
    const lines = i.lines.flatMap((l, position) =>
      l.discount === null
        ? []
        : [
            {
              ...base,
              rowId: lineMeta[position]!.id,
              kind: "line" as const,
              discountMinor: lineAmounts[position]!.toString(),
              discountedBy: lineMeta[position]!.discountedBy,
              reason: l.discount.reason,
            },
          ],
    );
    // The saved discount includes every line discount; what is left is the invoice's own.
    const own = BigInt(i.discountMinor) - lineAmounts.reduce((sum, x) => sum + x, 0n);
    const invoice =
      i.invoiceDiscount === null
        ? []
        : [
            {
              ...base,
              rowId: i.id,
              kind: "invoice" as const,
              discountMinor: own.toString(),
              discountedBy: i.discountedBy ?? null,
              reason: i.invoiceDiscount.reason,
            },
          ];
    return [...lines, ...invoice];
  });
  const page = reportPage(rows, q);
  return {
    items: page.rows.map((r) => ({
      ...r,
      branchName: branchNameOf(ctx, r.branchId),
      patientName: patientNameOf(ctx, r.patientId),
      discountedByName: r.discountedBy === null ? null : staffNameOf(ctx, r.discountedBy),
    })),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}
