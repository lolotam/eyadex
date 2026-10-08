import type { ClinicAuditListQuery, PlatformAuditListQuery } from "@eyadex/contracts/audit";
import {
  clinicAuditListResponseSchema,
  platformAuditClinicOptionsResponseSchema,
  platformAuditListResponseSchema,
} from "@eyadex/contracts/audit-http";
import type { ApiClient } from "../api-client";
import type { HttpContext } from "./http-context";

/** The filters both lists share; empty and null values are left out of the query string. */
function sharedQuery(query: ClinicAuditListQuery | PlatformAuditListQuery) {
  return {
    cursor: query.cursor,
    limit: query.limit,
    actor: query.actor.trim(),
    action: query.action,
    from: query.from,
    to: query.to,
  };
}

export const clinicAuditQuery = (query: ClinicAuditListQuery) => ({
  ...sharedQuery(query),
  entity: query.entity,
  category: query.category,
});

export const platformAuditQuery = (query: PlatformAuditListQuery) => ({
  ...sharedQuery(query),
  entity: query.entity,
  source: query.source,
  clinicId: query.clinicId,
});

/** Slice 10 (ADR-0019): both audit lists and the platform's clinic filter. */
export function createHttpAudit(ctx: HttpContext): ApiClient["audit"] {
  const { transport } = ctx;
  return {
    clinicList: (_persona, query) =>
      transport.send("GET", "/v1/clinic/audit", {
        schema: clinicAuditListResponseSchema,
        query: clinicAuditQuery(query),
      }),
    platformList: (_persona, query) =>
      transport.send("GET", "/v1/platform/audit", {
        schema: platformAuditListResponseSchema,
        query: platformAuditQuery(query),
      }),
    platformClinicOptions: () =>
      transport.send("GET", "/v1/platform/audit/clinics", {
        schema: platformAuditClinicOptionsResponseSchema,
      }),
  };
}
