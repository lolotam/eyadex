import type { MailProviderView } from "@eyadex/contracts/mail-provider";
import type {
  MailProviderSlot,
  NotificationSettings,
  PatientNotification,
} from "@eyadex/contracts/notifications";
import type { MockState } from "./mock-store";

/** A clinic provider as the mock keeps it: the view plus the write-only secret, never returned. */
export type StoredMailProvider = MailProviderView & { secret: string; version: number };

/** One ledger row (spec §2): no address and no text, only what the history shows plus its subject. */
export type StoredNotification = PatientNotification & {
  clinicId: string;
  patientId: string;
  subjectType: "appointment" | "visit";
  subjectId: string;
  /** The appointment start it was built for; a moved appointment skips it as `moved`. */
  subjectAt: string | null;
};

export type NotificationState = {
  /** By clinic id; a clinic with no entry uses DEFAULT_NOTIFICATION_SETTINGS. */
  settings: Record<string, NotificationSettings>;
  providers: Record<string, Record<MailProviderSlot, StoredMailProvider | null>>;
  ledger: StoredNotification[];
  /** "clinicId:slot" -> the time the last test was asked for (the API's cooldown). */
  lastTest: Record<string, number>;
  /** Idempotency-Key replay for provider saves, keyed as the other ledgers: key -> fingerprint. */
  replays?: Record<string, string>;
};

/** The notification part of the mock state, created on first use (older saved state has none). */
export function notificationState(db: MockState): NotificationState {
  db.notifications ??= { settings: {}, providers: {}, ledger: [], lastTest: {} };
  return db.notifications;
}

export function clinicProviders(
  db: MockState,
  clinicId: string,
): Record<MailProviderSlot, StoredMailProvider | null> {
  const state = notificationState(db);
  state.providers[clinicId] ??= { primary: null, fallback: null };
  return state.providers[clinicId];
}

/** The view only: the secret and the version never leave the mock. */
export function providerView(p: StoredMailProvider | null): MailProviderView | null {
  if (!p) return null;
  const { secret: _secret, version: _version, ...view } = p;
  return view;
}
