import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PatientNotification } from "@eyadex/contracts/notifications";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { MessageHistoryList } from "./message-history-list";

vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({ session: { clinic: { timezone: "Asia/Kuwait" } } }),
}));
afterEach(() => cleanup());

const row = (over: Partial<PatientNotification>, i: number): PatientNotification => ({
  id: `00000000-0000-4000-8000-00000000001${i}`,
  kind: "booked",
  channel: "whatsapp",
  status: "sent",
  skipReason: null,
  route: null,
  createdAt: "2026-10-12T08:00:00.000Z",
  sentAt: null,
  ...over,
});

describe("message history WhatsApp labels", () => {
  it("shows the channel, the two WhatsApp routes and the two WhatsApp skip reasons", () => {
    render(
      <I18nProvider>
        <MessageHistoryList
          emptyText=""
          items={[
            row({ route: "evolution" }, 0),
            row({ route: "coexistence" }, 1),
            row({ status: "skipped", skipReason: "template_missing" }, 2),
            row({ status: "skipped", skipReason: "whatsapp_disconnected" }, 3),
            row({ channel: "email", route: "primary" }, 4),
          ]}
        />
      </I18nProvider>,
    );
    const text = document.body.textContent ?? "";
    for (const label of [
      ar.messageHistory.route.evolution,
      ar.messageHistory.route.coexistence,
      ar.messageHistory.skip.template_missing,
      ar.messageHistory.skip.whatsapp_disconnected,
      ar.messageHistory.channel.whatsapp,
      ar.messageHistory.channel.email,
    ])
      expect(text).toContain(label);
  });
});
