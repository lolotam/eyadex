import { demoPdf } from "./mock-pdf-document";
import type { Invoice } from "@eyadex/contracts/finance";
import { formatMinor } from "@eyadex/contracts/money";

/**
 * The demo's stand-in for the API's invoice PDF: a one-page PDF with the number, date and totals
 * (Latin characters only). The real layout, Arabic text and logo come from the API's renderer.
 */
export function renderInvoicePdf(invoice: Invoice): Blob {
  const money = (minor: string) =>
    `${formatMinor(minor, invoice.currencyExponent)} ${invoice.currency}`;
  const rows = [
    `Invoice ${invoice.number}${invoice.status === "void" ? " (VOID)" : ""}`,
    `Issued ${invoice.issuedAt.slice(0, 10)}`,
    `Subtotal ${money(invoice.subtotalMinor)}`,
    `Discount ${money(invoice.discountMinor)}`,
    `Tax ${money(invoice.taxMinor)}`,
    `Total ${money(invoice.totalMinor)}`,
  ];
  return demoPdf(rows);
}
