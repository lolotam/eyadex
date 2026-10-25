import { dayInTimeZone } from "@eyadex/contracts/audit";
import type { Invoice } from "@eyadex/contracts/finance";
import type { StoredInvoice } from "./mock-finance-state";
import { newId } from "./mock-store";

// The API's `invoice-discounts.ts` (EY-10.2), mirrored: who set each discount is stored at issue, and on
// an edit an unchanged discount keeps its author while a new, moved or changed one takes the editor.

type Discount = Invoice["invoiceDiscount"];
type LineLike = {
  kind: string;
  serviceId?: string | null;
  providerId?: string | null;
  quantity: number;
  unitPriceMinor: string;
  discount: Discount;
};
type Meta = {
  businessDate: string | undefined;
  discountedBy: string | null;
  lineMeta: { id: string; discountedBy: string | null }[];
};

// Built field by field, so two discounts compare by value whatever their key order.
const canonical = (d: Discount) =>
  d === null ? null : [d.kind, d.kind === "pct" ? d.bp : d.minor, d.reason];

const lineKey = (line: LineLike, position: number) =>
  JSON.stringify([
    position,
    line.kind,
    line.serviceId ?? null,
    line.providerId ?? null,
    line.quantity,
    line.unitPriceMinor,
    canonical(line.discount),
  ]);

/** The authors after an edit, as the API's `discountAuthors`. */
export function discountAuthors(input: {
  before: { lines: readonly LineLike[]; invoiceDiscount: Discount };
  authors: { invoice: string | null; lines: readonly (string | null)[] };
  after: { lines: readonly LineLike[]; invoiceDiscount: Discount };
  editor: string;
}): { invoice: string | null; lines: (string | null)[] } {
  const owners = new Map<string, string | null>();
  input.before.lines.forEach((line, position) => {
    if (line.discount !== null) {
      owners.set(lineKey(line, position), input.authors.lines[position] ?? null);
    }
  });
  const lines = input.after.lines.map((line, position) => {
    if (line.discount === null) return null;
    const owner = owners.get(lineKey(line, position));
    return owner === undefined ? input.editor : owner;
  });
  let invoice: string | null = null;
  if (input.after.invoiceDiscount !== null) {
    const same =
      JSON.stringify(canonical(input.after.invoiceDiscount)) ===
      JSON.stringify(canonical(input.before.invoiceDiscount));
    invoice = same ? input.authors.invoice : input.editor;
  }
  return { invoice, lines };
}

/** The report fields of a new invoice: its clinic day, and the issuer on every discount it carries. */
export function issuedMeta(
  body: { lines: readonly LineLike[]; invoiceDiscount: Discount },
  issuer: string,
  issuedAt: string,
  timeZone: string,
): Meta {
  return {
    businessDate: dayInTimeZone(issuedAt, timeZone),
    discountedBy: body.invoiceDiscount === null ? null : issuer,
    lineMeta: body.lines.map((l) => ({
      id: newId(),
      discountedBy: l.discount === null ? null : issuer,
    })),
  };
}

/** The report fields after an edit: the day stays the issue day; the authors follow `discountAuthors`. */
export function editedMeta(
  invoice: StoredInvoice,
  body: { lines: readonly LineLike[]; invoiceDiscount: Discount },
  editor: string,
): Meta {
  const authors = discountAuthors({
    before: invoice,
    authors: {
      invoice: invoice.discountedBy ?? null,
      lines: invoice.lines.map((_, i) => invoice.lineMeta?.[i]?.discountedBy ?? null),
    },
    after: body,
    editor,
  });
  return {
    businessDate: invoice.businessDate,
    discountedBy: authors.invoice,
    lineMeta: authors.lines.map((discountedBy) => ({ id: newId(), discountedBy })),
  };
}
