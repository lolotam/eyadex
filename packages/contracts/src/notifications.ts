import { z } from "zod";
import { utcDatetime } from "./datetime-compat.ts";
import { idSchema } from "./common.ts";

// Patient notifications (docs/specs/notifications-design.md, phase 3 N1). The patient is not a user:
// these are messages the clinic sends to the patient's email, never a login or a reply channel.

/** Every automatic message (owner decision N-1); the clinic can switch each one off. */
export const NOTIFICATION_KINDS = [
  "booked",
  "rescheduled",
  "cancelled",
  "reminder_day",
  "reminder_2h",
  "prescription",
] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/**
 * Every kind a ledger row can carry (0062): the automatic messages plus `invoice`, which a staff member
 * sends by hand (finance F1, spec §8 rule 15). It has no switch of its own; the channel switch applies.
 */
export const MESSAGE_KINDS = [...NOTIFICATION_KINDS, "invoice"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** The two reminders: the only kinds a patient's opt-out stops (N-2). */
export const REMINDER_KINDS: readonly NotificationKind[] = ["reminder_day", "reminder_2h"];

export const notificationChannelSchema = z.enum(["email", "whatsapp"]);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const notificationStatusSchema = z.enum(["queued", "sent", "skipped", "failed"]);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

/** Why a queued message was not sent; decided at send time, because each can change in between. */
export const notificationSkipReasonSchema = z.enum([
  "setting_off",
  "no_email",
  "opted_out",
  "not_booked",
  "moved",
  // N2: the clinic's WhatsApp is not connected at send time, or (coexistence) no Meta template is set
  // for that kind.
  "whatsapp_disconnected",
  "template_missing",
  // Finance F1 (spec §8 rule 15): the invoice was voided before the worker sent it.
  "invoice_void",
]);
export type NotificationSkipReason = z.infer<typeof notificationSkipReasonSchema>;

/**
 * Which sender delivered it. Email: the clinic's primary or fallback provider, or Eyadex on its behalf
 * (N-3). WhatsApp (N2): the clinic's transport.
 */
export const notificationRouteSchema = z.enum([
  "primary",
  "fallback",
  "platform",
  "evolution",
  "coexistence",
]);
export type NotificationRoute = z.infer<typeof notificationRouteSchema>;

const messageSwitches = z
  .object(
    Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, z.boolean()])) as Record<
      NotificationKind,
      z.ZodBoolean
    >,
  )
  .strict();

/** `GET`/`PUT /v1/clinic/notification-settings`. */
export const notificationSettingsSchema = z
  .object({ emailEnabled: z.boolean(), whatsappEnabled: z.boolean(), messages: messageSwitches })
  .strict();
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** A clinic that never saved its settings: email on, WhatsApp off until linked, every message on. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  emailEnabled: true,
  whatsappEnabled: false,
  messages: Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, true])) as Record<
    NotificationKind,
    boolean
  >,
};

/**
 * A failed message's reason as the clinic sees it (N2). The ledger keeps the provider's exact code;
 * this is the coarse mapping: `delivery_rejected` (WhatsApp accepted, then refused delivery),
 * `not_on_whatsapp`, `whatsapp_credentials` (Meta token or Evolution key refused), `template`
 * (Meta refused the template), `disconnected` (the linked phone dropped), `whatsapp_two_step` (the
 * WhatsApp Business app has two-step verification on), `unconfirmed` (no answer in
 * time; never resent, so the patient never gets it twice), `invalid_address` (bad phone or email),
 * `other`.
 */
export const notificationFailureReasonSchema = z.enum([
  "delivery_rejected",
  "not_on_whatsapp",
  "whatsapp_credentials",
  "template",
  "disconnected",
  "unconfirmed",
  "whatsapp_two_step",
  "invalid_address",
  "other",
]);
export type NotificationFailureReason = z.infer<typeof notificationFailureReasonSchema>;

/** One row of a message history (appointment details, visit page). No address, no text. */
export const patientNotificationSchema = z
  .object({
    id: idSchema,
    kind: notificationKindSchema,
    channel: notificationChannelSchema,
    status: notificationStatusSchema,
    skipReason: notificationSkipReasonSchema.nullable(),
    route: notificationRouteSchema.nullable(),
    createdAt: utcDatetime(),
    sentAt: utcDatetime().nullable(),
    /** Why a `failed` row failed, in coarse words; `null` for every other status. */
    failureReason: notificationFailureReasonSchema.nullable(),
    /** WhatsApp only (N3): when the patient's phone received it; `null` until the provider says so. */
    deliveredAt: utcDatetime().nullable(),
    /** WhatsApp only (N3): when the patient opened it; set only after `deliveredAt`. */
    readAt: utcDatetime().nullable(),
  })
  .strict();
export type PatientNotification = z.infer<typeof patientNotificationSchema>;

/** `GET /v1/appointments/:id/notifications` and `GET /v1/visits/:id/notifications`, newest first. */
export const patientNotificationListSchema = z
  .object({ items: z.array(patientNotificationSchema) })
  .strict();
export type PatientNotificationList = z.infer<typeof patientNotificationListSchema>;

/** The language a patient's messages use; `null` = the clinic's default language. */
export const messageLanguageSchema = z.enum(["ar", "en"]);
export type MessageLanguage = z.infer<typeof messageLanguageSchema>;

/** A clinic mail provider slot (N-3): the primary sends first, the fallback when it certainly failed. */
export const mailProviderSlotSchema = z.enum(["primary", "fallback"]);
export type MailProviderSlot = z.infer<typeof mailProviderSlotSchema>;
