import { cleanup, render, screen } from "@testing-library/react";
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
  id: `00000000-0000-4000-8000-00000000000${i}`,
  kind: "booked",
  channel: "email",
  status: "sent",
  skipReason: null,
  route: "primary",
  createdAt: "2026-10-12T08:00:00.000Z",
  sentAt: null,
  failureReason: null,
  ...over,
});

describe("message history list", () => {
  it("renders every status and every skip reason in words", () => {
    const reasons = ["setting_off", "no_email", "opted_out", "not_booked", "moved"] as const;
    const items = [
      row({ status: "queued", route: null }, 0),
      row({ status: "sent", route: "fallback" }, 1),
      row({ status: "failed", route: null }, 2),
      ...reasons.map((r, i) => row({ status: "skipped", skipReason: r, route: null }, i + 3)),
    ];
    render(
      <I18nProvider>
        <MessageHistoryList items={items} emptyText={ar.messageHistory.empty} />
      </I18nProvider>,
    );
    for (const s of ["queued", "sent", "failed"] as const)
      expect(screen.getByText(ar.messageHistory.status[s])).toBeInTheDocument();
    expect(screen.getAllByText(ar.messageHistory.status.skipped)).toHaveLength(5);
    for (const r of reasons)
      expect(screen.getByText(new RegExp(ar.messageHistory.skip[r]))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(ar.messageHistory.route.fallback))).toBeInTheDocument();
  });

  it("shows the empty state", () => {
    render(
      <I18nProvider>
        <MessageHistoryList items={[]} emptyText={ar.messageHistory.empty} />
      </I18nProvider>,
    );
    expect(screen.getByText(ar.messageHistory.empty)).toBeInTheDocument();
  });
});
