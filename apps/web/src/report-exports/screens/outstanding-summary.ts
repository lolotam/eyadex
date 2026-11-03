import { reportAgeBucketSchema, type ReportAgeBucket } from "@eyadex/contracts/finance-reports-rows";

export const AGE_BUCKETS = reportAgeBucketSchema.options;

export type BucketTotal = { bucket: ReportAgeBucket; invoiceCount: number; owedMinor: string };
type SummaryRow = {
  ageBucket: ReportAgeBucket;
  branchId: string;
  invoiceCount: number;
  owedMinor: string;
};

/** Every bucket, in order, even when empty (0 invoices, zero owed). Sums are BigInt, never Number. */
export function bucketTotals(
  rows: readonly { ageBucket: ReportAgeBucket; owedMinor: string; invoiceCount?: number }[],
): BucketTotal[] {
  return AGE_BUCKETS.map((bucket) => {
    let owed = 0n;
    let count = 0;
    for (const row of rows) {
      if (row.ageBucket !== bucket) continue;
      owed += BigInt(row.owedMinor);
      count += row.invoiceCount ?? 1;
    }
    return { bucket, invoiceCount: count, owedMinor: owed.toString() };
  });
}

/** The response summary per branch, in first-seen order; each branch carries all four buckets. */
export function bucketTotalsByBranch(summary: readonly SummaryRow[]) {
  const ids: string[] = [];
  for (const row of summary) if (!ids.includes(row.branchId)) ids.push(row.branchId);
  return ids.map((branchId) => ({
    branchId,
    buckets: bucketTotals(summary.filter((row) => row.branchId === branchId)),
  }));
}
