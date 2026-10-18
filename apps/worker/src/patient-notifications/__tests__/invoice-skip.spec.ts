import { randomBytes, randomUUID } from "node:crypto";

import { DEFAULT_NOTIFICATION_SETTINGS } from "@eyadex/contracts/notifications";
import type { ClaimedEvent } from "@eyadex/db";
import { SecretSealer } from "@eyadex/secrets";
import { describe, expect, it, vi } from "vitest";

import { captureLogs, FakeMail } from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import type { LedgerOutcome, ReadyNotification } from "../ports/notification-store.ts";
import { notificationDispatcher } from "../send-notification.ts";

describe("invoice eligibility before link preparation", () => {
  it.each(["no_key", "unreachable"] as const)(
    "records setting_off without calling a %s link store",
    async (linkState) => {
      const outcomes: LedgerOutcome[] = [];
      const state: ReadyNotification & { readonly kind: "ready" } = {
        kind: "ready",
        ledger: {
          id: randomUUID(),
          kind: "invoice",
          channel: "email",
          patientId: randomUUID(),
          subjectId: randomUUID(),
          lastError: null,
        },
        clinic: { nameAr: "عيادة", nameEn: "Clinic", language: "en", timeZone: "Asia/Kuwait" },
        settings: { ...DEFAULT_NOTIFICATION_SETTINGS, emailEnabled: false },
        patient: { email: null, phone: "", language: "en", optedOut: false },
        appointment: null,
        visit: null,
        invoice: {
          number: "SLM-2026-000001",
          totalMinor: "1000",
          currency: "KWD",
          currencyExponent: 3,
          status: "issued",
        },
        providers: { primary: null, fallback: null },
        whatsapp: null,
        record: async (outcome) => {
          outcomes.push(outcome);
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
        createdAt: new Date(),
      };
      const prepare = vi.fn(async () => {
        if (linkState === "unreachable") throw new Error("link store unavailable");
        return { kind: "no_key" as const };
      });
      const platform = new FakeMail();
      const { logger } = captureLogs();
      const dispatch = notificationDispatcher({
        store: { whileLocked: async (_clinicId, _notificationId, use) => use(state) },
        invoiceLinks: {
          store: { prepare },
          sealer: null,
          appUrl: "https://app.example.invalid",
        },
        clinicMail: {
          sealer: new SecretSealer(randomBytes(32).toString("base64")),
          senders: { open: async () => ({ sender: platform, close: () => undefined }) },
          platformFrom: "platform@example.invalid",
        },
        platform,
        whatsapp: null,
        cipher: null,
        clock: { now: () => event.createdAt },
        logger,
      });

      expect(await dispatch(event)).toEqual({ kind: "dispatched" });
      expect(outcomes).toEqual([{ kind: "skipped", reason: "setting_off", at: event.createdAt }]);
      expect(prepare).not.toHaveBeenCalled();
      expect(platform.sent).toEqual([]);
    },
  );
});
