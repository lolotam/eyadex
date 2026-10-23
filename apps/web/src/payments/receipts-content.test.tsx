import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Payment } from "@eyadex/contracts/finance";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ReceiptsContent } from "./receipts-content";

const BRANCH_A = "00000000-0000-7000-8000-0000000000a0";
const BRANCH_B = "00000000-0000-7000-8000-0000000000b0";

const h = vi.hoisted(() => ({
  session: { permissions: [] as string[], allBranches: false, branchIds: [] as string[] },
  list: {} as Record<string, unknown>,
  refetch: vi.fn(),
  branches: {} as Record<string, unknown>,
  queries: [] as Record<string, unknown>[],
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({ session: h.session }),
}));
vi.mock("./receipt-patient-picker", () => ({
  ReceiptPatientPicker: ({
    onChange,
  }: {
    onChange: (p: { id: string; label: string }) => void;
  }) => (
    <button type="button" onClick={() => onChange({ id: "p1", label: "x" })}>
      patient-filter
    </button>
  ),
}));
vi.mock("./receipt-queries", async (real) => ({
  ...(await real<typeof import("./receipt-queries")>()),
  useReceiptBranches: () => h.branches,
  useReceiptList: (q: Record<string, unknown>) => {
    h.queries.push(q);
    return h.list;
  },
}));

const base: Omit<Payment, "id" | "receiptNumber" | "branchId" | "invoiceNumber"> = {
  invoiceId: "00000000-0000-7000-8000-0000000000c1",
  patientId: "00000000-0000-7000-8000-0000000000d1",
  patientName: "مراجع تجريبي",
  method: "knet",
  amountMinor: "1500",
  currency: "KWD",
  currencyExponent: 3,
  reference: null,
  receivedAt: "2026-10-15T09:00:00.000Z",
  businessDate: "2026-10-15",
  cashSeq: null,
  receivedBy: "00000000-0000-7000-8000-0000000000e1",
};
const rows: Payment[] = [
  {
    ...base,
    id: "00000000-0000-7000-8000-0000000000f1",
    receiptNumber: "TT-R-2026-000001",
    branchId: BRANCH_A,
    invoiceNumber: "TT-2026-000001",
  },
  {
    ...base,
    id: "00000000-0000-7000-8000-0000000000f2",
    receiptNumber: "TT-R-2026-000002",
    branchId: BRANCH_B,
    invoiceNumber: "TT-2026-000002",
  },
];

const show = () =>
  render(
    <I18nProvider manageDocument={false}>
      <ReceiptsContent />
    </I18nProvider>,
  );

beforeEach(() => {
  h.session = { permissions: ["view:payments:clinic"], allBranches: false, branchIds: [BRANCH_A] };
  h.list = { data: { items: rows, total: 2, nextCursor: null }, isLoading: false };
  h.branches = { data: [{ id: BRANCH_A, nameAr: "فرع أ", nameEn: "Branch A", isActive: true }] };
  h.queries = [];
  h.refetch.mockReset();
});
afterEach(cleanup);

describe("the receipts list (card 1b)", () => {
  it("names each row's branch from the payments branch list, «—» when missing", () => {
    show();
    expect(within(screen.getByRole("row", { name: /000001/ })).getByText("فرع أ")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /R-2026-000002/ })).getByText("—")).toBeTruthy();
  });

  it("links the invoice number only where the caller views invoices at that branch", () => {
    h.session.permissions = ["view:payments:clinic", "view:invoices:branch"];
    show();
    const linked = screen.getAllByRole("link").map((a) => a.textContent);
    expect(linked).toContain("TT-2026-000001");
    expect(linked).not.toContain("TT-2026-000002");
  });

  it("shows the patient filter only with view:patients", () => {
    show();
    expect(screen.queryByText("patient-filter")).toBeNull();
    cleanup();
    h.session.permissions = ["view:payments:clinic", "view:patients:own"];
    show();
    expect(screen.getByText("patient-filter")).toBeTruthy();
  });

  it("shows an empty state, and an error with a working retry", () => {
    h.list = { data: { items: [], total: 0, nextCursor: null }, isLoading: false };
    show();
    expect(screen.getByText("لا توجد إيصالات")).toBeTruthy();
    cleanup();
    h.list = { isError: true, error: new Error("x"), isLoading: false, refetch: h.refetch };
    show();
    expect(screen.getByText("تعذر تحميل الإيصالات")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "حاول مرة أخرى" }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it("drops a picked patient and its filter when view:patients is lost", () => {
    h.session.permissions = ["view:payments:clinic", "view:patients:clinic"];
    const view = show();
    fireEvent.click(screen.getByText("patient-filter"));
    expect(h.queries.at(-1)?.["patientId"]).toBe("p1");
    h.session = { ...h.session, permissions: ["view:payments:clinic"] };
    view.rerender(
      <I18nProvider manageDocument={false}>
        <ReceiptsContent />
      </I18nProvider>,
    );
    expect(h.queries.at(-1)?.["patientId"]).toBeUndefined();
    h.session = { ...h.session, permissions: ["view:payments:clinic", "view:patients:clinic"] };
    view.rerender(
      <I18nProvider manageDocument={false}>
        <ReceiptsContent />
      </I18nProvider>,
    );
    expect(h.queries.at(-1)?.["patientId"]).toBeUndefined();
  });

  it("shows a branch-options failure with a working retry", () => {
    h.branches = { isError: true, refetch: h.refetch };
    show();
    expect(screen.getByText("تعذر تحميل الفروع")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "حاول مرة أخرى" }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it("disables both pager buttons while placeholder data shows", () => {
    h.list = {
      data: { items: rows, total: 40, nextCursor: "abc" },
      isLoading: false,
      isPlaceholderData: true,
    };
    show();
    expect(screen.getByRole("button", { name: "التالي" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "السابق" }).hasAttribute("disabled")).toBe(true);
  });
});
