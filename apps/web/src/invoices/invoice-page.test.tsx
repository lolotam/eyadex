import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@eyadex/contracts/finance";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicePage } from "./invoice-page";

const OWN = "00000000-0000-7000-8000-0000000000b1";
const OTHER = "00000000-0000-7000-8000-0000000000b2";

const state = vi.hoisted(() => ({ invoice: null as unknown }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#invoices">{children}</a>,
}));
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => ({ finance: {} }) }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
  // A clinic-wide view with branch-scoped writes, in branch OWN only.
  useSession: () => ({
    isLoading: false,
    session: {
      permissions: ["view:invoices:clinic", "update:invoices:branch", "deactivate:invoices:branch"],
      allBranches: false,
      branchIds: [OWN],
    },
  }),
}));
vi.mock("./invoice-queries", () => ({
  useInvoice: () => ({ isLoading: false, error: null, data: state.invoice }),
  useRefreshInvoices: () => () => undefined,
}));
vi.mock("./invoice-patient-name", () => ({ InvoicePatientName: () => null }));

const invoiceAt = (branchId: string): Invoice => ({
  id: "00000000-0000-7000-8000-000000000001",
  number: "SLMR-2026-000001",
  status: "issued",
  source: "manual",
  sourceId: null,
  branchId,
  branchNameAr: "فرع",
  branchNameEn: "Branch",
  patientId: "00000000-0000-7000-8000-000000000003",
  issuedAt: "2026-10-15T09:00:00.000Z",
  currency: "KWD",
  currencyExponent: 3,
  subtotalMinor: "1000",
  discountMinor: "0",
  taxRateBp: 0,
  taxMinor: "0",
  totalMinor: "1000",
  invoiceDiscount: null,
  lines: [],
  voidReason: null,
  voidedAt: null,
  version: 1,
});

function show(branchId: string) {
  state.invoice = invoiceAt(branchId);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider manageDocument={false}>
        <InvoicePage invoiceId="00000000-0000-7000-8000-000000000001" />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

// PR #78 review: viewing reaches further than a branch-scoped write key, so edit and void are offered
// only at the member's own branches, as the API decides; sending needs the view only.
describe("the invoice page's actions", () => {
  it("offers edit and void on an invoice of the member's own branch", () => {
    show(OWN);
    expect(screen.getByRole("button", { name: "تعديل" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "إلغاء الفاتورة" })).toBeTruthy();
  });

  it("hides edit and void on another branch's invoice, and still offers the send", () => {
    show(OTHER);
    expect(screen.queryByRole("button", { name: "تعديل" })).toBeNull();
    expect(screen.queryByRole("button", { name: "إلغاء الفاتورة" })).toBeNull();
    expect(screen.getByRole("button", { name: "إرسال" })).toBeTruthy();
  });
});
