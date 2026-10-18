import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@eyadex/contracts/finance";
import { formatMinor } from "@eyadex/contracts/money";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicePage } from "./invoice-page";

const OWN = "00000000-0000-7000-8000-0000000000b1";
const OTHER = "00000000-0000-7000-8000-0000000000b2";
const state = vi.hoisted(() => ({ invoice: null as Invoice | null }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#invoices">{children}</a>,
}));
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => ({ finance: {} }) }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "clinic" }, ready: true }),
  useSession: () => ({
    isLoading: false,
    session: {
      permissions: ["view:invoices:clinic", "update:invoices:clinic", "create:discounts:branch"],
      allBranches: false,
      branchIds: [OWN],
    },
  }),
}));
vi.mock("./invoice-queries", () => ({
  useInvoice: () => ({ isLoading: false, data: state.invoice }),
  useRefreshInvoices: () => () => undefined,
}));
vi.mock("./invoice-options", () => ({
  useInvoiceOptions: () => ({ services: [], providers: [], branches: [], createBranches: [] }),
}));
vi.mock("@/shared/money/use-clinic-money", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/money/use-clinic-money")>()),
  useClinicMoney: () => ({
    exponent: 3,
    taxRateBp: 0,
    format: (minor: string) => `${formatMinor(minor, 3)} KWD`,
    toMajor: (minor: string) => formatMinor(minor, 3),
  }),
}));

function invoiceAt(branchId: string): Invoice {
  const discount = { kind: "pct", bp: 1000, reason: "Existing discount" } as const;
  return {
    id: branchId === OWN ? "invoice-own" : "invoice-other",
    number: "INV-2026-000001",
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
    discountMinor: "190",
    taxRateBp: 0,
    taxMinor: "0",
    totalMinor: "810",
    invoiceDiscount: discount,
    lines: [
      {
        position: 0,
        kind: "free",
        serviceId: null,
        providerId: null,
        descriptionAr: "خدمة",
        descriptionEn: "Service",
        quantity: 1,
        unitPriceMinor: "1000",
        discount,
        lineTotalMinor: "900",
      },
    ],
    voidReason: null,
    voidedAt: null,
    version: 1,
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("discount permissions in the real invoice edit dialog", () => {
  it.each([
    ["disabled outside the member's branch", OTHER, false],
    ["editable in the member's branch", OWN, true],
  ])(
    "keeps discounts %s after the displayed invoice changes",
    async (_label, branchId, editable) => {
      state.invoice = invoiceAt(branchId);
      const client = new QueryClient();
      const page = (invoiceId: string) => (
        <QueryClientProvider client={client}>
          <I18nProvider manageDocument={false}>
            <InvoicePage invoiceId={invoiceId} />
          </I18nProvider>
        </QueryClientProvider>
      );
      const view = render(page(state.invoice.id));
      fireEvent.click(screen.getByRole("button", { name: "تعديل" }));
      const dialog = within(await screen.findByRole("dialog"));
      const assertDiscounts = () => {
        for (const label of ["الخصم", "القيمة", "السبب"]) {
          const controls = dialog.getAllByLabelText(label);
          expect(controls).toHaveLength(2);
          for (const control of controls) {
            if (editable) expect(control).toBeEnabled();
            else expect(control).toBeDisabled();
          }
        }
      };
      assertDiscounts();

      // The route can change while the mounted dialog retains its original invoice and form values.
      state.invoice = invoiceAt(branchId === OWN ? OTHER : OWN);
      view.rerender(page(state.invoice.id));
      assertDiscounts();
    },
  );
});
