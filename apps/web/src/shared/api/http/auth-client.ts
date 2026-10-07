import {
  enableTotpResponseSchema,
  signInResponseSchema,
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
  /** Starts enrolment; answers the otpauth URI to show as a QR code. */
  enableTotp(password: string): Promise<string>;
  verifyTotp(code: string): Promise<void>;
};

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
      return answer.totpURI;
    },
    verifyTotp: async (code) => {
      await transport.send("POST", "/auth/two-factor/verify-totp", {
        schema: verifyTotpResponseSchema,
        body: { code },
      });
    },
  };
}
