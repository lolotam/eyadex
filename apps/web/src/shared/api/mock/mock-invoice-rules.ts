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
// new or changed lines need a current price; totals come from `computeInvoiceTotals` only.

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

const discountKey = (discount: DiscountInput | null) =>
  discount === null
    ? null
    : [discount.kind, discount.kind === "pct" ? discount.bp : discount.minor, discount.reason];
const serviceKey = (
  line: Extract<InvoiceLineInput, { kind: "service" }> | Invoice["lines"][number],
) =>
  JSON.stringify([
    line.serviceId,
    line.providerId,
    line.quantity,
    line.unitPriceMinor,
    discountKey(line.discount),
  ]);

/** As the API: each stored service line exempts one unchanged copy from needing a current price. */
export function checkServiceLines(
  db: MockState,
  clinicId: string,
  lines: readonly InvoiceLineInput[],
  previous: readonly Invoice["lines"][number][] = [],
): void {
  const unchanged = new Map<string, Invoice["lines"][number][]>();
  for (const line of previous) {
    if (line.kind !== "service") continue;
    const key = serviceKey(line);
    unchanged.set(key, [...(unchanged.get(key) ?? []), line]);
  }
  lines.forEach((line, position) => {
    if (line.kind !== "service") return;
    const old = unchanged.get(serviceKey(line))?.shift();
    if (!db.services.some((s) => s.clinicId === clinicId && s.id === line.serviceId)) {
      throw new ApiError("validation");
    }
    if (old === undefined && effectivePrice(db, line.serviceId, line.providerId) === null) {
      throw new ApiError("price_missing", undefined, { position });
    }
  });
}

export const carriesDiscount = (
  lines: readonly InvoiceLineInput[],
  invoiceDiscount: DiscountInput | null,
): boolean => invoiceDiscount !== null || lines.some((l) => l.discount !== null);

type DiscountedLine = {
  kind: string;
  serviceId?: string | null;
  providerId?: string | null;
  quantity: number;
  unitPriceMinor: string;
  discount: DiscountInput | null;
};

/**
 * Every discount's kind, value and reason with the line it sits on and that line's position (R1-14): a
 * change needs `create:discounts`, even a move between two identical lines. As the API, an undiscounted
 * line is not part of it, so adding or removing one after the discounted lines needs no discount key.
 */
export function discountsKey(
  lines: readonly DiscountedLine[],
  invoiceDiscount: DiscountInput | null,
): string {
  const one = (d: DiscountInput | null) =>
    d === null ? "-" : d.kind === "pct" ? `p:${d.bp}:${d.reason}` : `a:${d.minor}:${d.reason}`;
  const onLine = (l: DiscountedLine, position: number) =>
    [
      position,
      l.kind,
      l.serviceId ?? "-",
      l.providerId ?? "-",
      l.quantity,
      l.unitPriceMinor,
      one(l.discount),
    ].join(":");
  const discounted = lines.flatMap((l, position) =>
    l.discount === null ? [] : [onLine(l, position)],
  );
  return [one(invoiceDiscount), ...discounted].join("|");
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
