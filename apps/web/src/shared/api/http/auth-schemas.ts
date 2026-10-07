import { z } from "zod";

/**
 * Better Auth's own answers on the ADR-0004 allowlist. Not in packages/contracts: the API forwards
 * them as Better Auth writes them. Only the fields the web reads are declared.
 */
export const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  twoFactorEnabled: z.boolean().nullish(),
});

/** `GET /api/auth/get-session`: null when there is no session. */
export const getSessionResponseSchema = z
  .object({ session: z.object({ id: z.string() }), user: authUserSchema })
  .nullable();
export type GetSessionResponse = z.infer<typeof getSessionResponseSchema>;

/** `POST /api/auth/sign-in/email`: a session, or a second step when two-step verification is on. */
export const signInResponseSchema = z.union([
  z.object({ twoFactorRedirect: z.literal(true) }),
  z.object({ user: authUserSchema }),
]);
export type SignInResponse = z.infer<typeof signInResponseSchema>;

/** `POST /api/auth/two-factor/enable`: the otpauth URI the authenticator app reads. */
export const enableTotpResponseSchema = z.object({ totpURI: z.string().startsWith("otpauth://") });

/** `POST /api/auth/two-factor/verify-totp`. */
export const verifyTotpResponseSchema = z.object({ user: authUserSchema }).passthrough();
