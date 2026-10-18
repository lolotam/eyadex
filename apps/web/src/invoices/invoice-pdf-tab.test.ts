import { afterEach, describe, expect, it, vi } from "vitest";
import { closePdfTab, openPdfTab, showPdf } from "./invoice-pdf-tab";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const blob = new Blob(["%PDF"], { type: "application/pdf" });

describe("the invoice PDF tab", () => {
  it("opens synchronously and is then pointed at the file, which is revoked", () => {
    vi.useFakeTimers();
    const tab = { closed: false, opener: {}, location: { href: "" } } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(tab);
    URL.createObjectURL = vi.fn(() => "blob:one");
    URL.revokeObjectURL = vi.fn();
    const opened = openPdfTab();
    expect(window.open).toHaveBeenCalledTimes(1);
    showPdf(opened, blob, "x.pdf");
    expect(tab.location.href).toBe("blob:one");
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one");
  });

  it("a blocked popup falls back to a download link", () => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => "blob:two");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    showPdf(null, blob, "x.pdf");
    expect(click).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:two");
  });

  it("a failed download closes the empty tab", () => {
    const close = vi.fn();
    closePdfTab({ closed: false, close } as unknown as Window);
    expect(close).toHaveBeenCalled();
  });
});
