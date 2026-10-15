import { randomBytes, randomUUID } from "node:crypto";

import { DEFAULT_NOTIFICATION_SETTINGS } from "@eyadex/contracts/notifications";
import type { ClaimedEvent } from "@eyadex/db";
import { SecretSealer } from "@eyadex/secrets";
import { describe, expect, it } from "vitest";

import { captureLogs, FakeMail } from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import type { LockedClinicProvider } from "../../invitation-mail/ports/invitation-state-reader.ts";
import type { MailMessage } from "../../invitation-mail/ports/mail-sender.ts";
import type { LedgerOutcome, LockedNotification } from "../ports/notification-store.ts";
import { notificationDispatcher } from "../send-notification.ts";

function harness() {
  const sealer = new SecretSealer(randomBytes(32).toString("base64"));
  const primary = new FakeMail();
  const fallback = new FakeMail();
  const platform = new FakeMail();
  const attempted: Record<"primary" | "fallback", MailMessage[]> = { primary: [], fallback: [] };
  const { lines, logger } = captureLogs();
  const outcomes: LedgerOutcome[] = [];
  const provider = (slot: string): LockedClinicProvider => {
    const id = randomUUID();
    return {
      row: {
        id,
        version: 1,
        kind: "resend",
        fromName: "Clinic",
        fromEmail: `${slot}@example.invalid`,
        replyTo: null,
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        sealedCredentials: sealer.seal(slot, id),
        verifiedAt: new Date(),
        degradedAt: null,
        consecutiveFailures: 0,
      },
      record: async () => false,
    };
  };
  let state: LockedNotification = {
    kind: "ready",
    ledger: {
      id: randomUUID(),
      kind: "booked",
      channel: "email",
      patientId: randomUUID(),
      subjectId: randomUUID(),
      lastError: null,
    },
    clinic: { nameAr: "عيادة", nameEn: "Clinic", language: "en", timeZone: "Asia/Kuwait" },
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    patient: {
      email: "patient@example.invalid",
      phone: "+96550000000",
      language: "en",
      optedOut: false,
    },
    appointment: {
      status: "booked",
      startUnchanged: true,
      startsAt: new Date("2026-11-01T09:00:00Z"),
      branch: { nameAr: "فرع", nameEn: "Branch", address: null },
      providerName: "Doctor",
    },
    visit: null,
    invoice: null,
    providers: { primary: provider("primary"), fallback: provider("fallback") },
    whatsapp: null,
    record: async (outcome) => {
      outcomes.push(outcome);
      if (state.kind === "ready" && outcome.kind === "failure") {
        state = { ...state, ledger: { ...state.ledger, lastError: outcome.error } };
      }
    },
    auditPrescriptionSent: async () => undefined,
    revokeInvoiceLinks: async () => undefined,
  };
  const event: ClaimedEvent = {
    id: randomUUID(),
    clinicId: randomUUID(),
    type: "patient.notification_requested",
    payload: { notificationId: state.ledger.id },
    attempts: 0,
    createdAt: new Date("2026-10-13T00:00:00Z"),
  };
  const dispatch = notificationDispatcher({
    store: { whileLocked: async (_clinicId, _notificationId, use) => use(state) },
    invoiceLinks: {
      store: { prepare: async () => ({ kind: "not_invoice" }) },
      sealer: null,
      appUrl: "https://app.example.invalid",
    },
    clinicMail: {
      sealer,
      platformFrom: "platform@example.invalid",
      senders: {
        open: async (credentials) => {
          const slot =
            credentials.kind === "resend" && credentials.apiKey === "primary"
              ? "primary"
              : "fallback";
          return {
            sender: {
              send: async (message) => {
                attempted[slot].push(message);
                return (slot === "primary" ? primary : fallback).send(message);
              },
            },
            close: () => undefined,
          };
        },
      },
    },
    platform,
    whatsapp: null,
    cipher: null,
    clock: { now: () => new Date("2026-10-13T00:00:00Z") },
    logger,
  });
  return {
    primary,
    fallback,
    platform,
    outcomes,
    attempted,
    lines,
    eventId: event.id,
    identity: (slot: "primary" | "fallback") =>
      state.kind === "ready" ? state.providers[slot]?.row : undefined,
    setLastError: (lastError: string) => {
      if (state.kind === "ready") state = { ...state, ledger: { ...state.ledger, lastError } };
    },
    dispatch: (attempts: number) => dispatch({ ...event, attempts }),
    replaceProvider: (
      slot: "primary" | "fallback",
      transform: (row: LockedClinicProvider) => LockedClinicProvider | null,
    ) => {
      if (state.kind === "ready" && state.providers[slot] !== null) {
        state = {
          ...state,
          providers: { ...state.providers, [slot]: transform(state.providers[slot]) },
        };
      }
    },
  };
}

describe("ambiguous attempts retain the exact provider identity and version", () => {
  it.each(["gone", "degraded", "changed", "recreated"] as const)(
    "%s provider cannot cause a second send through another provider",
    async (change) => {
      const h = harness();
      h.primary.result = async () => ({ sent: false, error: "smtp_timeout_after_data" });
      expect((await h.dispatch(0)).kind).toBe("retry");
      h.replaceProvider("primary", (provider) => {
        if (change === "gone") return null;
        const row = { ...provider.row };
        if (change === "degraded") row.degradedAt = new Date();
        if (change === "changed") row.version += 1;
        if (change === "recreated") row.id = randomUUID();
        return { ...provider, row };
      });
      h.primary.result = async () => ({ sent: true, provider: "resend", fallback: false });
      expect(await h.dispatch(1)).toEqual({
        kind: "failed",
        error: "ambiguous_provider_unavailable",
      });
      expect(h.outcomes.at(-1)).toMatchObject({
        kind: "failure",
        final: true,
        error: "ambiguous_provider_unavailable",
      });
      expect([...h.primary.sent, ...h.fallback.sent, ...h.platform.sent]).toHaveLength(0);
    },
  );

  it("a definite failure on the pinned retry preserves the original ambiguity for the next retry", async () => {
    const h = harness();
    h.primary.result = async () => ({ sent: false, error: "resend_timeout" });
    expect((await h.dispatch(0)).kind).toBe("retry");
    h.primary.result = async () => ({ sent: false, error: "resend_500" });
    expect((await h.dispatch(1)).kind).toBe("retry");
    expect([...h.fallback.sent, ...h.platform.sent]).toHaveLength(0);
    h.replaceProvider("primary", (provider) => ({
      ...provider,
      row: { ...provider.row, version: 2 },
    }));
    expect(await h.dispatch(2)).toEqual({
      kind: "failed",
      error: "ambiguous_provider_unavailable",
    });
    expect([...h.primary.sent, ...h.fallback.sent, ...h.platform.sent]).toHaveLength(0);
  });

  it("persists the exact provider pin and successfully retries the unchanged provider with the same event key", async () => {
    const h = harness();
    const identity = h.identity("primary")!;
    h.primary.result = async () => ({ sent: false, error: "resend_timeout" });
    expect((await h.dispatch(0)).kind).toBe("retry");
    expect(h.outcomes[0]).toMatchObject({
      kind: "failure",
      final: false,
      error: `primary:resend_timeout:${identity.id}:${identity.version}`,
    });
    h.primary.result = async () => ({ sent: true, provider: "resend", fallback: false });
    expect(await h.dispatch(1)).toEqual({ kind: "dispatched" });
    expect(h.outcomes.at(-1)).toMatchObject({ kind: "sent", route: "primary" });
    expect(h.attempted.primary.map((message) => message.idempotencyKey)).toEqual([
      h.eventId,
      h.eventId,
    ]);
    expect(h.primary.sent).toHaveLength(1);
    expect([...h.fallback.sent, ...h.platform.sent]).toHaveLength(0);
    for (const address of [
      "patient@example.invalid",
      "primary@example.invalid",
      "platform@example.invalid",
    ]) {
      expect(h.lines.join("\n")).not.toContain(address);
    }
  });

  it("fails a legacy ambiguous clinic attempt without a provider pin before sending", async () => {
    const h = harness();
    h.setLastError("primary:smtp_timeout_after_data");
    expect(await h.dispatch(1)).toEqual({ kind: "failed", error: "ambiguous_provider_unknown" });
    expect(h.outcomes.at(-1)).toMatchObject({
      kind: "failure",
      final: true,
      error: "ambiguous_provider_unknown",
    });
    expect([...h.attempted.primary, ...h.attempted.fallback, ...h.platform.sent]).toHaveLength(0);
  });

  it.each(["gone", "changed"] as const)(
    "a %s pinned fallback never sends via primary or platform",
    async (change) => {
      const h = harness();
      const identity = h.identity("fallback")!;
      h.primary.result = async () => ({ sent: false, error: "resend_500" });
      h.fallback.result = async () => ({ sent: false, error: "resend_timeout" });
      expect((await h.dispatch(0)).kind).toBe("retry");
      expect(h.outcomes[0]).toMatchObject({
        error: `fallback:resend_timeout:${identity.id}:${identity.version}`,
      });
      h.replaceProvider("fallback", (provider) =>
        change === "gone" ? null : { ...provider, row: { ...provider.row, version: 2 } },
      );
      const primaryAttempts = h.attempted.primary.length;
      const fallbackAttempts = h.attempted.fallback.length;
      expect(await h.dispatch(1)).toEqual({
        kind: "failed",
        error: "ambiguous_provider_unavailable",
      });
      expect(h.attempted.primary).toHaveLength(primaryAttempts);
      expect(h.attempted.fallback).toHaveLength(fallbackAttempts);
      expect([...h.primary.sent, ...h.fallback.sent, ...h.platform.sent]).toHaveLength(0);
    },
  );
});
