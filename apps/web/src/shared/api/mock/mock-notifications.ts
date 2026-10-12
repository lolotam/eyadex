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
import { actorReplayKey } from "./mock-idempotency";
import { requireKey, visibleVisit } from "./mock-medical-access";
import { historyOf, settingsOf } from "./mock-notification-queue";
import {
  clinicProviders,
  notificationState,
  providerView,
  type StoredMailProvider,
} from "./mock-notification-state";
import { delay, getState, persist } from "./mock-store";

/** The API's cooldown between two test sends of one slot. */
export const MAIL_TEST_COOLDOWN_MS = 60_000;
/** How long the mock "worker" takes to report a test send. */
export const MAIL_TEST_REPORT_MS = 2000;

function slotOf(raw: string): MailProviderSlot {
  const parsed = mailProviderSlotSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("validation");
  return parsed.data;
}

function toStored(input: MailProviderRequest, version: number): StoredMailProvider {
  const smtp = input.kind === "smtp";
  return {
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
const snapshot = (clinicId: string, slot: MailProviderSlot, p: StoredMailProvider | null) =>
  p ? { id: `${clinicId}:${slot}`, slot, kind: p.kind } : null;

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
      notificationState(db).settings[clinic.id] = parsed.data;
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "clinic.settings_updated",
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
      const slots = clinicProviders(db, clinic.id);
      const state = notificationState(db);
      const replays = (state.replays ??= {});
      const replayKey = actorReplayKey(clinic.id, member.id, idempotencyKey);
      const fingerprint = JSON.stringify({ slot, ...parsed.data });
      const previous = replays[replayKey];
      if (previous !== undefined) {
        if (previous !== fingerprint) throw new ApiError("idempotency_conflict");
        const current = providerView(slots[slot]);
        if (current) return current;
      }
      // N-3: a fallback exists only behind a primary.
      if (slot === "fallback" && !slots.primary) throw new ApiError("validation");
      const before = slots[slot];
      const stored = toStored(parsed.data, (before?.version ?? 0) + 1);
      slots[slot] = stored;
      replays[replayKey] = fingerprint;
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "clinic.mail_provider_updated",
        entity: "clinic_mail_provider",
        before: snapshot(clinic.id, slot, before),
        after: snapshot(clinic.id, slot, stored),
      });
      persist();
      return providerView(stored)!;
    },

    async removeMailProvider(persona, rawSlot) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "update", "clinic_settings");
      const slot = slotOf(rawSlot);
      const slots = clinicProviders(db, clinic.id);
      if (slot === "primary" && slots.fallback) throw new ApiError("validation");
      const before = slots[slot];
      if (!before) return;
      slots[slot] = null;
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "clinic.mail_provider_removed",
        entity: "clinic_mail_provider",
        before: snapshot(clinic.id, slot, before),
        after: null,
      });
      persist();
    },

    async testMailProvider(persona, rawSlot, idempotencyKey) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "update", "clinic_settings");
      const slot = slotOf(rawSlot);
      if (!idempotencyKey) throw new ApiError("validation");
      const provider = clinicProviders(db, clinic.id)[slot];
      if (!provider) throw new ApiError("not_found");
      const state = notificationState(db);
      const cooldownKey = `${clinic.id}:${slot}`;
      const last = state.lastTest[cooldownKey];
      if (last !== undefined && Date.now() - last < MAIL_TEST_COOLDOWN_MS)
        throw new ApiError("rate_limited");
      state.lastTest[cooldownKey] = Date.now();
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "clinic.mail_provider_test_requested",
        entity: "clinic_mail_provider",
        before: null,
        after: snapshot(clinic.id, slot, provider),
      });
      persist();
      const version = provider.version;
      // The worker's report: a success verifies the provider and clears any degradation.
      setTimeout(() => {
        const current = clinicProviders(getState(), clinic.id)[slot];
        if (!current || current.version !== version) return;
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
