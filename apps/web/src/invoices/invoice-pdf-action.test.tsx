import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { I18nProvider, useI18n } from "@/shared/i18n/i18n-provider";
import { InvoicePdfAction, type InvoicePdfFailure } from "./invoice-pdf-action";

// The ApiClient is the network boundary; keep the download/tab helpers real.
const api = vi.hoisted(() => ({ pdf: vi.fn<() => Promise<Blob>>() }));
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => ({ finance: api }) }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "synthetic", memberId: null } }),
}));

const messages = {
  ar: {
    pdf: "PDF / طباعة",
    pending: "جارٍ تجهيز ملف PDF…",
    retry: "إعادة محاولة فتح PDF",
    pdf_busy: "إنشاء PDF مشغول حاليًا؛ حاول بعد لحظات.",
    pdf_render_failed: "تعذّر إنشاء ملف PDF؛ حاول مرة تانية.",
  },
  en: {
    pdf: "PDF / Print",
    pending: "Preparing PDF…",
    retry: "Retry opening PDF",
    pdf_busy: "PDF generation is busy; try again shortly.",
    pdf_render_failed: "The PDF could not be generated; try again.",
  },
};
const blob = new Blob(["%PDF-synthetic"], { type: "application/pdf" });

function Feedback() {
  const [error, setError] = useState<InvoicePdfFailure | null>(null);
  const { tDynamic, setLang } = useI18n();
  return (
    <>
      <InvoicePdfAction invoiceId="synthetic-invoice" onErrorChange={setError} />
      {error && <p role="alert">{tDynamic(`errors.${error}`)}</p>}
      <button onClick={() => setLang("en")}>English</button>
    </>
  );
}
function show(lang: "ar" | "en" = "ar") {
  localStorage.setItem("eyadex:language", lang);
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <I18nProvider manageDocument={false}>
        <Feedback />
      </I18nProvider>
    </QueryClientProvider>,
  );
}
function pendingDownload() {
  let resolve!: (value: Blob) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Blob>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function tab() {
  const value = { closed: false, opener: {}, location: { href: "" }, close: vi.fn() };
  value.close.mockImplementation(() => {
    value.closed = true;
  });
  return value;
}

beforeEach(() => {
  api.pdf.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-pdf");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("invoice PDF feedback", () => {
  it.each(["ar", "en"] as const)(
    "shows accessible progress and suppresses repeat presses in %s",
    async (lang) => {
      const request = pendingDownload();
      api.pdf.mockReturnValue(request.promise);
      const windowTab = tab();
      const open = vi.spyOn(window, "open").mockReturnValue(windowTab as unknown as Window);
      show(lang);
      const button = await screen.findByRole("button", { name: messages[lang].pdf });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(await screen.findByRole("status")).toHaveTextContent(messages[lang].pending);
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");
      expect(button).toHaveAttribute("aria-describedby", screen.getByRole("status").id);
      expect(open).toHaveBeenCalledTimes(1);
      expect(api.pdf).toHaveBeenCalledTimes(1);
      await act(async () => request.resolve(blob));
      await waitFor(() => expect(windowTab.location.href).toBe("blob:synthetic-pdf"));
      expect(screen.getByRole("status")).toHaveTextContent("");
      expect(button).toBeEnabled();
    },
  );

  it.each(["pdf_busy", "pdf_render_failed"] as const)(
    "shows %s, closes only its failed tab and succeeds on retry",
    async (code) => {
      const first = pendingDownload();
      const second = pendingDownload();
      api.pdf.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const firstTab = tab(),
        secondTab = tab();
      vi.spyOn(window, "open")
        .mockReturnValueOnce(firstTab as unknown as Window)
        .mockReturnValueOnce(secondTab as unknown as Window);
      show();
      fireEvent.click(screen.getByRole("button", { name: messages.ar.pdf }));
      await act(async () => first.reject(new ApiError(code)));
      expect(await screen.findByRole("alert")).toHaveTextContent(messages.ar[code]);
      expect(firstTab.close).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "English" }));
      expect(screen.getByRole("alert")).toHaveTextContent(messages.en[code]);
      fireEvent.click(screen.getByRole("button", { name: messages.en.retry }));
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      expect(secondTab.close).not.toHaveBeenCalled();
      await act(async () => second.resolve(blob));
      await waitFor(() => expect(secondTab.location.href).toBe("blob:synthetic-pdf"));
      expect(firstTab.location.href).toBe("");
      expect(secondTab.close).not.toHaveBeenCalled();
    },
  );

  it("closes the pending tab on unmount and discards a later response", async () => {
    const request = pendingDownload();
    api.pdf.mockReturnValue(request.promise);
    const windowTab = tab();
    vi.spyOn(window, "open").mockReturnValue(windowTab as unknown as Window);
    const view = show();
    fireEvent.click(screen.getByRole("button", { name: messages.ar.pdf }));
    await waitFor(() => expect(api.pdf).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(windowTab.close).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve(blob));
    expect(windowTab.location.href).toBe("");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
