import { z } from "zod";

/**
 * Accepting an invitation over HTTP (Phase B slice 3b, ADR-0008). The token travels in the request
 * BODY only — never a URL or a query string, which proxies and logs keep.
 */
const tokenSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);

/** The same bounds as `PASSWORD_LIMITS` in packages/auth; the API test pins them together. */
export const ACCEPT_PASSWORD_LIMITS = { min: 8, max: 128 } as const;

export const inspectInvitationRequestSchema = z.object({ token: tokenSchema }).strict();
export type InspectInvitationRequest = z.infer<typeof inspectInvitationRequestSchema>;

export const inspectInvitationResponseSchema = z.object({
  clinicNameAr: z.string(),
  clinicNameEn: z.string(),
  email: z.string(),
  fullName: z.string(),
  expiresAt: z.string().datetime(),
});
export type InspectInvitationResponse = z.infer<typeof inspectInvitationResponseSchema>;

export const acceptInvitationRequestSchema = z
  .object({
    token: tokenSchema,
    password: z.string().min(ACCEPT_PASSWORD_LIMITS.min).max(ACCEPT_PASSWORD_LIMITS.max),
  })
  .strict();
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

/** No session and no cookie: the user signs in normally afterwards (ADR-0008). */
export const acceptInvitationResponseSchema = z.object({
  clinicId: z.string().uuid(),
  email: z.string(),
});
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;
