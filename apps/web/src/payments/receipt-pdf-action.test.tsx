import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect } from "react";
import { ApiError } from "@/shared/api/api-error";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ReceiptPdfAction } from "./receipt-pdf-action";

const h = vi.hoisted(() => ({
  pdf: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  show: vi.fn(),
  persona: { kind: "custom", clinicId: "clinic", memberId: "one" },
}));
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => ({ payments: { pdf: h.pdf } }) }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: h.persona }),
}));
vi.mock("@/shared/pdf/pdf-tab", () => ({
  openPdfTab: h.open,
  closePdfTab: h.close,
  showPdf: h.show,
}));
const file = new Blob(["%PDF"], { type: "application/pdf" });
const tab = {} as Window;
const view = (id = "receipt-a") => (
  <I18nProvider manageDocument={false}>
    <ReceiptPdfAction paymentId={id} />
  </I18nProvider>
);
function deferred() {
  let resolve!: (file: Blob) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Blob>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.persona = { kind: "custom", clinicId: "clinic", memberId: "one" };
  h.open.mockReturnValue(tab);
  h.pdf.mockResolvedValue(file);
});
afterEach(cleanup);

describe("receipt PDF action", () => {
  it("opens the tab before requesting the receipt through the API", async () => {
    render(view());
    fireEvent.click(screen.getByRole("button", { name: "تنزيل الإيصال PDF" }));
    await waitFor(() => expect(h.show).toHaveBeenCalledWith(tab, file, "receipt-a.pdf"));
    expect(h.pdf).toHaveBeenCalledWith(h.persona, "receipt-a");
    expect(h.open.mock.invocationCallOrder[0]).toBeLessThan(h.pdf.mock.invocationCallOrder[0]!);
  });

  it("announces progress and prevents duplicate clicks", async () => {
    const task = deferred();
    h.pdf.mockReturnValue(task.promise);
    render(view());
    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("جارٍ تجهيز الإيصال…");
    expect(h.pdf).toHaveBeenCalledTimes(1);
    await act(async () => task.resolve(file));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("closes the blank tab on refusal and offers a successful retry", async () => {
    h.pdf.mockRejectedValueOnce(new ApiError("forbidden"));
    render(view());
    fireEvent.click(screen.getByRole("button"));
    const retry = await screen.findByRole("button", { name: "إعادة محاولة تنزيل الإيصال" });
    expect(h.close).toHaveBeenCalledWith(tab);
    expect(screen.getByRole("alert").textContent).toBeTruthy();
    fireEvent.click(retry);
    await waitFor(() => expect(h.show).toHaveBeenCalledTimes(1));
    expect(h.pdf).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the fallback download when the browser blocks the popup", async () => {
    h.open.mockReturnValue(null);
    render(view());
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(h.show).toHaveBeenCalledWith(null, file, "receipt-a.pdf"));
  });

  it("closes on unmount and ignores a late successful response", async () => {
    const task = deferred();
    h.pdf.mockReturnValue(task.promise);
    const page = render(view());
    fireEvent.click(screen.getByRole("button"));
    page.unmount();
    expect(h.close).toHaveBeenCalledWith(tab);
    await act(async () => task.resolve(file));
    expect(h.show).not.toHaveBeenCalled();
  });

  it("closes the pending tab during commit, before parent layout effects run", async () => {
    const task = deferred();
    h.pdf.mockReturnValue(task.promise);
    let closedDuringCommit = false;
    function CommitProbe({ visible }: { visible: boolean }) {
      useLayoutEffect(() => {
        if (!visible) closedDuringCommit = h.close.mock.calls.some(([value]) => value === tab);
      }, [visible]);
      return visible ? <ReceiptPdfAction paymentId="receipt-a" /> : null;
    }
    const page = render(
      <I18nProvider manageDocument={false}>
        <CommitProbe visible />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    page.rerender(
      <I18nProvider manageDocument={false}>
        <CommitProbe visible={false} />
      </I18nProvider>,
    );
    expect(closedDuringCommit).toBe(true);
    await act(async () => task.resolve(file));
    expect(h.show).not.toHaveBeenCalled();
  });

  it("cancels the old receipt attempt without clearing a newer request", async () => {
    const old = deferred(),
      current = deferred();
    h.pdf.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const page = render(view());
    fireEvent.click(screen.getByRole("button"));
    page.rerender(view("receipt-b"));
    expect(h.close).toHaveBeenCalledWith(tab);
    fireEvent.click(screen.getByRole("button"));
    await act(async () => old.resolve(file));
    expect(h.show).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
    await act(async () => current.resolve(file));
    expect(h.show).toHaveBeenCalledWith(tab, file, "receipt-b.pdf");
  });

  it("clears a previous receipt's error when the route changes", async () => {
    h.pdf.mockRejectedValueOnce(new ApiError("pdf_render_failed"));
    const page = render(view());
    fireEvent.click(screen.getByRole("button"));
    await screen.findByRole("alert");
    page.rerender(view("receipt-b"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "تنزيل الإيصال PDF" })).toBeTruthy();
  });

  it("ignores a previous caller's response after the persona changes", async () => {
    const task = deferred();
    h.pdf.mockReturnValue(task.promise);
    const page = render(view());
    fireEvent.click(screen.getByRole("button"));
    h.persona = { ...h.persona, memberId: "two" };
    page.rerender(view());
    await act(async () => task.resolve(file));
    expect(h.show).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveProperty("disabled", false);
  });
});
