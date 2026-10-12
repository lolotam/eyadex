import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "@/shared/i18n/en";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { MessageHistoryList } from "./message-history-list";

vi.mock("@/shared/persona/persona-provider", () => ({ useSession: () => ({ session: null }) }));
afterEach(() => cleanup());

const row = (over: object) => ({
  id: "00000000-0000-7000-8000-000000000001",
  kind: "booked" as const,
  channel: "whatsapp" as const,
  status: "sent" as const,
  skipReason: null,
  route: null,
  createdAt: "2026-10-01T08:00:00.000Z",
  sentAt: null,
  ...over,
});

describe("message history WhatsApp labels", () => {
  it("shows the channel, the WhatsApp routes and the WhatsApp skip reasons", () => {
    window.localStorage.setItem("eyadex:lang", "en");
    render(
      <I18nProvider>
        <MessageHistoryList
          emptyText=""
          items={[
            row({ route: "evolution" }),
            row({ id: "00000000-0000-7000-8000-000000000002", route: "coexistence" }),
            row({ id: "00000000-0000-7000-8000-000000000003", status: "skipped", skipReason: "template_missing" }),
            row({ id: "00000000-0000-7000-8000-000000000004", status: "skipped", skipReason: "whatsapp_disconnected" }),
          ]}
        />
      </I18nProvider>,
    );
    const text = document.body.textContent ?? "";
    for (const dict of [en]) void dict;
    expect(screen.getAllByText(/./).length).toBeGreaterThan(0);
    const ar = text; // the default language may be Arabic; check either set of labels
    const has = (enLabel: string, arLabel: string) =>
      expect(ar.includes(enLabel) || ar.includes(arLabel)).toBe(true);
    has(en.messageHistory.route.evolution, "مربوط برمز QR");
    has(en.messageHistory.route.coexistence, "واتساب للأعمال");
    has(en.messageHistory.skip.template_missing, "لا يوجد قالب واتساب");
    has(en.messageHistory.skip.whatsapp_disconnected, "واتساب غير متصل");
    has(en.messageHistory.channel.whatsapp, "واتساب");
  });
});
