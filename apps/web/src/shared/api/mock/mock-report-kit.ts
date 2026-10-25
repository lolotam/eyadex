import { dayInTimeZone } from "@eyadex/contracts/audit";
import { ApiError } from "../api-error";
import { fromCursor, toCursor } from "./mock-list-cursor";
import type { ReportContext } from "./mock-report-access";

// What every mock report shares with the API's report-sql.ts and report-totals.ts.

export const dayOf = (iso: string, ctx: ReportContext) => dayInTimeZone(iso, ctx.timeZone);

/** R1/R2 roll the days up into months, as `to_char(day, 'YYYY-MM')`. */
export const periodOf = (day: string, groupBy: "day" | "month") =>
  groupBy === "month" ? day.slice(0, 7) : day;

export const inRange = (day: string, q: { from: string; to: string }) =>
  day >= q.from && day <= q.to;

export const reaches = (ctx: ReportContext, branchId: string) => ctx.branchIds.includes(branchId);

/** Money summed as bigints, so no minor unit is ever rounded. */
export const sumMinor = <T>(rows: readonly T[], pick: (row: T) => string | bigint): string =>
  rows.reduce((sum, row) => sum + BigInt(pick(row)), 0n).toString();

/** PostgreSQL's ascending order on text and uuid columns, with NULL last. */
export function byKeys<T>(...keys: ((row: T) => string | null)[]) {
  return (a: T, b: T): number => {
    for (const key of keys) {
      const x = key(a);
      const y = key(b);
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      return x < y ? -1 : 1;
    }
    return 0;
  };
}

/** Groups rows under a text key, keeping the first-seen order. */
export function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  return groups;
}

export function branchNameOf(ctx: ReportContext, branchId: string): string {
  const name = ctx.branchNames.get(branchId);
  if (name === undefined) throw new ApiError("unknown");
  return name;
}

/** `displayNames`: the patient's name only; no file-open audit row. */
export function patientNameOf(ctx: ReportContext, patientId: string): string {
  const p = ctx.db.patients.find((x) => x.clinicId === ctx.clinicId && x.id === patientId);
  if (!p) throw new ApiError("unknown");
  return p.fullName;
}

/** The staff directory by membership id; null when the membership is gone. */
export function staffNameOf(ctx: ReportContext, membershipId: string): string | null {
  const m = ctx.db.members.find((x) => x.clinicId === ctx.clinicId && x.id === membershipId);
  return m?.fullName ?? null;
}

/** `reportPage`: newest id first, the cursor is the last id without dashes, the total ignores it. */
export function reportPage<T extends { rowId: string }>(
  rows: readonly T[],
  query: { cursor?: string | undefined; limit: number },
): { rows: Omit<T, "rowId">[]; nextCursor: string | null; total: number } {
  const after = query.cursor === undefined ? null : fromCursor(query.cursor);
  const sorted = [...rows].sort((a, b) => (a.rowId < b.rowId ? 1 : a.rowId > b.rowId ? -1 : 0));
  const rest = after === null ? sorted : sorted.filter((r) => r.rowId < after);
  const page = rest.slice(0, query.limit);
  const last = page.at(-1);
  return {
    rows: page.map(({ rowId: _rowId, ...row }) => row),
    total: rows.length,
    nextCursor: rest.length > query.limit && last ? toCursor(last.rowId) : null,
  };
}
