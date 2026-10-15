import type { DiscountInput, Invoice, InvoiceLineInput } from "@eyadex/contracts/finance";
import {
  computeInvoiceTotals,
  TotalsError,
  type Discount,
  type Totals,
} from "@eyadex/contracts/invoice-totals";
import { ApiError } from "../api-error";
import { effectivePrice } from "./mock-finance-state";
import type { MockState } from "./mock-store";

// The API's invoice line and totals rules (invoice-lines.ts, the shared totals helper): service
// lines name a clinic service that has a price; totals come from `computeInvoiceTotals` only.

const toDiscount = (d: DiscountInput | null): Discount | null =>
  d === null
    ? null
    : d.kind === "pct"
      ? { kind: "pct", bp: d.bp }
      : { kind: "amount", minor: BigInt(d.minor) };

export function totalsOf(
  lines: readonly InvoiceLineInput[],
  invoiceDiscount: DiscountInput | null,
  taxRateBp: number,
): Totals {
  try {
    return computeInvoiceTotals({
      lines: lines.map((line, position) => ({
        position,
        quantity: line.quantity,
        unitPriceMinor: BigInt(line.unitPriceMinor),
        discount: toDiscount(line.discount),
      })),
      invoiceDiscount: toDiscount(invoiceDiscount),
      taxRateBp,
    });
  } catch (error) {
    if (error instanceof TotalsError && error.code === "discount_exceeds_total") {
      throw new ApiError("discount_exceeds_total");
    }
    throw new ApiError("validation");
  }
}

/** Unknown service → validation; a service with no provider or base price → price_missing. */
export function checkServiceLines(
  db: MockState,
  clinicId: string,
  lines: readonly InvoiceLineInput[],
): void {
  lines.forEach((line, position) => {
    if (line.kind !== "service") return;
    if (!db.services.some((s) => s.clinicId === clinicId && s.id === line.serviceId)) {
      throw new ApiError("validation");
    }
    if (effectivePrice(db, line.serviceId, line.providerId) === null) {
      throw new ApiError("price_missing", undefined, { position });
    }
  });
}

export const carriesDiscount = (
  lines: readonly InvoiceLineInput[],
  invoiceDiscount: DiscountInput | null,
): boolean => invoiceDiscount !== null || lines.some((l) => l.discount !== null);

/** Every discount's place, kind, value and reason (R1-14): a change needs `create:discounts`. */
export function discountsKey(
  lines: readonly { discount: DiscountInput | null }[],
  invoiceDiscount: DiscountInput | null,
): string {
  const one = (d: DiscountInput | null) =>
    d === null ? "-" : d.kind === "pct" ? `p:${d.bp}:${d.reason}` : `a:${d.minor}:${d.reason}`;
  return [one(invoiceDiscount), ...lines.map((l) => one(l.discount))].join("|");
}

/** The stored lines: service lines copy the service's names, totals come from the helper. */
export function storedLines(
  db: MockState,
  lines: readonly InvoiceLineInput[],
  totals: Totals,
): Invoice["lines"] {
  return lines.map((line, position) => {
    const common = {
      position,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      discount: line.discount,
      lineTotalMinor: totals.lines[position]!.lineTotalMinor.toString(),
    };
    if (line.kind === "free") {
      return {
        ...common,
        kind: "free" as const,
        serviceId: null,
        providerId: null,
        descriptionAr: line.descriptionAr,
        descriptionEn: line.descriptionEn,
      };
    }
    const service = db.services.find((s) => s.id === line.serviceId)!;
    return {
      ...common,
      kind: "service" as const,
      serviceId: line.serviceId,
      providerId: line.providerId,
      descriptionAr: service.nameAr,
      descriptionEn: service.nameEn,
    };
  });
}

export const formatInvoiceNumber = (prefix: string, year: number, seq: number): string =>
  `${prefix}-${year}-${String(seq).padStart(6, "0")}`;

export function totalsFields(totals: Totals) {
  return {
    subtotalMinor: totals.subtotalMinor.toString(),
    discountMinor: totals.discountMinor.toString(),
    taxMinor: totals.taxMinor.toString(),
    totalMinor: totals.totalMinor.toString(),
  };
}
