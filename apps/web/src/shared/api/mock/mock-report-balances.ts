import type { ReportAgeBucket } from "@eyadex/contracts/finance-reports";
import { financeState } from "./mock-finance-state";
import { paymentState } from "./mock-payment-state";
import type { ReportContext } from "./mock-report-access";
import {
  branchNameOf,
  byKeys,
  dayOf,
  groupBy,
  inRange,
  patientNameOf,
  reaches,
  reportPage,
  sumMinor,
} from "./mock-report-kit";
import { settlementOf } from "./mock-settlement";

type PageQuery = { from: string; to: string; cursor?: string; limit: number };

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** F3-Q2 a: the age from the issue day to the clinic's today. */
export function ageBucket(issueDay: string, today: string): ReportAgeBucket {
  const age = daysBetween(issueDay, today);
  if (age <= 30) return "0_30";
  if (age <= 60) return "31_60";
  if (age <= 90) return "61_90";
  return "over_90";
}

/** R5, from `finance_invoice_balances`: issued invoices still owing, issued in range. */
export function outstanding(ctx: ReportContext, q: PageQuery, now: Date) {
  const today = dayOf(now.toISOString(), ctx);
  const all = financeState(ctx.db).invoices.flatMap((i) => {
    const day = dayOf(i.issuedAt, ctx);
    if (i.clinicId !== ctx.clinicId || i.status !== "issued") return [];
    if (!reaches(ctx, i.branchId) || !inRange(day, q)) return [];
    const settlement = settlementOf(ctx.db, i);
    const paid = settlement?.paidMinor ?? "0";
    const owed = (BigInt(i.totalMinor) - BigInt(paid)).toString();
    if (BigInt(owed) <= 0n) return [];
    return [
      {
        rowId: i.id,
        invoiceId: i.id,
        invoiceNumber: i.number,
        branchId: i.branchId,
        businessDate: day,
        patientId: i.patientId,
        totalMinor: i.totalMinor,
        paidMinor: paid,
        owedMinor: owed,
        ageBucket: ageBucket(day, today),
        currency: i.currency,
      },
    ];
  });
  // The summary describes the filtered report, so the cursor never narrows its buckets.
  const summary = [...groupBy(all, (r) => `${r.ageBucket}|${r.branchId}`).values()]
    .map((g) => ({
      ageBucket: g[0]!.ageBucket,
      branchId: g[0]!.branchId,
      invoiceCount: g.length,
      owedMinor: sumMinor(g, (r) => r.owedMinor),
    }))
    .sort(
      byKeys(
        (r) => r.branchId,
        (r) => r.ageBucket,
      ),
    );
  const page = reportPage(all, q);
  return {
    items: page.rows.map((r) => ({
      ...r,
      branchName: branchNameOf(ctx, r.branchId),
      patientName: patientNameOf(ctx, r.patientId),
    })),
    nextCursor: page.nextCursor,
    total: page.total,
    summary,
  };
}

/**
 * R6: available credit per patient — each credit less the allocations it funded and the refunds that
 * spent it. A clinic-wide balance, so neither the range nor a branch cuts its ledger.
 */
export function patientCredit(ctx: ReportContext, q: PageQuery) {
  const s = paymentState(ctx.db);
  const credits = s.credits
    .filter((c) => c.clinicId === ctx.clinicId)
    .map((c) => {
      const funded = s.allocations.filter(
        (a) => a.clinicId === ctx.clinicId && a.creditId === c.id,
      );
      const refunded = s.refundSources.filter(
        (r) => r.clinicId === ctx.clinicId && r.creditId === c.id,
      );
      const spent =
        BigInt(sumMinor(funded, (a) => a.amountMinor)) +
        BigInt(sumMinor(refunded, (r) => r.amountMinor));
      return { c, remaining: BigInt(c.amountMinor) - spent };
    });
  const rows = [...groupBy(credits, (x) => x.c.patientId).values()].flatMap((g) => {
    const balance = g.reduce((sum, x) => sum + x.remaining, 0n);
    if (balance <= 0n) return [];
    const days = g.filter((x) => x.remaining > 0n).map((x) => dayOf(x.c.createdAt, ctx));
    const patientId = g[0]!.c.patientId;
    return [
      {
        rowId: patientId,
        patientId,
        balanceMinor: balance.toString(),
        oldestCreditDay: days.sort()[0]!,
        currency: ctx.facts.currency,
      },
    ];
  });
  const page = reportPage(rows, q);
  return {
    items: page.rows.map((r) => ({ ...r, patientName: patientNameOf(ctx, r.patientId) })),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}
