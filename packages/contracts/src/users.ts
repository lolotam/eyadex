import { z } from "zod";
import { idSchema, languageSchema, pageQuerySchema } from "./common";

export const membershipUserStatusSchema = z.enum(["active", "deactivated"]);
export type MembershipUserStatus = z.infer<typeof membershipUserStatusSchema>;

export const membershipUserSchema = z.object({
  id: idSchema,
  userId: idSchema,
  clinicId: idSchema,
  fullName: z.string(),
  email: z.string().email(),
  roleId: idSchema,
  allBranches: z.boolean(),
  branchIds: z.array(idSchema),
  status: membershipUserStatusSchema,
  preferredLanguage: languageSchema,
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type MembershipUser = z.infer<typeof membershipUserSchema>;

export const membershipUserViewSchema = membershipUserSchema.extend({
  roleNameAr: z.string(),
  roleNameEn: z.string(),
});
export type MembershipUserView = z.infer<typeof membershipUserViewSchema>;

export const userListQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().max(100),
  roleId: idSchema.nullable(),
  branchId: idSchema.nullable(),
  status: membershipUserStatusSchema.nullable(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** "All branches" or at least one branch. Messages are i18n keys. */
const branchAccessShape = {
  allBranches: z.boolean(),
  branchIds: z.array(idSchema),
};
function hasBranchAccess(value: { allBranches: boolean; branchIds: string[] }) {
  return value.allBranches || value.branchIds.length > 0;
}
const branchAccessIssue = { message: "users.validation.branchesRequired", path: ["branchIds"] };

export const changeBranchesInputSchema = z
  .object(branchAccessShape)
  .refine(hasBranchAccess, branchAccessIssue);
export type ChangeBranchesInput = z.infer<typeof changeBranchesInputSchema>;

export const changeRoleInputSchema = z.object({ roleId: idSchema });
export type ChangeRoleInput = z.infer<typeof changeRoleInputSchema>;

export const inviteUserInputSchema = z
  .object({
    fullName: z.string().trim().min(2, "validation.tooShort").max(100, "validation.tooLong"),
    email: z.string().trim().toLowerCase().email("validation.email").max(255, "validation.tooLong"),
    roleId: z.string().uuid("validation.required"),
    ...branchAccessShape,
  })
  .refine(hasBranchAccess, branchAccessIssue);
export type InviteUserInput = z.infer<typeof inviteUserInputSchema>;

export const userUsageSchema = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type UserUsage = z.infer<typeof userUsageSchema>;

export const roleOptionSchema = z.object({
  id: idSchema,
  nameAr: z.string(),
  nameEn: z.string(),
  isActive: z.boolean(),
});
export type RoleOption = z.infer<typeof roleOptionSchema>;

export const branchOptionSchema = roleOptionSchema;
export type BranchOption = z.infer<typeof branchOptionSchema>;

export const loginAccountSchema = z.object({
  memberId: idSchema,
  fullName: z.string(),
  roleKey: z.string().nullable(),
  roleNameAr: z.string(),
  roleNameEn: z.string(),
  status: membershipUserStatusSchema,
});
export type LoginAccount = z.infer<typeof loginAccountSchema>;

/** Demo sign-in: a platform team account to pin the platform persona to. */
export const platformLoginAccountSchema = z.object({
  memberId: z.string(),
  fullName: z.string(),
  status: z.enum(["active", "invited", "deactivated"]),
});
export type PlatformLoginAccount = z.infer<typeof platformLoginAccountSchema>;

/** Story 64: the signed-in account's own profile. */
export const accountProfileInputSchema = z.object({
  fullName: z.string().trim().min(2, "validation.tooShort").max(100, "validation.tooLong"),
  preferredLanguage: languageSchema,
});
export type AccountProfileInput = z.infer<typeof accountProfileInputSchema>;

export const accountProfileSchema = accountProfileInputSchema.extend({
  email: z.string(),
  roleNameAr: z.string(),
  roleNameEn: z.string(),
});
export type AccountProfile = z.infer<typeof accountProfileSchema>;
