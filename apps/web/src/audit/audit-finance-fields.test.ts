import {
  CASH_CLOSING_AUDIT_FIELDS,
  REFUND_AUDIT_FIELDS,
} from "@eyadex/contracts/finance-audit-shapes";
import { describe, expect, it } from "vitest";

import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";

// Finance F2 slice 5: the API's audit allowlist for a refund and a cash closing is these contract lists
// (apps/api/src/modules/audit/domain/audit-snapshot.ts), so a field the API shows without a label here
// fails this test and never reaches the audit detail dialog as a raw name. `creditId` is the one field
// nested inside `spends`.
const FIELDS = [...REFUND_AUDIT_FIELDS, ...CASH_CLOSING_AUDIT_FIELDS, "creditId"];

describe("the refund and cash closing audit field labels", () => {
  for (const [lang, dict] of [
    ["ar", ar],
    ["en", en],
  ] as const) {
    it(`labels every refund and closing snapshot field (${lang})`, () => {
      const labels = dict.audit.fields as Record<string, string>;
      expect(FIELDS.filter((field) => !labels[field])).toEqual([]);
    });
  }

  it("labels the refund and closing actions in both languages", () => {
    for (const dict of [ar, en]) {
      expect(dict.audit.actions.refund.recorded).toBeTruthy();
      expect(dict.audit.actions.cash_closing.closed).toBeTruthy();
    }
  });
});
