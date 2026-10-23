import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { CloseDialog } from "./close-dialog";
import { ClosingPreviewSummary } from "./closing-preview-summary";

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
// A native select stands in for the Radix picker, which jsdom cannot open.
vi.mock("@/shared/table/filter-select", () => ({
  FilterSelect: (p: {
    label: string;
    value: string | null;
    options: { value: string; label: string }[];
    onChange: (v: string | null) => void;
  }) => (
    <select aria-label={p.label} value={p.value ?? ""} onChange={(e) => p.onChange(e.target.value)}>
      <option value="" />
      {p.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const A = "00000000-0000-7000-8000-00000000000a";
const B = "00000000-0000-7000-8000-00000000000b";
const previewOf = (branchId: string, extra: Record<string, unknown> = {}) => ({
  branchId,
  businessDate: "2026-03-10",
  previousClosingId: null,
  fromCashSeq: "0",
  throughCashSeq: "1",
  cashInMinor: "5000",
  cashOutMinor: "0",
  expectedMinor: "5000",
  methodTotals: [],
  movements: [],
  currency: "KWD",
  currencyExponent: 3,
  ...extra,
});

afterEach(cleanup);

describe("the close dialog's branch change", () => {
  it("clears the count and the note typed for the previous branch; the button stays disabled", async () => {
    h.preview.mockImplementation(async (_p: unknown, id: string) => previewOf(id));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider>
          <CloseDialog
            open
            onOpenChange={() => undefined}
            branches={[
              { id: A, nameAr: "أ", nameEn: "A", isActive: true },
              { id: B, nameAr: "ب", nameEn: "B", isActive: true },
            ]}
            onShowClosed={() => undefined}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );
    const picker = screen.getByLabelText(ar.cashClosings.dialog.pickBranch);
    fireEvent.change(picker, { target: { value: A } });
    const counted = () => screen.getByLabelText(ar.cashClosings.dialog.counted) as HTMLInputElement;
    const note = () => screen.getByLabelText(ar.cashClosings.note) as HTMLTextAreaElement;
    const submit = () => screen.getByRole("button", { name: ar.cashClosings.dialog.submit });
    await waitFor(() => counted());
    fireEvent.change(counted(), { target: { value: "4" } });
    fireEvent.change(note(), { target: { value: "نقص" } });
    expect(submit()).toBeEnabled();
    fireEvent.change(picker, { target: { value: B } });
    await waitFor(() => counted());
    expect(counted().value).toBe("");
    expect(note().value).toBe("");
    expect(submit()).toBeDisabled();
  });
});

describe("the preview summary", () => {
  it("says no cash moved since the last closing instead of an inverted range", () => {
    const pv = previewOf(A, { previousClosingId: B, fromCashSeq: "5", throughCashSeq: "5" });
    render(
      <I18nProvider>
        <ClosingPreviewSummary preview={pv as never} />
      </I18nProvider>,
    );
    expect(screen.getByText(ar.cashClosings.dialog.noMovementSince)).toBeInTheDocument();
    expect(screen.queryByText(/6.*5/)).toBeNull();
  });
});
