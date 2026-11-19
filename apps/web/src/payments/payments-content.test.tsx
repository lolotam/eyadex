import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PaymentsContent } from "./payments-content";

vi.mock("@/shared/shell/finance-tabs", () => ({ FinanceTabs: () => <nav>finance</nav> }));
vi.mock("./receipts-content", () => ({ ReceiptsContent: () => <div>receipts</div> }));
vi.mock("./refunds-content", () => ({ RefundsContent: () => <div>refunds</div> }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("payments list printing", () => {
  it("prints the active list from a named action", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const view = render(
      <I18nProvider manageDocument={false}>
        <PaymentsContent />
      </I18nProvider>,
    );
    expect(view.container.firstElementChild?.hasAttribute("data-payments-print")).toBe(true);
    const action = screen.getByRole("button", { name: "طباعة القائمة" });
    expect(action.className).toContain("print:hidden");
    fireEvent.click(action);
    expect(print).toHaveBeenCalledOnce();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "الاستردادات" }), { button: 0 });
    expect(screen.getByText("refunds")).toBeTruthy();
    expect(screen.queryByText("receipts")).toBeNull();
  });
});
