import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { errorFromResponse } from "@/shared/api/http/http-errors";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { InvoicePdfAction, type InvoicePdfFailure } from "./invoice-pdf-action";

const api = vi.hoisted(() => ({ pdf: vi.fn<() => Promise<Blob>>() }));
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => ({ finance: api }) }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "synthetic", memberId: null } }),
}));

const envelope = { code: "unknown", message_ar: "حدث خطأ ما", message_en: "Something went wrong" };
let seen: InvoicePdfFailure | null = null;

function Probe() {
  const [failure, setFailure] = useState<InvoicePdfFailure | null>(null);
  seen = failure;
  return <InvoicePdfAction invoiceId="synthetic-invoice" onErrorChange={setFailure} />;
}
function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <I18nProvider manageDocument={false}>
        <Probe />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  seen = null;
  vi.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the invoice PDF button tells 'not available' apart from a failure", () => {
  it("the HTTP adapter keeps the response status on the error", () => {
    expect(errorFromResponse(503, envelope).httpStatus).toBe(503);
    expect(errorFromResponse(500, envelope).httpStatus).toBe(500);
  });

  it("a 503 'unknown' answer is reported as unavailable", async () => {
    api.pdf.mockRejectedValue(errorFromResponse(503, envelope));
    show();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(seen).toBe("unavailable"));
  });

  it("a 500 'unknown' answer stays a real failure", async () => {
    api.pdf.mockRejectedValue(errorFromResponse(500, envelope));
    show();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(seen).toBe("unknown"));
  });

  it("a render failure keeps its own code", async () => {
    api.pdf.mockRejectedValue(new ApiError("pdf_render_failed"));
    show();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(seen).toBe("pdf_render_failed"));
  });

  it("the status region is there before the click, so 'Preparing' is announced", () => {
    show();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("the button is at least 44px tall on phones", () => {
    show();
    expect(screen.getByRole("button").className).toContain("max-sm:min-h-11");
  });
});
