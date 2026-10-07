import {
  enableTotpResponseSchema,
  signInResponseSchema,
  verifyBackupCodeResponseSchema,
  verifyTotpResponseSchema,
} from "./auth-schemas";
import type { SignInResponse } from "./auth-schemas";
import { createTransport, type Transport } from "./http-transport";

/**
 * Sign-in for the HTTP mode, on the ADR-0004 allowlist only. Better Auth's request shapes are sent
 * as they are; there is no trust-device option (the platform refuses it, and the clinic does not
 * offer it either).
 */
export type AuthClient = {
  signIn(email: string, password: string): Promise<SignInResponse>;
  signOut(): Promise<void>;
  /** Starts enrolment: the otpauth URI to show as a QR code, and the recovery codes to show once. */
  enableTotp(password: string): Promise<TotpEnrollment>;
  verifyTotp(code: string): Promise<void>;
  /** The second step with a one-time recovery code, for a lost authenticator. */
  verifyBackupCode(code: string): Promise<void>;
};

export type TotpEnrollment = { uri: string; backupCodes: string[] };

export function createAuthClient(transport: Transport = createTransport()): AuthClient {
  return {
    signIn: (email, password) =>
      transport.send("POST", "/auth/sign-in/email", {
        schema: signInResponseSchema,
        body: { email, password },
      }),
    signOut: () => transport.sendEmpty("POST", "/auth/sign-out", { body: {} }),
    enableTotp: async (password) => {
      const answer = await transport.send("POST", "/auth/two-factor/enable", {
        schema: enableTotpResponseSchema,
        body: { password },
      });
      return { uri: answer.totpURI, backupCodes: answer.backupCodes };
    },
    verifyTotp: async (code) => {
      await transport.send("POST", "/auth/two-factor/verify-totp", {
        schema: verifyTotpResponseSchema,
        body: { code },
      });
    },
    verifyBackupCode: async (code) => {
      await transport.send("POST", "/auth/two-factor/verify-backup-code", {
        schema: verifyBackupCodeResponseSchema,
        body: { code },
      });
    },
  };
}
