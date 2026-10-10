import { meResponseSchema, type MeResponse } from "@eyadex/contracts/access";
import { NO_FEATURES, moduleSchema, type ClinicFeatures } from "@eyadex/contracts/clinics";
import type { SessionContext } from "@eyadex/contracts/session";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { areaOfHost } from "../area-host";
import {
  platformMeResponseSchema,
  type PlatformMeResponse,
} from "@eyadex/contracts/platform-console";
import { getSessionResponseSchema } from "./auth-schemas";
import type { HttpContext } from "./http-context";
import { notifyUnauthorized } from "./http-transport";

const notImplemented = () => Promise.reject(new ApiError("not_implemented"));

/** The persona comes from the session, never from a role name: clinic users are all "custom". */
export function contextFromMe(me: MeResponse): SessionContext {
  return {
    persona: { kind: "custom", clinicId: me.clinic.id, memberId: me.user.id },
    user: {
      fullName: me.user.fullName,
      email: me.user.email,
      preferredLanguage: me.user.preferredLanguage,
    },
    clinic: { ...me.clinic },
    permissions: [...me.permissions],
    allBranches: me.allBranches,
    branchIds: [...me.branchIds],
    features: Object.fromEntries(
      moduleSchema.options.map((module) => [module, me.modules.includes(module)]),
    ) as ClinicFeatures,
    // A /v1/me answer has passed the API's subscription guard on the server clock; a blocked clinic
    // gets subscription_blocked instead, so the device clock never decides access.
    blocked: null,
    // Story 30 (ADR-0020): the window is the platform setting, counted on the server clock.
    expiresInDays: me.expiresInDays,
  };
}

export function contextFromPlatformMe(account: PlatformMeResponse): SessionContext {
  return {
    persona: { kind: "platform_admin", clinicId: null, memberId: account.id },
    user: { fullName: account.fullName, email: account.email, preferredLanguage: null },
    clinic: null,
    permissions: [],
    allBranches: false,
    branchIds: [],
    features: { ...NO_FEATURES },
    blocked: null,
    expiresInDays: null,
  };
}

export function createHttpSession(ctx: HttpContext): ApiClient["session"] {
  return {
    listLoginClinics: notImplemented,
    listLoginAccounts: notImplemented,
    listLoginPlatformAccounts: notImplemented,
    acceptPlatformInvitation: notImplemented,

    // The persona argument is ignored: the cookie names the caller.
    async getContext() {
      const area = typeof window === "undefined" ? null : areaOfHost(window.location.hostname);
      if (area === "platform") {
        const session = await ctx.transport.send("GET", "/auth/get-session", {
          schema: getSessionResponseSchema,
        });
        if (session === null) {
          notifyUnauthorized();
          throw new ApiError("unauthorized");
        }
        // The gate (ADR-0020): a deactivated or unlinked account is refused here, not on its first page.
        return contextFromPlatformMe(
          await ctx.transport.send("GET", "/v1/platform/me", { schema: platformMeResponseSchema }),
        );
      }
      if (area === null) throw new ApiError("not_found");
      const me = await ctx.transport.send("GET", "/v1/me", { schema: meResponseSchema });
      ctx.clinicId = me.clinic.id;
      return contextFromMe(me);
    },
  };
}
