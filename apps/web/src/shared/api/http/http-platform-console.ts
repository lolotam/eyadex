import {
  platformAccountResponseSchema,
  platformOverviewResponseSchema,
  platformSettingsResponseSchema,
  platformTeamListResponseSchema,
} from "@eyadex/contracts/platform-console";
import type { PlatformAccount } from "@eyadex/contracts/platform";
import type { ApiClient } from "../api-client";
import type { HttpContext } from "./http-context";
import { collectPages } from "./http-transport";

/** Stories 3–4 (ADR-0020): counts by effective status and the clinics expiring soon. */
export function createHttpPlatformOverview(ctx: HttpContext): ApiClient["platformOverview"] {
  return {
    get: () =>
      ctx.transport.send("GET", "/v1/platform/overview", {
        schema: platformOverviewResponseSchema,
      }),
  };
}

/** Story 26 (ADR-0020). */
export function createHttpPlatformSettings(ctx: HttpContext): ApiClient["platformSettings"] {
  const { transport } = ctx;
  return {
    get: () =>
      transport.send("GET", "/v1/platform/settings", { schema: platformSettingsResponseSchema }),
    update: (_persona, input) =>
      transport.send("PUT", "/v1/platform/settings", {
        schema: platformSettingsResponseSchema,
        body: {
          defaultTrialDays: input.defaultTrialDays,
          alertDaysBeforeExpiry: input.alertDaysBeforeExpiry,
          emailSenderName: input.emailSenderName,
        },
      }),
  };
}

const teamPath = (id: string, action: "deactivate" | "reactivate") =>
  `/v1/platform/team/${encodeURIComponent(id)}/${action}`;

/**
 * Stories 24–25 (ADR-0020). The invitation link is emailed by the worker and never comes back.
 */
export function createHttpPlatformTeam(ctx: HttpContext): ApiClient["platformTeam"] {
  const { transport } = ctx;
  const change = (id: string, action: "deactivate" | "reactivate"): Promise<PlatformAccount> =>
    transport.send("POST", teamPath(id, action), { schema: platformAccountResponseSchema });
  return {
    list: () =>
      collectPages((cursor) =>
        transport.send("GET", "/v1/platform/team", {
          schema: platformTeamListResponseSchema,
          query: { cursor, limit: 100 },
        }),
      ),
    invite: (_persona, input, idempotencyKey) =>
      transport.send("POST", "/v1/platform/team", {
        schema: platformAccountResponseSchema,
        body: { fullName: input.fullName, email: input.email },
        idempotencyKey,
      }),
    deactivate: (_persona, id) => change(id, "deactivate"),
    reactivate: (_persona, id) => change(id, "reactivate"),
  };
}
