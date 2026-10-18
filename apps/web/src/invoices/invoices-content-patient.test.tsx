import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvoiceListItem } from "@/shared/api/finance-client";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicesContent } from "./invoices-content";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({ session: { permissions: [] } }),
}));
vi.mock("./invoice-options", () => ({ useInvoiceOptions: () => ({ branches: [] }) }));
vi.mock("./invoice-patient-picker", () => ({ InvoicePatientPicker: () => null }));

const items = vi.hoisted(() => {
  const base = {
    status: "issued",
    source: "manual",
    sourceId: null,
    branchId: "00000000-0000-7000-8000-000000000002",
    branchNameAr: "فرع",
    branchNameEn: "Branch",
    issuedAt: "2026-10-15T09:00:00.000Z",
    currency: "KWD",
    currencyExponent: 3,
    subtotalMinor: "1000",
    discountMinor: "0",
    taxRateBp: 0,
    taxMinor: "0",
    totalMinor: "1000",
    invoiceDiscount: null,
    voidReason: null,
    voidedAt: null,
    version: 1,
  };
  return [
    {
      ...base,
      id: "00000000-0000-7000-8000-00000000000a",
      number: "TT-2026-000001",
      patientId: "00000000-0000-7000-8000-0000000000a1",
      patientName: "مراجع تجريبي أ",
    },
    {
      ...base,
      id: "00000000-0000-7000-8000-00000000000b",
      number: "TT-2026-000002",
      patientId: "00000000-0000-7000-8000-0000000000b1",
      patientName: "مراجع تجريبي ب",
    },
  ] as InvoiceListItem[];
});
vi.mock("./invoice-queries", () => ({
  useInvoiceList: () => ({ data: { items, total: 2, nextCursor: null }, isLoading: false }),
}));

afterEach(cleanup);

describe("the invoice list's patient names", () => {
  it("shows each row's own name, never as a link to a patient file", () => {
    render(
      <I18nProvider manageDocument={false}>
        <InvoicesContent />
      </I18nProvider>,
    );
    for (const item of items) {
      const row = screen.getByRole("row", { name: new RegExp(item.number) });
      expect(within(row).getByText(item.patientName)).toBeTruthy();
    }
    for (const link of screen.getAllByRole("link")) {
      expect(link.textContent).not.toMatch(/مراجع تجريبي/);
      expect(link.getAttribute("href") ?? "").not.toContain("/clinic/patients");
    }
  });
});
