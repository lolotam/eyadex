import { z } from "zod";
import { idSchema } from "./common.ts";
import {
  patientBranchOptionSchema,
  patientListItemSchema,
  patientStatusSchema,
  stripInvisibleControls,
} from "./patients.ts";

/**
 * The patients HTTP API (Phase B slice 9, ADR-0018). `patients.ts` keeps the shapes the web mock
 * shares; these are the request and list bodies of `/v1/patients`.
 */

/**
 * The list query travels in a POST body, never a query string: its search term can be a civil ID or a
 * phone, and URLs end up in proxy and access logs. The cursor is opaque to the client.
 */
export const patientSearchRequestSchema = z
  .object({
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .nullable(),
    limit: z.number().int().min(1).max(100),
    q: z.string().transform(stripInvisibleControls).pipe(z.string().trim().max(100)),
    branchId: idSchema.nullable(),
    status: patientStatusSchema.nullable(),
  })
  .strict();
export type PatientSearchRequest = z.infer<typeof patientSearchRequestSchema>;

export const patientListResponseSchema = z.object({
  items: z.array(patientListItemSchema),
  nextCursor: z.string().nullable(),
  /** Every file matching the filters inside the caller's scope, counted on its own statement. */
  total: z.number().int().nonnegative(),
});
export type PatientListResponse = z.infer<typeof patientListResponseSchema>;

export const patientBranchOptionListSchema = z.array(patientBranchOptionSchema);
export type PatientBranchOptionList = z.infer<typeof patientBranchOptionListSchema>;
