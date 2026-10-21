import { describe, expect, it } from "vitest";

import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";

// Finance F2 slice 5: every field the API keeps in a refund or a cash closing snapshot
// (apps/api/src/modules/audit/domain/audit-snapshot.ts) and the note length beside a closing gets a
// label, so the audit detail dialog never shows a raw field name.
const REFUND_FIELDS = [
  "refundNumber",
  "invoiceNumber",
  "method",
  "amountMinor",
  "currency",
  "cashSeq",
  "source",
  "receiptNumber",
  "spends",
  "creditId",
];
const CLOSING_FIELDS = [
  "businessDate",
  "fromCashSeq",
  "toCashSeq",
  "expectedMinor",
  "countedMinor",
  "differenceMinor",
  "currency",
  "previousClosingId",
  "noteLength",
];

describe("the refund and cash closing audit field labels", () => {
  for (const [lang, dict] of [
    ["ar", ar],
    ["en", en],
  ] as const) {
    it(`labels every refund and closing snapshot field (${lang})`, () => {
      const labels = dict.audit.fields as Record<string, string>;
      const missing = [...REFUND_FIELDS, ...CLOSING_FIELDS].filter((field) => !labels[field]);
      expect(missing).toEqual([]);
    });
  }

  it("labels the refund and closing actions in both languages", () => {
    for (const dict of [ar, en]) {
      expect(dict.audit.actions.refund.recorded).toBeTruthy();
      expect(dict.audit.actions.cash_closing.closed).toBeTruthy();
    }
  });
});
