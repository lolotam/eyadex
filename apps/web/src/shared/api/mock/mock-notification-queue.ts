import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationChannel,
  type NotificationKind,
  type NotificationRoute,
  type NotificationSettings,
  type NotificationSkipReason,
} from "@eyadex/contracts/notifications";
import {
  clinicProviders,
  notificationState,
  type StoredNotification,
} from "./mock-notification-state";
import { getState, newId, persist, type MockState } from "./mock-store";
import { channelOf } from "./mock-whatsapp-state";

/** How long the mock "worker" takes to decide a queued message. */
export const MOCK_SEND_DELAY_MS = 1000;

export function settingsOf(db: MockState, clinicId: string): NotificationSettings {
  const saved = notificationState(db).settings[clinicId];
  return saved ? { ...DEFAULT_NOTIFICATION_SETTINGS, ...saved } : DEFAULT_NOTIFICATION_SETTINGS;
}

const usable = (p: { verifiedAt: string | null; degradedAt: string | null } | null) =>
  p !== null && p.verifiedAt !== null && p.degradedAt === null;

/** N-3: primary → fallback → Eyadex on the clinic's behalf; a provider counts only verified and healthy. */
function routeOf(db: MockState, clinicId: string): NotificationRoute {
  const slots = clinicProviders(db, clinicId);
  if (usable(slots.primary)) return "primary";
  if (usable(slots.fallback)) return "fallback";
  return "platform";
}

/** Spec §3.3: every skip is decided at send time, because each condition can change in between. */
function skipReason(db: MockState, row: StoredNotification): NotificationSkipReason | null {
  const settings = settingsOf(db, row.clinicId);
  const channelOn = row.channel === "email" ? settings.emailEnabled : settings.whatsappEnabled;
  if (!channelOn || !settings.messages[row.kind]) return "setting_off";
  const patient = db.patients.find((p) => p.clinicId === row.clinicId && p.id === row.patientId);
  if (row.channel === "email" && !patient?.email) return "no_email";
  if ((row.kind === "reminder_day" || row.kind === "reminder_2h") && patient?.notificationsOptOut)
    return "opted_out";
  if (row.subjectType === "appointment" && row.kind !== "cancelled") {
    const appt = db.appointments.find((a) => a.id === row.subjectId);
    if (!appt || appt.status !== "booked") return "not_booked";
    if (appt.startsAt !== row.subjectAt) return "moved";
  }
  if (row.channel === "whatsapp") {
    const channel = channelOf(db, row.clinicId);
    if (channel.status !== "connected") return "whatsapp_disconnected";
    if (channel.transport === "coexistence" && !channel.templates[row.kind])
      return "template_missing";
  }
  return null;
}

/**
 * Demo rule (deterministic, brief round 2 §3): WhatsApp accepts every message, then refuses delivery to
 * a patient whose phone ends in 0 — the row fails with `delivery_rejected`, as a real late refusal would.
 */
function rejectsDelivery(db: MockState, row: StoredNotification): boolean {
  const patient = db.patients.find((p) => p.clinicId === row.clinicId && p.id === row.patientId);
  return patient?.phone.replace(/\D/g, "").endsWith("0") ?? false;
}

/** The mock worker: settles one queued row as sent, skipped or failed. */
export function settleNotification(db: MockState, id: string): void {
  const row = notificationState(db).ledger.find((r) => r.id === id);
  if (!row || row.status !== "queued") return;
  const reason = skipReason(db, row);
  if (reason) {
    row.status = "skipped";
    row.skipReason = reason;
  } else if (row.channel === "whatsapp" && rejectsDelivery(db, row)) {
    row.status = "failed";
    row.failureReason = "delivery_rejected";
    row.route = channelOf(db, row.clinicId).transport ?? "evolution";
  } else {
    row.status = "sent";
    row.route =
      row.channel === "email"
        ? routeOf(db, row.clinicId)
        : (channelOf(db, row.clinicId).transport ?? "evolution");
    row.sentAt = new Date().toISOString();
  }
}

/**
 * Spec §3.1/§3.4 and §7.1: one queued row per channel that is on for this kind — email when email is
 * on; WhatsApp when it is on and the channel is connected at queue time. Rows settle a moment later.
 */
export function queueNotification(
  db: MockState,
  subject: {
    clinicId: string;
    patientId: string;
    kind: NotificationKind;
    subjectType: "appointment" | "visit";
    subjectId: string;
    subjectAt: string | null;
  },
): void {
  const settings = settingsOf(db, subject.clinicId);
  if (!settings.messages[subject.kind]) return;
  if (settings.emailEnabled) queueRow(db, subject, "email");
  if (settings.whatsappEnabled && channelOf(db, subject.clinicId).status === "connected")
    queueRow(db, subject, "whatsapp");
}

function queueRow(
  db: MockState,
  subject: Omit<
    StoredNotification,
    "id" | "channel" | "status" | "skipReason" | "route" | "createdAt" | "sentAt"
  >,
  channel: NotificationChannel,
): void {
  const ledger = notificationState(db).ledger;
  // Mirror the API's NULLS NOT DISTINCT ledger constraint before scheduling any worker effect.
  if (
    ledger.some(
      (row) =>
        row.clinicId === subject.clinicId &&
        row.subjectId === subject.subjectId &&
        row.kind === subject.kind &&
        row.channel === channel &&
        row.subjectAt === subject.subjectAt,
    )
  )
    return;
  const row: StoredNotification = {
    ...subject,
    id: newId(),
    channel,
    status: "queued",
    skipReason: null,
    route: null,
    createdAt: new Date().toISOString(),
    sentAt: null,
    failureReason: null,
  };
  ledger.push(row);
  setTimeout(() => {
    const current = getState();
    settleNotification(current, row.id);
    persist();
  }, MOCK_SEND_DELAY_MS);
}

/** The history of one subject, newest first, as the API's list (no clinic or subject fields). */
export function historyOf(db: MockState, clinicId: string, subjectId: string) {
  const items = notificationState(db)
    .ledger.filter((r) => r.clinicId === clinicId && r.subjectId === subjectId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      channel: r.channel,
      status: r.status,
      skipReason: r.skipReason,
      route: r.route,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
      failureReason: r.status === "failed" ? (r.failureReason ?? "other") : null,
    }));
  return { items };
}
