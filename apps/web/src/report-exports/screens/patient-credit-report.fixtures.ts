// Synthetic R6 pages: ids and names resemble nothing real.
import type { PatientCreditPage } from "./use-patient-credit-pages";

export const R6_KEYS = ["view:report_patients:clinic", "view:payments:clinic"];
export const CREDIT_PATIENT_ID = (n: number) =>
  `00000000-0000-7000-8000-0000000007${String(n).padStart(2, "0")}`;

export function creditRow(n: number, balance: string) {
  return {
    patientId: CREDIT_PATIENT_ID(n),
    patientName: `Credit Person ${n}`,
    balanceMinor: balance,
    oldestCreditDay: "2026-09-15",
    currency: "KWD" as const,
  };
}

type Row = ReturnType<typeof creditRow>;

export function creditPage(items: Row[], all: Row[], nextCursor: string | null): PatientCreditPage {
  return { items, nextCursor, total: all.length, currency: "KWD", currencyExponent: 3 };
}
