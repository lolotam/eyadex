import {
  patientBranchActionSchema,
  patientDetailSchema,
  patientWriteResultSchema,
  type PatientInput,
  type PatientListQuery,
} from "@eyadex/contracts/patients";
import {
  patientBranchOptionListSchema,
  patientListResponseSchema,
  type PatientSearchRequest,
} from "@eyadex/contracts/patients-api";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import type { HttpContext } from "./http-context";

const path = (id: string) => `/v1/patients/${encodeURIComponent(id)}`;

/**
 * The list query goes in the POST body, never the URL: its search term can be a civil ID or a phone
 * (ADR-0018). Only the declared fields are sent.
 */
export function toSearchRequest(query: PatientListQuery): PatientSearchRequest {
  return {
    cursor: query.cursor,
    limit: query.limit,
    q: query.q.trim(),
    branchId: query.branchId,
    status: query.status,
  };
}

/** The form's fields, and nothing else the caller's object may carry. */
export function toPatientBody(input: PatientInput): PatientInput {
  return {
    fullName: input.fullName,
    phone: input.phone,
    birthDate: input.birthDate,
    gender: input.gender,
    registrationBranchId: input.registrationBranchId,
    civilId: input.civilId,
  };
}

export function createHttpPatients(ctx: HttpContext): ApiClient["patients"] {
  const { transport } = ctx;
  return {
    async list(_persona, query) {
      const page = await transport.send("POST", "/v1/patients/search", {
        schema: patientListResponseSchema,
        body: toSearchRequest(query),
      });
      return { items: page.items, nextCursor: page.nextCursor, total: page.total };
    },
    async branchOptions(_persona, action) {
      // Validated here so nothing but the three route names can ever reach the URL.
      const parsed = patientBranchActionSchema.safeParse(action);
      if (!parsed.success) throw new ApiError("validation");
      return transport.send("GET", `/v1/patients/branch-options/${parsed.data}`, {
        schema: patientBranchOptionListSchema,
      });
    },
    open: (_persona, patientId) =>
      transport.send("GET", path(patientId), { schema: patientDetailSchema }),
    create: (_persona, input, idempotencyKey) =>
      transport.send("POST", "/v1/patients", {
        schema: patientWriteResultSchema,
        body: toPatientBody(input),
        idempotencyKey,
      }),
    update: (_persona, patientId, input) =>
      transport.send("PUT", path(patientId), {
        schema: patientWriteResultSchema,
        body: toPatientBody(input),
      }),
    archive: (_persona, patientId) =>
      transport.send("POST", `${path(patientId)}/archive`, { schema: patientWriteResultSchema }),
    restore: (_persona, patientId) =>
      transport.send("POST", `${path(patientId)}/restore`, { schema: patientWriteResultSchema }),
  };
}
