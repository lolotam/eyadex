import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ReceiptDetails } from "./receipt-details";

const h = vi.hoisted(() => ({ refetch: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({ session: { permissions: [], allBranches: false, branchIds: [] } }),
}));
vi.mock("./receipt-queries", async (real) => ({
  ...(await real<typeof import("./receipt-queries")>()),
  useReceiptBranches: () => ({ isError: true, refetch: h.refetch }),
  useReceipt: () => ({
    data: {
      id: "00000000-0000-7000-8000-0000000000f1",
      receiptNumber: "TT-R-2026-000001",
      branchId: "00000000-0000-7000-8000-0000000000a0",
      invoiceId: "00000000-0000-7000-8000-0000000000c1",
      invoiceNumber: "TT-2026-000001",
      patientId: "00000000-0000-7000-8000-0000000000d1",
      patientName: "مراجع تجريبي",
      method: "cash",
      amountMinor: "1500",
      currency: "KWD",
      currencyExponent: 3,
      reference: null,
      receivedAt: "2026-10-15T09:00:00.000Z",
      businessDate: "2026-10-15",
      cashSeq: 1,
      receivedBy: "00000000-0000-7000-8000-0000000000e1",
    },
  }),
}));

afterEach(cleanup);

describe("the receipt page", () => {
  it("shows a branch-options failure with a working retry, not «—»", () => {
    render(
      <I18nProvider manageDocument={false}>
        <ReceiptDetails paymentId="x" />
      </I18nProvider>,
    );
    expect(screen.getByText("تعذر تحميل الفروع")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "حاول مرة أخرى" }));
    expect(h.refetch).toHaveBeenCalled();
  });
});
