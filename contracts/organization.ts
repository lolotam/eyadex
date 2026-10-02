import { z } from "zod";
import { idSchema, languageSchema } from "./common";

export const branchSchema = z.object({
  id: idSchema,
  clinicId: idSchema,
  nameAr: z.string(),
  nameEn: z.string(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
});
export type Branch = z.infer<typeof branchSchema>;

export const systemRoleKeySchema = z.enum(["clinic_admin", "doctor", "cashier", "technician"]);
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
