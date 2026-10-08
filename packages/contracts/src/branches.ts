import { z } from "zod";
import { idSchema } from "./common.ts";

/**
 * The branch HTTP API (Phase B slice 6, ADR-0011). `organization.ts` keeps the web mock's shapes;
 * these are the request and response bodies of `/v1/branches`.
 */

const name = z.string().trim().min(1).max(100);
// Empty after trimming means "no value": stored as NULL, never as "".
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === null || value === "" ? null : value));

export const branchAddressSchema = optional(300);
export const branchPhoneSchema = optional(30);

export const createBranchRequestSchema = z
  .object({
    nameAr: name,
    nameEn: name,
    address: branchAddressSchema.optional(),
    phone: branchPhoneSchema.optional(),
  })
  .strict();
export type CreateBranchRequest = z.infer<typeof createBranchRequestSchema>;

/** PATCH: any subset of the editable fields, at least one. Status changes have their own routes. */
export const updateBranchRequestSchema = z
  .object({
    nameAr: name.optional(),
    nameEn: name.optional(),
    address: branchAddressSchema.optional(),
    phone: branchPhoneSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "empty" });
export type UpdateBranchRequest = z.infer<typeof updateBranchRequestSchema>;

export const branchListQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: z.enum(["active", "inactive"]).optional(),
    search: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export type BranchListQuery = z.infer<typeof branchListQuerySchema>;

export const branchDetailSchema = z.object({
  id: idSchema,
  nameAr: z.string(),
  nameEn: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  isActive: z.boolean(),
  /** Active members limited to branches whose only active branch is this one (ADR-0012). */
  exclusiveMemberCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BranchDetail = z.infer<typeof branchDetailSchema>;

export const branchListResponseSchema = z.object({
  items: z.array(branchDetailSchema),
  nextCursor: z.string().nullable(),
  /** Every branch matching the filters, counted on its own statement (not off the page). */
  total: z.number().int().nonnegative(),
});
export type BranchListResponse = z.infer<typeof branchListResponseSchema>;

/** `GET /v1/branches/usage` (ADR-0016): active branches against the clinic's limit. */
export const branchUsageResponseSchema = z
  .object({ active: z.number().int().nonnegative(), limit: z.number().int().positive() })
  .strict();
export type BranchUsageResponse = z.infer<typeof branchUsageResponseSchema>;
