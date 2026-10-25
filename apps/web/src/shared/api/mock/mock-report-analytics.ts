import { financeState, type StoredInvoice } from "./mock-finance-state";
import { isOwnPatient } from "./mock-own-scope";
import type { ReportContext } from "./mock-report-access";
import { byKeys, dayOf, groupBy, inRange, reaches, staffNameOf, sumMinor } from "./mock-report-kit";

type Range = { from: string; to: string };
type Line = StoredInvoice["lines"][number];
type Row<K extends string> = {
  kind: K;
  id: string | null;
  lineCount: number;
  quantity: number;
  amountMinor: string;
  currency: StoredInvoice["currency"];
};

/** The live lines of the issued invoices whose issue day is in range (the `billed` CTE of 0068). */
function billed(ctx: ReportContext, q: Range) {
  return financeState(ctx.db).invoices.filter(
    (i) =>
      i.clinicId === ctx.clinicId &&
      i.status === "issued" &&
      reaches(ctx, i.branchId) &&
      inRange(dayOf(i.issuedAt, ctx), q),
  );
}

/** The rows of R3/R4: the lines grouped, then one tax row when the range carried any tax. */
function rowsOf<K extends string>(
  invoices: readonly StoredInvoice[],
  group: (line: Line) => { kind: K; id: string | null },
): Row<K | "tax">[] {
  const lines = invoices.flatMap((i) => i.lines.map((line) => ({ line, currency: i.currency })));
  const groups = groupBy(lines, ({ line, currency }) => {
    const g = group(line);
    return [g.kind, g.id ?? "", currency].join("|");
  });
  const rows: Row<K | "tax">[] = [...groups.values()].map((g) => ({
    ...group(g[0]!.line),
    lineCount: g.length,
    quantity: g.reduce((n, x) => n + x.line.quantity, 0),
    amountMinor: sumMinor(g, (x) => x.line.lineTotalMinor),
    currency: g[0]!.currency,
  }));
  for (const [, same] of groupBy(invoices, (i) => i.currency)) {
    const tax = sumMinor(same, (i) => i.taxMinor);
    if (tax !== "0") {
      rows.push({
        kind: "tax",
        id: null,
        lineCount: 0,
        quantity: 0,
        amountMinor: tax,
        currency: same[0]!.currency,
      });
    }
  }
  return rows.sort(
    byKeys(
      (r) => r.kind,
      (r) => r.id,
    ),
  );
}

/** The API's `analyticsTotals`: the tax is part of the total, not of the billed lines nor their count. */
function totalsOf(
  rows: readonly { kind: string; lineCount: number; quantity: number; amountMinor: string }[],
) {
  return {
    lineCount: rows.reduce((n, r) => n + r.lineCount, 0),
    quantity: rows.reduce((n, r) => n + r.quantity, 0),
    billedMinor: sumMinor(
      rows.filter((r) => r.kind !== "tax"),
      (r) => r.amountMinor,
    ),
    taxMinor: sumMinor(
      rows.filter((r) => r.kind === "tax"),
      (r) => r.amountMinor,
    ),
    totalMinor: sumMinor(rows, (r) => r.amountMinor),
  };
}

const ar = (ctx: ReportContext) => ctx.language === "ar";

/** R3: billed per service; free lines are one row, the tax another. */
export function byService(ctx: ReportContext, q: Range) {
  const rows = rowsOf(billed(ctx, q), (l) => ({
    kind: l.kind,
    id: l.kind === "service" ? l.serviceId : null,
  })).map(({ id, ...r }) => {
    const service = ctx.db.services.find((s) => s.clinicId === ctx.clinicId && s.id === id);
    const name =
      r.kind === "tax"
        ? ar(ctx)
          ? "الضريبة"
          : "Tax"
        : r.kind === "free"
          ? ar(ctx)
            ? "بنود حرة"
            : "Free lines"
          : ((ar(ctx) ? service?.nameAr : service?.nameEn) ?? "—");
    return { ...r, serviceId: id, name };
  });
  return { rows, totals: totalsOf(rows) };
}

/** R4: billed per doctor; lines with no doctor are one row, the tax another. */
export function byDoctor(ctx: ReportContext, q: Range) {
  const rows = rowsOf(billed(ctx, q), (l) => ({
    kind: l.providerId === null ? ("none" as const) : ("doctor" as const),
    id: l.providerId,
  })).map(({ id, ...r }) => {
    const name =
      r.kind === "tax"
        ? ar(ctx)
          ? "الضريبة"
          : "Tax"
        : r.kind === "none"
          ? ar(ctx)
            ? "بدون دكتور"
            : "No doctor"
          : (staffNameOf(ctx, id!) ?? "—");
    return { ...r, providerId: id, name };
  });
  return { rows, totals: totalsOf(rows) };
}

/** R10: the doctor's own live lines on issued invoices of his own patients, per clinic month. */
export function ownSummary(ctx: ReportContext, q: Range) {
  const me = ctx.access.member.id;
  const lines = billed(ctx, q)
    .filter((i) => isOwnPatient(ctx.db, ctx.clinicId, me, i.patientId))
    .flatMap((i) =>
      i.lines
        .filter((l) => l.providerId === me)
        .map((l) => ({ period: dayOf(i.issuedAt, ctx).slice(0, 7), l, currency: i.currency })),
    );
  const rows = [...groupBy(lines, (x) => `${x.period}|${x.currency}`).values()]
    .map((g) => ({
      period: g[0]!.period,
      billedMinor: sumMinor(g, (x) => x.l.lineTotalMinor),
      currency: g[0]!.currency,
    }))
    .sort(byKeys((r) => r.period));
  return { rows, totals: { billedMinor: sumMinor(rows, (r) => r.billedMinor) } };
}
