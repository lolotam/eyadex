import type {
  CreateInvoiceRequest,
  DiscountInput,
  Invoice,
  InvoiceDraft,
  InvoiceLineInput,
} from "@eyadex/contracts/finance";
import {
  computeInvoiceTotals,
  TotalsError,
  type Discount,
  type Totals,
} from "@eyadex/contracts/invoice-totals";
import { formatMinor, parseMajorToMinor } from "@eyadex/contracts/money";

// The invoice form's values and their mapping to the request (pure, tested). Amounts are typed in
// major units and converted with the clinic's exponent; percentages are typed as percent (12.5).

export type DiscountValues = { kind: "pct" | "amount"; value: string; reason: string } | null;
export type LineValues =
  | {
      kind: "service";
      serviceId: string;
      providerId: string | null;
      quantity: number;
      unitPrice: string;
      discount: DiscountValues;
    }
  | {
      kind: "free";
      descriptionAr: string;
      descriptionEn: string;
      quantity: number;
      unitPrice: string;
      discount: DiscountValues;
    };
export type InvoiceFormValues = {
  patientId: string | null;
  branchId: string | null;
  lines: LineValues[];
  invoiceDiscount: DiscountValues;
};

const discountValues = (d: DiscountInput | null, exponent: number): DiscountValues =>
  d === null
    ? null
    : d.kind === "pct"
      ? { kind: "pct", value: String(d.bp / 100), reason: d.reason }
      : { kind: "amount", value: formatMinor(d.minor, exponent), reason: d.reason };

function lineValues(line: InvoiceLineInput, exponent: number): LineValues {
  const common = {
    quantity: line.quantity,
    unitPrice: formatMinor(line.unitPriceMinor, exponent),
    discount: discountValues(line.discount, exponent),
  };
  return line.kind === "service"
    ? { kind: "service", serviceId: line.serviceId, providerId: line.providerId, ...common }
    : {
        kind: "free",
        descriptionAr: line.descriptionAr,
        descriptionEn: line.descriptionEn,
        ...common,
      };
}

export function valuesFromDraft(draft: InvoiceDraft, exponent: number): InvoiceFormValues {
  return {
    patientId: draft.patientId,
    branchId: draft.branchId,
    lines: draft.lines.map((l) => lineValues(l, exponent)),
    invoiceDiscount: null,
  };
}

export function valuesFromInvoice(invoice: Invoice, exponent: number): InvoiceFormValues {
  return {
    patientId: invoice.patientId,
    branchId: invoice.branchId,
    lines: invoice.lines.map((l) =>
      lineValues(
        l.kind === "service"
          ? {
              kind: "service",
              serviceId: l.serviceId!,
              providerId: l.providerId,
              quantity: l.quantity,
              unitPriceMinor: l.unitPriceMinor,
              discount: l.discount,
            }
          : {
              kind: "free",
              descriptionAr: l.descriptionAr,
              descriptionEn: l.descriptionEn,
              quantity: l.quantity,
              unitPriceMinor: l.unitPriceMinor,
              discount: l.discount,
            },
        exponent,
      ),
    ),
    invoiceDiscount: discountValues(invoice.invoiceDiscount, exponent),
  };
}

/** A percent text ("12.5") as basis points, or null. */
export function percentToBp(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bp <= 10000 ? bp : null;
}

/** The discount as the request carries it, or null when its value does not parse. */
export function toDiscountInput(
  d: DiscountValues,
  exponent: number,
): DiscountInput | null | "invalid" {
  if (d === null) return null;
  if (d.kind === "pct") {
    const bp = percentToBp(d.value);
    return bp === null ? "invalid" : { kind: "pct", bp, reason: d.reason.trim() };
  }
  const minor = parseMajorToMinor(d.value, exponent);
  return minor === null ? "invalid" : { kind: "amount", minor, reason: d.reason.trim() };
}

/** The request lines, or null when an amount or discount does not parse. */
export function toLineInputs(lines: LineValues[], exponent: number): InvoiceLineInput[] | null {
  const out: InvoiceLineInput[] = [];
  for (const line of lines) {
    const unitPriceMinor = parseMajorToMinor(line.unitPrice, exponent);
    const discount = toDiscountInput(line.discount, exponent);
    if (unitPriceMinor === null || discount === "invalid") return null;
    out.push(
      line.kind === "service"
        ? {
            kind: "service",
            serviceId: line.serviceId,
            providerId: line.providerId,
            quantity: line.quantity,
            unitPriceMinor,
            discount,
          }
        : {
            kind: "free",
            descriptionAr: line.descriptionAr.trim(),
            descriptionEn: line.descriptionEn.trim(),
            quantity: line.quantity,
            unitPriceMinor,
            discount,
          },
    );
  }
  return out;
}

/** A sourced invoice sends only source + sourceId; a manual one names the patient and branch. */
export function toCreateRequest(
  values: InvoiceFormValues,
  source: { source: "appointment" | "visit"; sourceId: string } | null,
  exponent: number,
): CreateInvoiceRequest | null {
  const lines = toLineInputs(values.lines, exponent);
  const invoiceDiscount = toDiscountInput(values.invoiceDiscount, exponent);
  if (lines === null || invoiceDiscount === "invalid") return null;
  return source
    ? {
        source: source.source,
        sourceId: source.sourceId,
        patientId: null,
        branchId: null,
        lines,
        invoiceDiscount,
      }
    : {
        source: "manual",
        sourceId: null,
        patientId: values.patientId,
        branchId: values.branchId,
        lines,
        invoiceDiscount,
      };
}

const asDiscount = (d: DiscountInput | null): Discount | null =>
  d === null
    ? null
    : d.kind === "pct"
      ? { kind: "pct", bp: d.bp }
      : { kind: "amount", minor: BigInt(d.minor) };

/** Live totals through the shared helper; null while the form does not parse or the discount overflows. */
export function liveTotals(
  values: InvoiceFormValues,
  exponent: number,
  taxRateBp: number,
): Totals | "discount_exceeds_total" | null {
  const lines = toLineInputs(values.lines, exponent);
  const invoiceDiscount = toDiscountInput(values.invoiceDiscount, exponent);
  if (lines === null || invoiceDiscount === "invalid") return null;
  try {
    return computeInvoiceTotals({
      lines: lines.map((l, position) => ({
        position,
        quantity: l.quantity,
        unitPriceMinor: BigInt(l.unitPriceMinor),
        discount: asDiscount(l.discount),
      })),
      invoiceDiscount: asDiscount(invoiceDiscount),
      taxRateBp,
    });
  } catch (error) {
    if (error instanceof TotalsError && error.code === "discount_exceeds_total") {
      return "discount_exceeds_total";
    }
    return null;
  }
}
