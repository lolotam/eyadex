import { z } from "zod";
import { idSchema } from "./common.ts";
import { invitationSchema } from "./invitations.ts";
import { membershipUserStatusSchema, membershipUserViewSchema } from "./users.ts";

/**
 * The users and invitations HTTP API (Phase B slice 7, ADR-0012). `users.ts` and `invitations.ts`
 * keep the shapes the web mock shares; these are the query strings and list bodies of `/v1/users`
 * and `/v1/invitations`.
 */

const cursor = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .optional();
const limit = z.coerce.number().int().min(1).max(100).default(50);
const search = z.string().trim().min(1).max(100).optional();

export const userListHttpQuerySchema = z
  .object({
    cursor,
    limit,
    search,
    roleId: idSchema.optional(),
    branchId: idSchema.optional(),
    status: membershipUserStatusSchema.optional(),
  })
  .strict();
export type UserListHttpQuery = z.infer<typeof userListHttpQuerySchema>;

export const userListResponseSchema = z.object({
  items: z.array(membershipUserViewSchema),
  nextCursor: z.string().nullable(),
  /** Every member matching the filters, counted on its own statement. */
  total: z.number().int().nonnegative(),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

/** No status = pending and expired, the invitations an admin can still act on. */
export const invitationListHttpQuerySchema = z
  .object({
    cursor,
    limit,
    search,
    status: z.enum(["pending", "expired", "accepted", "cancelled"]).optional(),
  })
  .strict();
export type InvitationListHttpQuery = z.infer<typeof invitationListHttpQuerySchema>;

export const invitationListResponseSchema = z.object({
  items: z.array(invitationSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type InvitationListResponse = z.infer<typeof invitationListResponseSchema>;

/** Story 34 + ADR-0012: deactivating a branch some members rely on alone needs an explicit yes. */
export const deactivateBranchRequestSchema = z
  .object({ confirmStrandedMembers: z.boolean().optional() })
  .strict();
export type DeactivateBranchRequest = z.infer<typeof deactivateBranchRequestSchema>;

/** `details` of `branch_has_exclusive_members` (409). */
export const strandedMembersDetailsSchema = z.object({
  count: z.number().int().positive(),
  members: z.array(z.object({ id: idSchema, fullName: z.string() })),
});
export type StrandedMembersDetails = z.infer<typeof strandedMembersDetailsSchema>;

/**
 * `GET /v1/users/usage` (ADR-0016): `used` = active members + live pending invitations, the same
 * rule as the limit check and the platform `usage.users`.
 */
export const userUsageResponseSchema = z
  .object({ used: z.number().int().nonnegative(), limit: z.number().int().positive() })
  .strict();
export type UserUsageResponse = z.infer<typeof userUsageResponseSchema>;
