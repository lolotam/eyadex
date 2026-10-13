import { NOTIFICATION_KINDS, type NotificationKind } from "@eyadex/contracts/notifications";
import type { WhatsappChannelView, WhatsappTemplate } from "@eyadex/contracts/whatsapp";
import type { MockState } from "./mock-store";

/** How long the mock "phone" takes to scan the QR (brief §4). */
export const MOCK_SCAN_DELAY_MS = 6000;
/** The linked number the mock reports once scanned. */
export const MOCK_PHONE_LAST4 = "0000";
/** A small valid PNG of a QR code (fictional content), the placeholder the mock shows to scan. */
export const MOCK_QR_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACEAAAAhAQAAAAB/n//CAAAAuElEQVR42l3OIU8CcQDG4d//9baDXTgpbtcYCRvpvJnAYiWx0dwFPgc0AoFMsln8AI4vgMXgBDdvhts4R2KT7eDuNjnMWp78mBMwEgB/3HkvFWTP+9/oOGnXEWUMomiCzsbtGBXBwzlyv95yzH6QtGqWcf2LD36cyB7qsFnlqDoNQWrc5ajw1UVaz54wae/91pPzuADtLst7TJZ8PhuThpHbEfZNjDgsA0yWXM9eVVw5AZa7/f8E4Bfe4TaotheGQAAAAABJRU5ErkJggg==";

/** The channel row as the mock keeps it: the view plus what never leaves the server. */
export type StoredWhatsappChannel = WhatsappChannelView & {
  accessToken: string | null;
  riskVersion: number | null;
  /** When the Evolution QR was issued; the mock "scans" it MOCK_SCAN_DELAY_MS later. */
  pendingSince: number | null;
};

type WhatsappMockState = {
  channels: Record<string, StoredWhatsappChannel>;
  /** Tests switch the mock server to "WhatsApp not configured". */
  unavailable?: boolean;
};

const emptyTemplates = () =>
  Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, null])) as Record<
    NotificationKind,
    WhatsappTemplate | null
  >;

export function whatsappState(db: MockState): WhatsappMockState {
  db.whatsapp ??= { channels: {} };
  return db.whatsapp;
}

/** The clinic's channel (no row = disconnected). Only QR refresh can settle a pending link. */
export function channelOf(db: MockState, clinicId: string): StoredWhatsappChannel {
  const state = whatsappState(db);
  const row = (state.channels[clinicId] ??= {
    transport: null,
    status: "disconnected",
    phoneLast4: null,
    riskAcceptedAt: null,
    hasCredentials: false,
    templates: emptyTemplates(),
    connectedAt: null,
    lastError: null,
    accessToken: null,
    phoneNumberId: null,
    businessAccountId: null,
    riskVersion: null,
    pendingSince: null,
  });
  return row;
}

/** The view includes non-secret Meta identifiers; the token and timers never leave the mock. */
export function channelView(row: StoredWhatsappChannel): WhatsappChannelView {
  return {
    transport: row.transport,
    status: row.status,
    phoneLast4: row.phoneLast4,
    riskAcceptedAt: row.riskAcceptedAt,
    hasCredentials: row.hasCredentials,
    phoneNumberId: row.transport === "coexistence" ? row.phoneNumberId : null,
    businessAccountId: row.transport === "coexistence" ? row.businessAccountId : null,
    templates: { ...row.templates },
    connectedAt: row.connectedAt,
    lastError: row.lastError,
  };
}
