import type { ReceiptPdfModel } from "../../src/modules/billing/domain/receipt-pdf-model.ts";

export function receiptSource(
  model: ReceiptPdfModel,
  options?: { logoFile?: "logo.png" | "logo.jpg" | null },
): { source: string; words: Record<string, string>; fields: string[] };
