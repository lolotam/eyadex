import {
  mailProviderRequestSchema,
  type MailProviderRequest,
} from "@eyadex/contracts/mail-provider";
import {
  mailProviderSlotSchema,
  notificationSettingsSchema,
  type MailProviderSlot,
} from "@eyadex/contracts/notifications";
import { ApiError } from "../api-error";
import type { NotificationsApi } from "../notifications-client";
import { authorize } from "./mock-actor";
import { authorizeAppointments, sees } from "./mock-appointment-rules";
import { writeClinicAudit } from "./mock-audit";
import { actorReplayKey, requireIdempotencyKey } from "./mock-idempotency";
import { requireKey, visibleVisit } from "./mock-medical-access";
import { historyOf, settingsOf } from "./mock-notification-queue";
import {
  clinicProviders,
  notificationState,
  providerView,
  type StoredMailProvider,
} from "./mock-notification-state";
import { delay, getState, newId, persist } from "./mock-store";

/** The API's cooldown between two test sends of one clinic. */
export const MAIL_TEST_COOLDOWN_MS = 60_000;
/** How long the mock "worker" takes to report a test send. */
export const MAIL_TEST_REPORT_MS = 2000;

function slotOf(raw: string): MailProviderSlot {
  const parsed = mailProviderSlotSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("validation");
  return parsed.data;
}

function toStored(input: MailProviderRequest, version: number, id: string): StoredMailProvider {
  const smtp = input.kind === "smtp";
  return {
    id,
    kind: input.kind,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    replyTo: input.replyTo ?? null,
    smtpHost: smtp ? input.host : null,
    smtpPort: smtp ? input.port : null,
    smtpUser: smtp ? input.user : null,
    hasCredentials: true,
    // A new or replaced provider is unproven until a test send succeeds (ADR-0014).
    verifiedAt: null,
    lastError: null,
    degradedAt: null,
    secret: smtp ? input.password : input.apiKey,
    version,
  };
}

/** Audit rows name the slot and the kind only: no address, no secret. */
const snapshot = (slot: MailProviderSlot, p: StoredMailProvider | null) =>
  p ? { id: p.id, slot, kind: p.kind } : null;

export function createMockNotifications(): NotificationsApi {
  return {
    async getSettings(persona) {
      await delay();
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "clinic_settings");
      return settingsOf(db, clinic.id);
    },

    async updateSettings(persona, raw) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "update", "clinic_settings");
      const parsed = notificationSettingsSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError("validation");
      const before = settingsOf(db, clinic.id);
      const state = notificationState(db);
      if (state.settings[clinic.id] && JSON.stringify(before) === JSON.stringify(parsed.data))
        return before;
      state.settings[clinic.id] = parsed.data;
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "clinic.notification_settings_updated",
        entity: "clinic",
        before: { id: clinic.id, ...before },
        after: { id: clinic.id, ...parsed.data },
      });
      persist();
      return parsed.data;
    },

    async mailProviders(persona) {
      await delay();
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "clinic_settings");
      const slots = clinicProviders(db, clinic.id);
      return { primary: providerView(slots.primary), fallback: providerView(slots.fallback) };
    },

    async setMailProvider(persona, rawSlot, raw, idempotencyKey) {
      await delay();
      const db = getState();
      const { clinic, actorName, member } = authorize(db, persona, "update", "clinic_settings");
      const slot = slotOf(rawSlot);
      const parsed = mailProviderRequestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError("validation");
      requireIdempotencyKey(idempotencyKey);
      const slots = clinicProviders(db, clinic.id);
      const state = notificationState(db);
      const replays = (state.replays ??= {});
      const replayKey = actorReplayKey(clinic.id, member.userId, `put:${slot}:${idempotencyKey}`);
      const fingerprint = JSON.stringify(parsed.data);
      const previous = replays[replayKey];
      if (previous !== undefined && typeof previous !== "string") {
        if (previous.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
        return { ...previous.response };
      }
      // N-3: a fallback exists only behind a primary.
      if (slot === "fallback" && !slots.primary)
        throw new ApiError("validation", undefined, { slot: "fallback_without_primary" });
      const before = slots[slot];
      const stored = toStored(parsed.data, (before?.version ?? 0) + 1, before?.id ?? newId());
      slots[slot] = stored;
      const response = providerView(stored)!;
      replays[replayKey] = { fingerprint, response };
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "clinic.mail_provider_updated",
        entity: "clinic_mail_provider",
        before: snapshot(slot, before),
        after: snapshot(slot, stored),
      });
      persist();
      return { ...response };
    },

    async removeMailProvider(persona, rawSlot) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "update", "clinic_settings");
      const slot = slotOf(rawSlot);
      const slots = clinicProviders(db, clinic.id);
      const before = slots[slot];
      if (!before) return;
      if (slot === "primary" && slots.fallback)
        throw new ApiError("validation", undefined, { slot: "primary_has_fallback" });
      slots[slot] = null;
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "clinic.mail_provider_removed",
        entity: "clinic_mail_provider",
        before: snapshot(slot, before),
        after: null,
      });
      persist();
    },

    async testMailProvider(persona, rawSlot, idempotencyKey) {
      await delay();
      const db = getState();
      const { clinic, actorName, member } = authorize(db, persona, "update", "clinic_settings");
      const slot = slotOf(rawSlot);
      requireIdempotencyKey(idempotencyKey);
      const state = notificationState(db);
      const replays = (state.testReplays ??= {});
      const replayKey = actorReplayKey(clinic.id, member.userId, `test:${slot}:${idempotencyKey}`);
      if (replays[replayKey]) return;
      const provider = clinicProviders(db, clinic.id)[slot];
      if (!provider) throw new ApiError("not_found");
      const last = state.lastTest[clinic.id];
      const wait =
        last === undefined ? 0 : Math.ceil((last + MAIL_TEST_COOLDOWN_MS - Date.now()) / 1000);
      if (wait > 0) throw new ApiError("rate_limited", undefined, { retryAfterSeconds: wait });
      state.lastTest[clinic.id] = Date.now();
      replays[replayKey] = true;
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "clinic.mail_provider_test_requested",
        entity: "clinic_mail_provider",
        before: null,
        after: snapshot(slot, provider),
      });
      persist();
      const version = provider.version;
      const providerId = provider.id;
      // The worker's report: a success verifies the provider and clears any degradation.
      setTimeout(() => {
        const current = clinicProviders(getState(), clinic.id)[slot];
        if (!current || current.id !== providerId || current.version !== version) return;
        current.verifiedAt = new Date().toISOString();
        current.degradedAt = null;
        current.lastError = null;
        persist();
      }, MAIL_TEST_REPORT_MS);
    },

    async appointmentHistory(persona, appointmentId) {
      await delay();
      const db = getState();
      const a = authorizeAppointments(db, persona, "view");
      const found = db.appointments.find(
        (x) => x.clinicId === a.clinic.id && x.id === appointmentId,
      );
      if (!found || !sees(a, found)) throw new ApiError("not_found");
      return historyOf(db, a.clinic.id, found.id);
    },

    async visitHistory(persona, visitId) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "view", "visits", ["clinic", "branch", "own"]);
      const v = visibleVisit(db, a, visitId);
      return historyOf(db, a.clinic.id, v.id);
    },
  };
}
