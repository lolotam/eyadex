import { meResponseSchema, type MeResponse } from "@eyadex/contracts/access";
import type { SessionContext } from "@eyadex/contracts/session";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { areaOfHost } from "../area-host";
import { getSessionResponseSchema, type GetSessionResponse } from "./auth-schemas";
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
    features: { patients: me.modules.includes("patients") },
    // A /v1/me answer has passed the API's subscription guard on the server clock; a blocked clinic
    // gets subscription_blocked instead, so the device clock never decides access.
    blocked: null,
    // TODO(spec): slice 11 brings the expiry alert window to the clinic side.
    expiresInDays: null,
  };
}

export function contextFromAuthSession(session: NonNullable<GetSessionResponse>): SessionContext {
  return {
    persona: { kind: "platform_admin", clinicId: null, memberId: null },
    user: { fullName: session.user.name, email: session.user.email, preferredLanguage: null },
    clinic: null,
    permissions: [],
    features: { patients: false },
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
        return contextFromAuthSession(session);
      }
      if (area === null) throw new ApiError("not_found");
      const me = await ctx.transport.send("GET", "/v1/me", { schema: meResponseSchema });
      ctx.clinicId = me.clinic.id;
      return contextFromMe(me);
    },
  };
}
