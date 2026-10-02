import { z } from "zod";
import { idSchema, languageSchema, pageQuerySchema } from "./common";

const requiredName = z.string().trim().min(1, "validation.required").max(100, "validation.tooLong");
const optionalText = z.string().trim().max(300, "validation.tooLong");
const optionalPhone = z.string().trim().max(30, "validation.tooLong");

export const branchStatusSchema = z.enum(["active", "inactive"]);
export type BranchStatus = z.infer<typeof branchStatusSchema>;

export const branchSchema = z.object({
  id: idSchema,
  clinicId: idSchema,
  nameAr: requiredName,
  nameEn: requiredName,
  address: z.string().nullable(),
  phone: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
});
export type Branch = z.infer<typeof branchSchema>;

export const branchListQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().max(100),
  status: branchStatusSchema.nullable(),
});
export type BranchListQuery = z.infer<typeof branchListQuerySchema>;

export const branchInputSchema = z.object({
  nameAr: requiredName,
  nameEn: requiredName,
  address: optionalText,
  phone: optionalPhone,
});
export type BranchInput = z.infer<typeof branchInputSchema>;

export const branchUsageSchema = z.object({ active: z.number().int().nonnegative(), limit: z.number().int().positive() });
export type BranchUsage = z.infer<typeof branchUsageSchema>;

export const clinicAuditEntrySchema = z.object({
  id: idSchema,
  clinicId: idSchema,
  actorName: z.string(),
  action: z.string(),
  entity: z.literal("branch"),
  entityId: idSchema,
  before: branchSchema.nullable(),
  after: branchSchema.nullable(),
  createdAt: z.string().datetime(),
});
export type ClinicAuditEntry = z.infer<typeof clinicAuditEntrySchema>;

export const systemRoleKeySchema = z.enum(["clinic_admin", "doctor", "receptionist", "technician"]);
export type SystemRoleKey = z.infer<typeof systemRoleKeySchema>;

export const roleSchema = z.object({
  id: idSchema,
  clinicId: idSchema,
  systemKey: systemRoleKeySchema.nullable(),
  nameAr: z.string(),
  nameEn: z.string(),
  isLocked: z.boolean(),
  isActive: z.boolean(),
  permissions: z.array(z.string()),
});
export type Role = z.infer<typeof roleSchema>;

export const memberStatusSchema = z.enum(["active", "invited", "deactivated"]);
export type MemberStatus = z.infer<typeof memberStatusSchema>;

export const memberSchema = z.object({
  id: idSchema,
  clinicId: idSchema,
  userId: idSchema,
  fullName: z.string(),
  email: z.string().email(),
  roleId: idSchema,
  allBranches: z.boolean(),
  branchIds: z.array(idSchema),
  status: memberStatusSchema,
  preferredLanguage: languageSchema,
  createdAt: z.string().datetime(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberViewSchema = memberSchema.extend({
  roleNameAr: z.string(),
  roleNameEn: z.string(),
});
export type MemberView = z.infer<typeof memberViewSchema>;

export const invitationSchema = z.object({
  id: idSchema,
  clinicId: idSchema,
  memberId: idSchema,
  email: z.string().email(),
  status: z.enum(["pending", "accepted", "cancelled"]),
  sentAt: z.string().datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;
