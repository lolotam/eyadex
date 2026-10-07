import { errorCodeOf } from "@/shared/api/api-error";
import type { AuthClient } from "@/shared/api/http/auth-client";

/**
 * True once the API holds no session for this browser. A 401 means it had already ended; any other
 * failure leaves the cookie valid, so the caller must not tell the user they are signed out.
 */
export async function signOutOfApi(auth: Pick<AuthClient, "signOut">): Promise<boolean> {
  try {
    await auth.signOut();
    return true;
  } catch (error) {
    return errorCodeOf(error) === "unauthorized";
  }
}
