import type { Invoice } from "@eyadex/contracts/finance";
import { SUPPORTED_CURRENCIES, type CurrencyCode } from "@eyadex/contracts/money";
import type { MockState } from "./mock-store";

export type StoredClinicFinance = {
  currency: CurrencyCode;
  taxRateBp: number;
  commercialRegNo: string | null;
  hasLogo: boolean;
};
export type StoredPrice = {
  priceMinor: string | null;
  providerPrices: { memberId: string; priceMinor: string }[];
};
export type StoredInvoice = Invoice & { clinicId: string };

export type FinanceMockState = {
  clinics: Record<string, StoredClinicFinance>;
  /** By service id. */
  prices: Record<string, StoredPrice>;
  /** By branch id. A prefix is locked once an invoice was numbered with it. */
  prefixes: Record<string, string>;
  /** `clinicId:prefix` → the branch that issued with it; never reused by another branch (R1-9). */
  usedPrefixes: Record<string, string>;
  /** `branchId:year` → the last number issued; a refused issue never takes one. */
  counters: Record<string, number>;
  invoices: StoredInvoice[];
  idempotentInvoices: Record<string, { invoiceId: string; fingerprint: string }>;
  /** `clinicId:sendRequestId` → the first send, replayed on a retry. */
  sends: Record<string, { invoiceId: string; channel: string; notificationId: string }>;
};

/** Logo bytes stay in memory only, like demo attachments: never in browser storage. */
export const mockLogos = new Map<string, Blob>();

/** Fictional demo prefixes, in branch order (the API leaves new clinics without one). */
const DEMO_PREFIXES = ["SLM", "HWL", "FRW", "JHR", "AHM", "MNG"];

export function financeState(db: MockState): FinanceMockState {
  if (db.finance) return db.finance;
  const prefixes: Record<string, string> = {};
  for (const clinic of db.clinics) {
    db.branches
      .filter((b) => b.clinicId === clinic.id)
      .forEach((b, i) => {
        prefixes[b.id] = DEMO_PREFIXES[i] ?? `B${i + 1}`;
      });
  }
  db.finance = {
    clinics: {},
    prices: {},
    prefixes,
    usedPrefixes: {},
    counters: {},
    invoices: [],
    idempotentInvoices: {},
    sends: {},
  };
  return db.finance;
}

export function clinicFinanceOf(db: MockState, clinicId: string): StoredClinicFinance {
  const state = financeState(db);
  return (state.clinics[clinicId] ??= {
    currency: "KWD",
    taxRateBp: 0,
    commercialRegNo: null,
    hasLogo: false,
  });
}

export const exponentOf = (currency: CurrencyCode): number => SUPPORTED_CURRENCIES[currency];

export function priceOf(db: MockState, serviceId: string): StoredPrice {
  return financeState(db).prices[serviceId] ?? { priceMinor: null, providerPrices: [] };
}

/** The provider's own price, else the service's base price, else null (as `effectivePrice`). */
export function effectivePrice(
  db: MockState,
  serviceId: string,
  providerId: string | null,
): string | null {
  const price = priceOf(db, serviceId);
  const own = providerId ? price.providerPrices.find((p) => p.memberId === providerId) : undefined;
  return own?.priceMinor ?? price.priceMinor;
}

export const clinicHasInvoice = (db: MockState, clinicId: string): boolean =>
  financeState(db).invoices.some((i) => i.clinicId === clinicId);

/** Is this branch's prefix locked: an invoice has been numbered with it. */
export function prefixLocked(db: MockState, clinicId: string, branchId: string): boolean {
  const prefix = financeState(db).prefixes[branchId];
  return prefix !== undefined && financeState(db).usedPrefixes[`${clinicId}:${prefix}`] === branchId;
}

/** "YYYY-MM" of an instant in the clinic's time zone (invoice years and monthly totals, FIN-3). */
export function clinicMonth(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" })
    .formatToParts(new Date(iso));
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}
