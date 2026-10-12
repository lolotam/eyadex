import type { MailProviderView } from "@eyadex/contracts/mail-provider";
import type {
  MailProviderSlot,
  NotificationSettings,
  PatientNotification,
} from "@eyadex/contracts/notifications";
import type { MockState } from "./mock-store";

/** A clinic provider as the mock keeps it: the view plus the write-only secret, never returned. */
export type StoredMailProvider = MailProviderView & { id: string; secret: string; version: number };

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
  /** One cooldown per clinic, so testing another slot cannot bypass the API limit. */
  lastTest: Record<string, number>;
  /** Saves retain their original answer, even after a later replacement or removal. */
  replays?: Record<string, { fingerprint: string; response: MailProviderView }>;
  testReplays?: Record<string, true>;
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
  // Older persisted demo providers have no identity; give them one before a test is requested.
  for (const provider of Object.values(state.providers[clinicId])) {
    if (provider && !provider.id) provider.id = crypto.randomUUID();
  }
  return state.providers[clinicId];
}

/** The view only: the identity, secret and version never leave the mock. */
export function providerView(p: StoredMailProvider | null): MailProviderView | null {
  if (!p) return null;
  const { id: _id, secret: _secret, version: _version, ...view } = p;
  return view;
}
