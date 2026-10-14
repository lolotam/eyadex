import { z } from "zod";
import { NOTIFICATION_KINDS, type NotificationKind } from "./notifications.ts";

// Phase 3 N2: patient notifications over WhatsApp (docs/specs/notifications-design.md §7, decisions
// N-6, N-7). One channel per clinic, through the clinic's own number, never Eyadex's.

/**
 * How the clinic's number is linked (N-6). `evolution`: the unofficial WhatsApp Web link through
 * Evolution API, connected by scanning a QR code — the number can be banned by WhatsApp, so an admin
 * must accept that risk first. `coexistence`: Meta's WhatsApp Business Platform on a number that keeps
 * the WhatsApp Business app; messages outside a conversation must be templates approved by Meta.
 */
export const whatsappTransportSchema = z.enum(["evolution", "coexistence"]);
export type WhatsappTransport = z.infer<typeof whatsappTransportSchema>;

export const whatsappStatusSchema = z.enum(["disconnected", "pending", "connected"]);
export type WhatsappStatus = z.infer<typeof whatsappStatusSchema>;

/** The risk text version an admin accepts before an `evolution` link (audited with the version). */
export const WHATSAPP_RISK_VERSION = 1;

/**
 * A Meta template for one message kind (coexistence only). Body parameters are filled in this fixed
 * order — appointment kinds: {{1}} clinic, {{2}} date, {{3}} time, {{4}} provider, {{5}} branch;
 * prescription: {{1}} clinic, {{2}} doctor, {{3}} the medicine lines joined by " • ".
 */
export const whatsappTemplateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "validation.required")
      .max(512, "validation.tooLong")
      .regex(/^[a-z0-9_]+$/, "validation.templateName"),
    language: z
      .string()
      .trim()
      .regex(/^[a-z]{2}(_[A-Z]{2})?$/, "validation.templateLanguage"),
  })
  .strict();
export type WhatsappTemplate = z.infer<typeof whatsappTemplateSchema>;

const templateSlots = z
  .object(
    Object.fromEntries(
      NOTIFICATION_KINDS.map((kind) => [kind, whatsappTemplateSchema.nullable()]),
    ) as Record<NotificationKind, z.ZodNullable<typeof whatsappTemplateSchema>>,
  )
  .strict();

/**
 * `GET /v1/clinic/whatsapp`: the clinic's channel. The Meta identifiers are not credentials;
 * the view still never carries the token or the full number.
 */
export const whatsappChannelViewSchema = z
  .object({
    transport: whatsappTransportSchema.nullable(),
    status: whatsappStatusSchema,
    /** Last four digits of the linked number, once connected. */
    phoneLast4: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(),
    riskAcceptedAt: z.string().datetime().nullable(),
    /** Coexistence only: whether Meta credentials are stored (write-only). */
    hasCredentials: z.boolean(),
    /** Meta phone number identifier, not a phone number or credential; coexistence only. */
    phoneNumberId: z
      .string()
      .regex(/^\d{5,30}$/)
      .nullable(),
    /** Meta business account identifier, not a credential; coexistence only. */
    businessAccountId: z
      .string()
      .regex(/^\d{5,30}$/)
      .nullable(),
    templates: templateSlots,
    connectedAt: z.string().datetime().nullable(),
    lastError: z.string().nullable(),
  })
  .strict();
export type WhatsappChannelView = z.infer<typeof whatsappChannelViewSchema>;

/**
 * `POST /v1/clinic/whatsapp/connect` (evolution): creates or reuses the clinic's Evolution instance
 * and answers its QR. `acceptRisk` must be `true` with the current `riskVersion` the first time.
 */
export const whatsappConnectRequestSchema = z
  .object({
    acceptRisk: z.literal(true),
    riskVersion: z.literal(WHATSAPP_RISK_VERSION),
  })
  .strict();
export type WhatsappConnectRequest = z.infer<typeof whatsappConnectRequestSchema>;

/** The QR to scan (a PNG data URL) while `pending`, or `null` once connected. */
export const whatsappQrResponseSchema = z
  .object({
    status: whatsappStatusSchema,
    qrDataUrl: z
      .string()
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
      .nullable(),
  })
  .strict();
export type WhatsappQrResponse = z.infer<typeof whatsappQrResponseSchema>;

/** `PUT /v1/clinic/whatsapp/coexistence`: the write-only Meta token, identifiers and templates. */
export const whatsappCoexistenceRequestSchema = z
  .object({
    accessToken: z
      .string()
      .min(20, "validation.tooShort")
      .max(2048, "validation.tooLong")
      .optional(),
    phoneNumberId: z.string().regex(/^\d{5,30}$/, "validation.number"),
    businessAccountId: z.string().regex(/^\d{5,30}$/, "validation.number"),
    templates: templateSlots,
  })
  .strict();
export type WhatsappCoexistenceRequest = z.infer<typeof whatsappCoexistenceRequestSchema>;

/**
 * `GET /v1/clinic/whatsapp/signup-config` (N3): what the browser needs to open Meta's Embedded Signup.
 * Both ids are public; the app secret never leaves the API. 404 `unavailable` when not configured.
 */
export const whatsappSignupConfigSchema = z
  .object({
    appId: z.string().regex(/^\d{5,30}$/),
    configId: z.string().regex(/^\d{5,30}$/),
    graphVersion: z.string().regex(/^v\d+\.\d+$/),
  })
  .strict();
export type WhatsappSignupConfig = z.infer<typeof whatsappSignupConfigSchema>;

/**
 * `POST /v1/clinic/whatsapp/embedded-signup` (N3): the one-time code from `FB.login` and the ids from
 * the `WA_EMBEDDED_SIGNUP` message. The API exchanges the code server-side; answers the channel view.
 */
export const whatsappEmbeddedSignupRequestSchema = z
  .object({
    code: z.string().min(1, "validation.required").max(1024, "validation.tooLong"),
    wabaId: z.string().regex(/^\d{5,30}$/, "validation.number"),
    phoneNumberId: z.string().regex(/^\d{5,30}$/, "validation.number"),
  })
  .strict();
export type WhatsappEmbeddedSignupRequest = z.infer<typeof whatsappEmbeddedSignupRequestSchema>;
