import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { financeError } from "@/shared/api/api-error";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { CloseDialog } from "./close-dialog";

const h = vi.hoisted(() => ({ preview: vi.fn(), close: vi.fn() }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
  useSession: () => ({ session: { clinic: { timezone: "Asia/Kuwait" } } }),
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({ cashClosings: { preview: h.preview, close: h.close } }),
}));

const BRANCH = "00000000-0000-7000-8000-00000000000b";
const previewAt = (throughCashSeq: string, expectedMinor: string) => ({
  branchId: BRANCH,
  businessDate: "2026-03-10",
  previousClosingId: null,
  fromCashSeq: "0",
  throughCashSeq,
  cashInMinor: expectedMinor,
  cashOutMinor: "0",
  expectedMinor,
  methodTotals: [],
  movements: [],
  currency: "KWD",
  currencyExponent: 3,
});

const dialog = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <CloseDialog
          open
          onOpenChange={() => undefined}
          branches={[{ id: BRANCH, nameAr: "الفرع", nameEn: "Branch", isActive: true }]}
          onShowClosed={() => undefined}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
const counted = () => screen.getByLabelText(ar.cashClosings.dialog.counted) as HTMLInputElement;
const note = () => screen.getByLabelText(ar.cashClosings.note) as HTMLTextAreaElement;
const submit = () => screen.getByRole("button", { name: ar.cashClosings.dialog.submit });

beforeEach(() => {
  h.preview.mockReset();
  h.close.mockReset();
});
afterEach(cleanup);

describe("the close dialog", () => {
  it("needs a note when the count differs, and not when it matches", async () => {
    h.preview.mockResolvedValue(previewAt("1", "5000"));
    dialog();
    await waitFor(() => counted());
    fireEvent.change(counted(), { target: { value: "4.5" } });
    expect(screen.getByText(ar.cashClosings.diff.shortage)).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    fireEvent.change(counted(), { target: { value: "5" } });
    expect(screen.getByText(ar.cashClosings.diff.balanced)).toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });

  it("cash_drawer_changed refetches the preview and keeps the count and the note", async () => {
    h.preview.mockResolvedValueOnce(previewAt("1", "5000")).mockResolvedValue(previewAt("2", "6000"));
    h.close.mockRejectedValueOnce(financeError("cash_drawer_changed"));
    dialog();
    await waitFor(() => counted());
    fireEvent.change(counted(), { target: { value: "4" } });
    fireEvent.change(note(), { target: { value: "نقص" } });
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByText(ar.cashClosings.dialog.changed)).toBeInTheDocument());
    await waitFor(() => expect(h.preview).toHaveBeenCalledTimes(2));
    expect(counted().value).toBe("4");
    expect(note().value).toBe("نقص");
    // The next close repeats the new preview's position, under a new key.
    await waitFor(() => expect(screen.getByText("6.000 KWD")).toBeInTheDocument());
    h.close.mockResolvedValue({ branchId: BRANCH, businessDate: "2026-03-10" });
    fireEvent.click(submit());
    await waitFor(() => expect(h.close).toHaveBeenCalledTimes(2));
    expect(h.close.mock.calls[1]![1]).toMatchObject({ throughCashSeq: "2", countedMinor: "4000" });
    expect(h.close.mock.calls[1]![2]).not.toBe(h.close.mock.calls[0]![2]);
  });
});
