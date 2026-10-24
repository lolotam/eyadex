import type { Invoice, UpdateInvoiceRequest } from "@eyadex/contracts/finance";

// R1-14: what the discount key guards — every discount's kind, value and reason, with the line it sits
// on and that line's position, so it can neither change nor move, not even between two identical lines.
// An undiscounted line is not part of it: adding or removing one after the discounted lines needs no
// discount key (PR #78 review). Built field by field, since jsonb gives the stored discount back
// with its keys in another order.

/** الخصم كما بيخزّنه الفاتورة أو بيطلبه الفورم: نسبة أو مبلغ، مع سببه. */
export type DiscountLike = Invoice["invoiceDiscount"] | UpdateInvoiceRequest["invoiceDiscount"];

/** سطر بخصم: الحقول اللي بتركّب بصمته. */
export interface DiscountedLine {
  readonly kind: string;
  readonly serviceId?: string | null;
  readonly providerId?: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: string;
  readonly discount: DiscountLike;
}

/**
 * بصمة الخصم: نوعه وقيمته وسببه، مش بترتيب مفاتيح الـ jsonb.
 *
 * @param d الخصم
 * @returns `null` لو مفيش خصم، وإلا قيمته في مصفوفة
 */
export const canonical = (d: DiscountLike) =>
  d === null ? null : [d.kind, d.kind === "pct" ? d.bp : d.minor, d.reason];

/**
 * بصمة خصومات الفاتورة كلها: خصم الفاتورة نفسها، وخصم كل سطر فيه خصم بمكانه.
 *
 * @param invoice الفاتورة: سطورها وخصم الفاتورة
 * @returns نص بيتقارن بين الفاتورة قبل التعديل وبعده
 */
export const discountsOf = (invoice: {
  readonly lines: readonly DiscountedLine[];
  readonly invoiceDiscount: DiscountLike;
}) =>
  JSON.stringify([
    invoice.lines
      .map((l, position) => ({ l, position }))
      .filter(({ l }) => l.discount !== null)
      .map(({ l, position }) => [
        position,
        l.kind,
        l.serviceId ?? null,
        l.providerId ?? null,
        l.quantity,
        l.unitPriceMinor,
        canonical(l.discount),
      ]),
    canonical(invoice.invoiceDiscount),
  ]);

// بصمة السطر: هي اللي `discountsOf` بتقارنها سطر سطر، فلازم تبقى متطابقة حرفياً.
const lineKey = (line: DiscountedLine, position: number) =>
  JSON.stringify([
    position,
    line.kind,
    line.serviceId ?? null,
    line.providerId ?? null,
    line.quantity,
    line.unitPriceMinor,
    canonical(line.discount),
  ]);

/**
 * مين حط كل خصم بعد التعديل (EY-10.2): سطر من غير خصم مالهوش صاحب؛ سطر خصمه ما اتغيّرش (نفس مكانه ونوعه
 * وخدمته ودكتوره وكمتيته وسعره وخصمه) بياخد صاحب السطر قبل التعديل؛ أي سطر تاني — جديد أو اتنقل أو اتغيّر
 * — بياخد المحرّر. وخصم الفاتورة: من غير خصم بعد التعديل مالهوش صاحب، ونفس الخصم بياخد صاحبه القديم،
 * وأي تغيّر فيه بياخد المحرّر.
 *
 * @param input الفاتورة قبل التعديل وأصحاب خصوماتها، والفاتورة بعد التعديل، ومحرّر التعديل
 * @returns صاحب خصم الفاتورة وأصحاب سطور الفاتورة بعد التعديل، واحد لكل سطر
 */
export function discountAuthors(input: {
  readonly before: {
    readonly lines: readonly DiscountedLine[];
    readonly invoiceDiscount: DiscountLike;
  };
  readonly authors: {
    readonly invoice: string | null;
    readonly lines: ReadonlyMap<number, string | null>;
  };
  readonly after: {
    readonly lines: readonly DiscountedLine[];
    readonly invoiceDiscount: DiscountLike;
  };
  readonly editor: string;
}): { invoice: string | null; lines: (string | null)[] } {
  const owners = new Map<string, string | null>();
  input.before.lines.forEach((line, position) => {
    if (line.discount === null) return;
    owners.set(lineKey(line, position), input.authors.lines.get(position) ?? null);
  });
  const lines = input.after.lines.map((line, position) => {
    if (line.discount === null) return null;
    const owner = owners.get(lineKey(line, position));
    return owner === undefined ? input.editor : owner;
  });
  let invoice: string | null = null;
  if (input.after.invoiceDiscount !== null) {
    // canonical() builds a new array each time, so the two are compared as text, not by reference.
    const same =
      JSON.stringify(canonical(input.after.invoiceDiscount)) ===
      JSON.stringify(canonical(input.before.invoiceDiscount));
    invoice = same ? input.authors.invoice : input.editor;
  }
  return { invoice, lines };
}
