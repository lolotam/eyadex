import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  notificationFailureReasonSchema,
  type PatientNotification,
} from "@eyadex/contracts/notifications";
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

const reasons = notificationFailureReasonSchema.options;
const items: PatientNotification[] = reasons.map((failureReason, i) => ({
  id: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`,
  kind: "booked",
  channel: "whatsapp",
  status: "failed",
  skipReason: null,
  route: "coexistence",
  createdAt: "2026-10-12T08:00:00.000Z",
  sentAt: null,
  failureReason,
  deliveredAt: null,
  readAt: null,
}));

describe.each([
  ["ar", ar],
  ["en", en],
] as const)("failure reasons (%s)", (lang, dict) => {
  it("shows every failure reason in words", () => {
    localStorage.setItem("eyadex:language", lang);
    render(
      <I18nProvider>
        <MessageHistoryList items={items} emptyText="" />
      </I18nProvider>,
    );
    for (const r of reasons)
      expect(screen.getByText(dict.messageHistory.failure[r])).toBeInTheDocument();
  });
});
