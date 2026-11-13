import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ClosingsContent } from "./closings-content";

const h = vi.hoisted(() => ({ list: vi.fn(), branchOptions: vi.fn() }));
const BRANCH = "00000000-0000-7000-8000-00000000000b";
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
  useSession: () => ({
    session: {
      clinic: { timezone: "Asia/Kuwait" },
      permissions: [
        "view:payments:clinic",
        "view:cash_closings:clinic",
        "create:cash_closings:clinic",
      ],
      branchIds: [],
    },
  }),
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    cashClosings: { list: h.list },
    payments: { branchOptions: h.branchOptions },
  }),
}));
vi.mock("./close-dialog", () => ({
  CloseDialog: (p: { onOpenChange: (o: boolean) => void }) => (
    <button onClick={() => p.onOpenChange(false)}>dismiss</button>
  ),
}));
vi.mock("./closing-count", async (orig) => ({
  ...(await orig<object>()),
  closableBranches: (_s: unknown, b: unknown[]) => b,
}));

afterEach(cleanup);

describe("close dialog focus", () => {
  it("hands keyboard focus back to «إقفال الصندوق» when the dialog closes", async () => {
    h.branchOptions.mockResolvedValue({
      items: [{ id: BRANCH, nameAr: "ف", nameEn: "B", isActive: true }],
      nextCursor: null,
    });
    h.list.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider>
          <ClosingsContent />
        </I18nProvider>
      </QueryClientProvider>,
    );
    const trigger = await screen.findByRole("button", { name: ar.cashClosings.close });
    fireEvent.click(trigger);
    const dismiss = screen.getByText("dismiss");
    dismiss.focus();
    fireEvent.click(dismiss);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: ar.cashClosings.close }),
      ),
    );
  });
});
