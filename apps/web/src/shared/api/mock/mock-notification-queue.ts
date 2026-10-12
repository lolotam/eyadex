import {
  DEFAULT_NOTIFICATION_SETTINGS,
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

/** How long the mock "worker" takes to decide a queued message. */
export const MOCK_SEND_DELAY_MS = 1000;

export function settingsOf(db: MockState, clinicId: string): NotificationSettings {
  return notificationState(db).settings[clinicId] ?? DEFAULT_NOTIFICATION_SETTINGS;
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
  if (!settings.emailEnabled || !settings.messages[row.kind]) return "setting_off";
  const patient = db.patients.find((p) => p.clinicId === row.clinicId && p.id === row.patientId);
  if (!patient?.email) return "no_email";
  if ((row.kind === "reminder_day" || row.kind === "reminder_2h") && patient.notificationsOptOut)
    return "opted_out";
  if (row.subjectType === "appointment" && row.kind !== "cancelled") {
    const appt = db.appointments.find((a) => a.id === row.subjectId);
    if (!appt || appt.status !== "booked") return "not_booked";
    if (appt.startsAt !== row.subjectAt) return "moved";
  }
  return null;
}

/** The mock worker: settles one queued row as sent or skipped. */
export function settleNotification(db: MockState, id: string): void {
  const row = notificationState(db).ledger.find((r) => r.id === id);
  if (!row || row.status !== "queued") return;
  const reason = skipReason(db, row);
  if (reason) {
    row.status = "skipped";
    row.skipReason = reason;
  } else {
    row.status = "sent";
    row.route = routeOf(db, row.clinicId);
    row.sentAt = new Date().toISOString();
  }
}

/**
 * Spec §3.1/§3.4: one queued row when email and this message kind are on; nothing at all otherwise.
 * The row settles a moment later, as the worker would.
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
  if (!settings.emailEnabled || !settings.messages[subject.kind]) return;
  const row: StoredNotification = {
    ...subject,
    id: newId(),
    channel: "email",
    status: "queued",
    skipReason: null,
    route: null,
    createdAt: new Date().toISOString(),
    sentAt: null,
  };
  notificationState(db).ledger.push(row);
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
    }));
  return { items };
}
