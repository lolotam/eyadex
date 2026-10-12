import { z } from "zod";

// A clinic's own mail provider (ADR-0014, slice 7c-2a). Credentials are write-only: they are part of the
// request and never of any response.
const email = z.string().trim().toLowerCase().email("validation.email").max(254);

const sender = {
  fromName: z.string().trim().min(1, "validation.required").max(100, "validation.tooLong"),
  fromEmail: email,
  replyTo: email.optional(),
};

/** The SMTP ports a clinic may use; the worker refuses any other at connect time too. */
export const SMTP_PORTS = [25, 465, 587, 2525] as const;

// A public DNS name only: no IP literal (its last label is all digits or holds ':'), no single-label or
// local-only name. Syntax only: the worker resolves the name and refuses any non-public address.
const DNS_NAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const LOCAL_SUFFIX = /(?:^|\.)(?:localhost|local|internal|lan|home\.arpa)$/;
const smtpHost = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "validation.required")
  .max(253, "validation.tooLong")
  .refine((host) => DNS_NAME.test(host) && !LOCAL_SUFFIX.test(host), "validation.smtpHost");

export const mailProviderKindSchema = z.enum(["resend", "smtp"]);
export type MailProviderKind = z.infer<typeof mailProviderKindSchema>;

export const resendMailProviderRequestSchema = z
  .object({
    kind: z.literal("resend"),
    apiKey: z.string().min(1, "validation.required").max(500, "validation.tooLong"),
    ...sender,
  })
  .strict();

export const smtpMailProviderRequestSchema = z
  .object({
    kind: z.literal("smtp"),
    host: smtpHost,
    port: z
      .number()
      .int()
      .refine((port) => (SMTP_PORTS as readonly number[]).includes(port), "validation.outOfRange"),
    user: z.string().min(1, "validation.required").max(200, "validation.tooLong"),
    password: z.string().min(1, "validation.required").max(500, "validation.tooLong"),
    ...sender,
  })
  .strict();

/** `PUT /v1/clinic/mail-provider`: creates the clinic's one provider or replaces it whole. */
export const mailProviderRequestSchema = z.discriminatedUnion("kind", [
  resendMailProviderRequestSchema,
  smtpMailProviderRequestSchema,
]);
export type MailProviderRequest = z.infer<typeof mailProviderRequestSchema>;

/** What the clinic sees back: never the API key or the password, only that one is stored. */
export const mailProviderViewSchema = z
  .object({
    kind: mailProviderKindSchema,
    fromName: z.string(),
    fromEmail: z.string(),
    replyTo: z.string().nullable(),
    smtpHost: z.string().nullable(),
    smtpPort: z.number().int().nullable(),
    smtpUser: z.string().nullable(),
    hasCredentials: z.literal(true),
    verifiedAt: z.string().datetime().nullable(),
    lastError: z.string().nullable(),
    degradedAt: z.string().datetime().nullable(),
  })
  .strict();
export type MailProviderView = z.infer<typeof mailProviderViewSchema>;

/** `GET` answers the view, or `null` when the clinic has no provider (the platform sends). */
export const mailProviderResponseSchema = mailProviderViewSchema.nullable();
export type MailProviderResponse = z.infer<typeof mailProviderResponseSchema>;

/**
 * `GET /v1/clinic/mail-providers`: both slots (phase 3, N-3). The primary sends first; the fallback only
 * when the primary certainly did not accept the message; Eyadex sends on the clinic's behalf last. A
 * fallback without a primary is refused on `PUT`, so `fallback` is non-null only when `primary` is.
 * `PUT`/`DELETE /v1/clinic/mail-providers/:slot` and `POST …/:slot/test` take the same bodies as the
 * single-provider routes above, which stay as the primary slot's alias.
 */
export const mailProvidersResponseSchema = z
  .object({
    primary: mailProviderViewSchema.nullable(),
    fallback: mailProviderViewSchema.nullable(),
  })
  .strict();
export type MailProvidersResponse = z.infer<typeof mailProvidersResponseSchema>;
