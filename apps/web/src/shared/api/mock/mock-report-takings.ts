import type * as reports from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { closingState } from "./mock-cash-closing-state";
import { financeState } from "./mock-finance-state";
import { paymentState } from "./mock-payment-state";
import type { ReportContext } from "./mock-report-access";
import {
  branchNameOf,
  byKeys,
  dayOf,
  groupBy,
  inRange,
  periodOf,
  reaches,
  staffNameOf,
  sumMinor,
} from "./mock-report-kit";

type Grouped = { from: string; to: string; groupBy: "day" | "month" };
type Range = { from: string; to: string };
type TakingsRow = z.infer<typeof reports.reportDailyTakingsRowSchema>;
type SummaryRow = z.infer<typeof reports.reportPeriodSummaryRowSchema>;

/** The movements of the range in reach: each keeps its stored day and its own branch (F2-Q8). */
function movements(ctx: ReportContext, q: Range) {
  const s = paymentState(ctx.db);
  const mine = <T extends { clinicId: string; branchId: string; businessDate: string }>(
    rows: T[],
  ) =>
    rows.filter(
      (r) => r.clinicId === ctx.clinicId && reaches(ctx, r.branchId) && inRange(r.businessDate, q),
    );
  return { payments: mine(s.payments), refunds: mine(s.refunds) };
}

/** R1, as `finance_report_daily_takings` rolled up by the API. */
export function dailyTakings(ctx: ReportContext, q: Grouped) {
  const { payments, refunds } = movements(ctx, q);
  const flat = [
    ...payments.map((p) => ({ ...p, in: BigInt(p.amountMinor), out: 0n })),
    ...refunds.map((r) => ({ ...r, in: 0n, out: BigInt(r.amountMinor) })),
  ];
  const groups = groupBy(flat, (m) =>
    [periodOf(m.businessDate, q.groupBy), m.branchId, m.method, m.currency].join("|"),
  );
  const rows: TakingsRow[] = [...groups.values()]
    .map((g) => {
      const first = g[0]!;
      const inMinor = g.reduce((sum, m) => sum + m.in, 0n);
      const outMinor = g.reduce((sum, m) => sum + m.out, 0n);
      return {
        period: periodOf(first.businessDate, q.groupBy),
        branchId: first.branchId,
        branchName: branchNameOf(ctx, first.branchId),
        method: first.method,
        inMinor: inMinor.toString(),
        outMinor: outMinor.toString(),
        netMinor: (inMinor - outMinor).toString(),
        currency: first.currency,
      };
    })
    .sort(
      byKeys<TakingsRow>(
        (r) => r.period,
        (r) => r.branchId,
        (r) => r.method,
      ),
    );
  return {
    rows,
    totals: {
      inMinor: sumMinor(rows, (r) => r.inMinor),
      outMinor: sumMinor(rows, (r) => r.outMinor),
      netMinor: sumMinor(rows, (r) => r.netMinor),
    },
  };
}

type Part = Omit<SummaryRow, "branchName" | "voidCount" | `${string}Minor`> & {
  [K in "invoiced" | "discount" | "tax" | "collected" | "refunded" | "credit" | "voided"]?: bigint;
};

/** R2, as `finance_report_period_summary`: a void invoice counts only in its void count. */
export function periodSummary(ctx: ReportContext, q: Grouped) {
  const { payments, refunds } = movements(ctx, q);
  const invoices = financeState(ctx.db).invoices.filter(
    (i) =>
      i.clinicId === ctx.clinicId && reaches(ctx, i.branchId) && inRange(dayOf(i.issuedAt, ctx), q),
  );
  const byId = new Map(financeState(ctx.db).invoices.map((i) => [i.id, i]));
  const credits = paymentState(ctx.db).allocations.flatMap((a) => {
    const invoice = byId.get(a.invoiceId);
    // SQL 0068 uses the current timezone until the stored-day contract step ships.
    const day = dayOf(a.createdAt, ctx);
    if (a.creditId === null || a.clinicId !== ctx.clinicId || !invoice) return [];
    if (!reaches(ctx, invoice.branchId) || !inRange(day, q)) return [];
    return [{ day, branchId: invoice.branchId, currency: invoice.currency, a }];
  });
  const at = (day: string) => periodOf(day, q.groupBy);
  const parts: Part[] = [
    ...invoices.map((i) => ({
      period: at(dayOf(i.issuedAt, ctx)),
      branchId: i.branchId,
      currency: i.currency,
      ...(i.status === "issued"
        ? {
            invoiced: BigInt(i.totalMinor),
            discount: BigInt(i.discountMinor),
            tax: BigInt(i.taxMinor),
          }
        : { voided: 1n }),
    })),
    ...payments.map((p) => ({
      period: at(p.businessDate),
      branchId: p.branchId,
      currency: p.currency,
      collected: BigInt(p.amountMinor),
    })),
    ...refunds.map((r) => ({
      period: at(r.businessDate),
      branchId: r.branchId,
      currency: r.currency,
      refunded: BigInt(r.amountMinor),
    })),
    ...credits.map((c) => ({
      period: at(c.day),
      branchId: c.branchId,
      currency: c.currency,
      credit: BigInt(c.a.amountMinor),
    })),
  ];
  const groups = groupBy(parts, (p) => [p.period, p.branchId, p.currency].join("|"));
  const rows: SummaryRow[] = [...groups.values()]
    .map((g) => {
      const first = g[0]!;
      const sum = (k: keyof Part) =>
        g.reduce((total, p) => total + ((p[k] as bigint | undefined) ?? 0n), 0n).toString();
      return {
        period: first.period,
        branchId: first.branchId,
        branchName: branchNameOf(ctx, first.branchId),
        invoicedMinor: sum("invoiced"),
        discountMinor: sum("discount"),
        taxMinor: sum("tax"),
        collectedMinor: sum("collected"),
        refundedMinor: sum("refunded"),
        creditAppliedMinor: sum("credit"),
        voidCount: Number(sum("voided")),
        currency: first.currency,
      };
    })
    .sort(
      byKeys<SummaryRow>(
        (r) => r.period,
        (r) => r.branchId,
      ),
    );
  const total = (k: keyof SummaryRow) => sumMinor(rows, (r) => r[k] as string);
  return {
    rows,
    totals: {
      invoicedMinor: total("invoicedMinor"),
      discountMinor: total("discountMinor"),
      taxMinor: total("taxMinor"),
      collectedMinor: total("collectedMinor"),
      refundedMinor: total("refundedMinor"),
      creditAppliedMinor: total("creditAppliedMinor"),
      voidCount: rows.reduce((n, r) => n + r.voidCount, 0),
    },
  };
}

/** R9, as `finance_report_cash_closings`: the saved closings only, never their method totals. */
export function cashClosings(ctx: ReportContext, q: Range) {
  const rows = closingState(ctx.db)
    .closings.filter(
      (k) => k.clinicId === ctx.clinicId && reaches(ctx, k.branchId) && inRange(k.businessDate, q),
    )
    .sort(
      byKeys(
        (k) => k.businessDate,
        (k) => k.branchId,
        (k) => k.id,
      ),
    )
    .map((k) => ({
      closingId: k.id,
      branchId: k.branchId,
      branchName: branchNameOf(ctx, k.branchId),
      businessDate: k.businessDate,
      expectedMinor: k.expectedMinor,
      countedMinor: k.countedMinor,
      differenceMinor: k.differenceMinor,
      closedBy: k.closedBy,
      closedByName: staffNameOf(ctx, k.closedBy),
      notePresent: k.note !== null,
      currency: k.currency,
    }));
  return {
    rows,
    totals: {
      expectedMinor: sumMinor(rows, (r) => r.expectedMinor),
      countedMinor: sumMinor(rows, (r) => r.countedMinor),
      differenceMinor: sumMinor(rows, (r) => r.differenceMinor),
    },
  };
}
