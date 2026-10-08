import {
  accountResponseSchema,
  clinicSettingsResponseSchema,
} from "@eyadex/contracts/settings-http";
import type { ApiClient } from "../api-client";
import { createAuthClient } from "./auth-client";
import type { HttpContext } from "./http-context";

/** Story 55 (ADR-0020): the clinic's own settings. The body names exactly the editable fields. */
export function createHttpClinicSettings(ctx: HttpContext): ApiClient["clinicSettings"] {
  const { transport } = ctx;
  return {
    get: () =>
      transport.send("GET", "/v1/clinic/settings", { schema: clinicSettingsResponseSchema }),
    update: (_persona, input) =>
      transport.send("PUT", "/v1/clinic/settings", {
        schema: clinicSettingsResponseSchema,
        body: {
          nameAr: input.nameAr,
          nameEn: input.nameEn,
          defaultLanguage: input.defaultLanguage,
          timezone: input.timezone,
        },
      }),
  };
}

/**
 * Story 64 (ADR-0020): the signed-in member's own profile; the password goes to Better Auth's own
 * route (never hand-written), which also ends the account's other sessions.
 */
export function createHttpAccount(ctx: HttpContext): ApiClient["account"] {
  const { transport } = ctx;
  const auth = createAuthClient(transport);
  return {
    get: () => transport.send("GET", "/v1/account", { schema: accountResponseSchema }),
    update: (_persona, input) =>
      transport.send("PUT", "/v1/account", {
        schema: accountResponseSchema,
        body: { fullName: input.fullName, preferredLanguage: input.preferredLanguage },
      }),
    changePassword: (_persona, input) =>
      auth.changePassword(input.currentPassword, input.newPassword),
  };
}
