import { z } from "zod";
import { legacyNumber } from "./number-compat.ts";
import { legacyInteger } from "./integer-compat.ts";
import { roleListQuerySchema } from "./access.ts";
import { roleInputSchema } from "./roles.ts";
import { branchOptionSchema, roleOptionSchema } from "./users.ts";

/**
 * The role writes and the user editor's option reads (Phase B slice 8, ADR-0017). Every write
 * answers `RoleSummary` (`access.ts`), the same shape as `GET /v1/roles`.
 */

/** `POST /v1/roles` (with a required `Idempotency-Key`). */
export const createRoleRequestSchema = roleInputSchema.strict();
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;

/**
 * `PATCH /v1/roles/:id` replaces the whole editable role: the key rules (one scope per action, a
 * write needs its view) hold over the whole set, so a partial key list could not be checked.
 */
export const updateRoleRequestSchema = roleInputSchema.strict();
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>;

/** Query string of the option reads: the `GET /v1/roles` cursor shape. */
export const optionListQuerySchema = roleListQuerySchema;
export type OptionListQuery = z.infer<typeof optionListQuerySchema>;

/** `GET /v1/users/role-options`: every role of the clinic, inactive ones included. */
export const roleOptionListResponseSchema = z.object({
  items: z.array(roleOptionSchema),
  nextCursor: z.string().nullable(),
  total: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
});
export type RoleOptionListResponse = z.infer<typeof roleOptionListResponseSchema>;

/** `GET /v1/users/branch-options`: every branch of the clinic, inactive ones included. */
export const branchOptionListResponseSchema = z.object({
  items: z.array(branchOptionSchema),
  nextCursor: z.string().nullable(),
  total: legacyNumber().check(legacyInteger()).check(z.nonnegative()),
});
export type BranchOptionListResponse = z.infer<typeof branchOptionListResponseSchema>;
