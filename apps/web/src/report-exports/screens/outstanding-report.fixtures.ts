// Synthetic R5 pages: ids, names and invoice numbers resemble nothing real.
import type { ReportAgeBucket } from "@eyadex/contracts/finance-reports";
import type { OutstandingPage } from "./use-outstanding-pages";

export const R5_KEYS = ["view:report_patients:clinic", "view:invoices:clinic"];
export const BRANCH_A = "00000000-0000-7000-8000-0000000000b1";
export const BRANCH_B = "00000000-0000-7000-8000-0000000000b2";
export const PATIENT_ID = (n: number) =>
  `00000000-0000-7000-8000-0000000009${String(n).padStart(2, "0")}`;

export function row(n: number, bucket: ReportAgeBucket, owed: string, branchId = BRANCH_A) {
  return {
    invoiceId: `00000000-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`,
    invoiceNumber: `T-${n}`,
    branchId,
    branchName: branchId === BRANCH_A ? "Branch A" : "Branch B",
    businessDate: "2026-10-01",
    patientId: PATIENT_ID(n),
    patientName: `Test Patient ${n}`,
    totalMinor: (BigInt(owed) + 1000n).toString(),
    paidMinor: "1000",
    owedMinor: owed,
    ageBucket: bucket,
    currency: "KWD" as const,
  };
}

type Row = ReturnType<typeof row>;

/** The summary the API would send for these rows: one row per bucket and branch. */
export function summaryOf(rows: Row[]): OutstandingPage["summary"] {
  const map = new Map<string, OutstandingPage["summary"][number]>();
  for (const r of rows) {
    const key = `${r.ageBucket}|${r.branchId}`;
    const old = map.get(key);
    map.set(key, {
      ageBucket: r.ageBucket,
      branchId: r.branchId,
      invoiceCount: (old?.invoiceCount ?? 0) + 1,
      owedMinor: (BigInt(old?.owedMinor ?? "0") + BigInt(r.owedMinor)).toString(),
    });
  }
  return [...map.values()];
}

export function page(items: Row[], all: Row[], nextCursor: string | null): OutstandingPage {
  return {
    items,
    nextCursor,
    total: all.length,
    summary: summaryOf(all),
    currency: "KWD" as const,
    currencyExponent: 3,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
