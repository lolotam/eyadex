import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PatientNotification } from "@eyadex/contracts/notifications";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { MessageHistoryList } from "./message-history-list";

vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({ session: { clinic: { timezone: "Asia/Kuwait" } } }),
}));
afterEach(() => {
  cleanup();
  localStorage.removeItem("eyadex:language");
});

const row = (over: Partial<PatientNotification>): PatientNotification => ({
  id: "00000000-0000-4000-8000-000000000301",
  kind: "booked",
  channel: "whatsapp",
  status: "sent",
  skipReason: null,
  route: "coexistence",
  createdAt: "2026-10-12T08:00:00.000Z",
  sentAt: "2026-10-12T08:00:01.000Z",
  failureReason: null,
  deliveredAt: null,
  readAt: null,
  ...over,
});

function show(lang: "ar" | "en", item: PatientNotification) {
  localStorage.setItem("eyadex:language", lang);
  render(
    <I18nProvider>
      <MessageHistoryList items={[item]} emptyText="" />
    </I18nProvider>,
  );
  return screen.queryByTestId("whatsapp-receipt");
}

describe.each([
  ["ar", ar],
  ["en", en],
] as const)("WhatsApp delivered/read (%s)", (lang, dict) => {
  it("sent only: a single check and the sent word", () => {
    const el = show(lang, row({}))!;
    expect(el.textContent).toContain(dict.messageHistory.status.sent);
    expect(el.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("check");
  });

  it("delivered: a double check, the delivered word and its time in the clinic timezone", () => {
    const el = show(lang, row({ deliveredAt: "2026-10-12T08:00:04.000Z" }))!;
    expect(el.textContent).toContain(dict.messageHistory.receipt.delivered);
    // 08:00 UTC is 11:00 in Kuwait.
    expect(el.textContent).toMatch(/11:00|١١:٠٠/);
    expect(el.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("check-check");
    expect(el.className).not.toContain("text-primary");
  });

  it("read: the furthest step wins, in the accent colour", () => {
    const el = show(
      lang,
      row({ deliveredAt: "2026-10-12T08:00:04.000Z", readAt: "2026-10-12T08:00:07.000Z" }),
    )!;
    expect(el.textContent).toContain(dict.messageHistory.receipt.read);
    expect(el.textContent).not.toContain(dict.messageHistory.receipt.delivered);
    expect(el.className).toContain("text-primary");
  });

  it("email rows are unchanged", () => {
    expect(show(lang, row({ channel: "email", route: "primary" }))).toBeNull();
  });

  it("the two-step failure label", () => {
    show(lang, row({ status: "failed", sentAt: null, failureReason: "whatsapp_two_step" }));
    expect(screen.getByText(dict.messageHistory.failure.whatsapp_two_step)).toBeInTheDocument();
  });
});
