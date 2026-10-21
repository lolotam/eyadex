import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PermissionMatrix } from "./permission-matrix";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// F2 card 1 §0: the finance group shows payments, refunds and the cash closing from the catalogue.
describe("the permission matrix's F2 rows", () => {
  for (const [lang, dict] of [
    ["ar", ar],
    ["en", en],
  ] as const) {
    it(`lists payments, refunds and cash closings in ${lang}`, () => {
      localStorage.setItem("eyadex:language", lang);
      render(
        <I18nProvider>
          <PermissionMatrix
            catalog={[...PERMISSION_CATALOG]}
            value={[]}
            onChange={vi.fn()}
            readOnly={false}
          />
        </I18nProvider>,
      );
      for (const resource of ["payments", "refunds", "cash_closings"] as const) {
        expect(screen.getAllByText(dict.roles.resources[resource]).length).toBeGreaterThan(0);
      }
    });
  }
});
