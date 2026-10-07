import { z } from "zod";

// A clinic's own mail provider (ADR-0014, slice 7c-2a). Credentials are write-only: they are part of the
// request and never of any response.
const email = z.string().trim().toLowerCase().email("validation.email").max(254);

const sender = {
  fromName: z.string().trim().min(1, "validation.required").max(100, "validation.tooLong"),
  fromEmail: email,
  replyTo: email.optional(),
};

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
    host: z.string().trim().min(1, "validation.required").max(253, "validation.tooLong"),
    port: z.number().int().min(1).max(65_535),
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
