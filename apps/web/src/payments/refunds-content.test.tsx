import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Refund } from "@eyadex/contracts/finance";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { RefundsContent } from "./refunds-content";

const BRANCH_A = "00000000-0000-7000-8000-0000000000a0";

const h = vi.hoisted(() => ({
  session: { permissions: [] as string[], allBranches: false, branchIds: [] as string[] },
  list: {} as Record<string, unknown>,
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
  useRefundList: (q: Record<string, unknown>) => {
    h.queries.push(q);
    return h.list;
  },
}));

const row: Refund = {
  id: "00000000-0000-7000-8000-0000000000f1",
  refundNumber: "TT-RF-2026-000001",
  branchId: BRANCH_A,
  invoiceId: "00000000-0000-7000-8000-0000000000c1",
  invoiceNumber: "TT-2026-000001",
  patientId: "00000000-0000-7000-8000-0000000000d1",
  patientName: "مراجع تجريبي",
  method: "cash",
  amountMinor: "500",
  currency: "KWD",
  currencyExponent: 3,
  reason: "خطأ في التحصيل",
  refundedAt: "2026-10-15T09:00:00.000Z",
  businessDate: "2026-10-15",
  cashSeq: "3",
  refundedBy: "00000000-0000-7000-8000-0000000000e1",
};

const show = () =>
  render(
    <I18nProvider manageDocument={false}>
      <RefundsContent />
    </I18nProvider>,
  );

beforeEach(() => {
  h.session = { permissions: ["view:payments:clinic"], allBranches: true, branchIds: [] };
  h.list = { data: { items: [row], total: 1, nextCursor: null }, isLoading: false };
  h.branches = { data: [{ id: BRANCH_A, nameAr: "فرع أ", nameEn: "Branch A", isActive: true }] };
  h.queries = [];
});
afterEach(cleanup);

describe("the refunds list (card 2a §3)", () => {
  it("shows number, patient name as plain text, branch, amount and reason", () => {
    show();
    const r = screen.getByRole("row", { name: /RF-2026-000001/ });
    expect(within(r).getByText("مراجع تجريبي").closest("a")).toBeNull();
    expect(within(r).getByText("فرع أ")).toBeTruthy();
    expect(within(r).getByText("0.500 KWD")).toBeTruthy();
    expect(within(r).getByText("خطأ في التحصيل")).toBeTruthy();
  });

  it("offers the patient filter only with view:patients and never sends a number search", () => {
    show();
    expect(screen.queryByText("patient-filter")).toBeNull();
    expect(h.queries.at(-1)).not.toHaveProperty("receiptNumber");
    cleanup();
    h.session.permissions = ["view:payments:clinic", "view:patients:clinic"];
    show();
    fireEvent.click(screen.getByText("patient-filter"));
    expect(h.queries.at(-1)?.["patientId"]).toBe("p1");
  });

  it("disables both pager buttons while placeholder data shows", () => {
    h.list = {
      data: { items: [row], total: 40, nextCursor: "abc" },
      isLoading: false,
      isPlaceholderData: true,
    };
    show();
    expect(screen.getByRole("button", { name: "التالي" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "السابق" }).hasAttribute("disabled")).toBe(true);
  });
});
