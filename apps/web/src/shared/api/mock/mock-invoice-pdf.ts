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
  const text = rows
    .map((row, i) => `BT /F1 14 Tf 60 ${760 - i * 26} Td (${row.replace(/[()\\]/g, "")}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([body], { type: "application/pdf" });
}
