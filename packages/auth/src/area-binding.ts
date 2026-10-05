import { authUsers } from "@eyadex/db/schema";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { AuthArea } from "./options.ts";

/**
 * The only header Better Auth reads the client IP from (rate limit, `ip_address`). The API overwrites it
 * on every forwarded request from the socket or the trusted proxy hops, so a client-sent
 * `X-Forwarded-For` can neither spoof the address nor collapse everyone into one rate-limit bucket.
 */
export const CLIENT_IP_HEADER = "x-eyadex-client-ip";

/**
 * Better Auth `databaseHooks.session.create.before`: a session is only created for a user of this area.
 * Every path that mints a session goes through it — sign-in, verify-totp / verify-backup-code with the
 * `two_factor` cookie, trusted devices — so a clinic account can never hold a platform session (0024).
 * The refusal reads like a wrong password, so the platform host does not confirm clinic accounts.
 *
 * @param db Drizzle over the eyadex_auth pool
 * @param area the area of the instance creating the session
 * @returns the hook
 */
export function sessionAreaHook(db: PostgresJsDatabase, area: AuthArea) {
  return async (session: { userId: string }): Promise<void> => {
    const [user] = await db
      .select({ area: authUsers.area })
      .from(authUsers)
      .where(eq(authUsers.id, session.userId));
    if (user?.area !== area) {
      throw new APIError("UNAUTHORIZED", {
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      });
    }
  };
}
