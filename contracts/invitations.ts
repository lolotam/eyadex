import { z } from "zod";
import { idSchema, pageQuerySchema } from "./common";

/** OD-3: invitations are valid for 7 days. */
export const INVITATION_TTL_DAYS = 7;

/** Stored status. "expired" is never stored; it is computed from expiresAt. */
export const invitationStoredStatusSchema = z.enum(["pending", "accepted", "cancelled"]);
export type InvitationStoredStatus = z.infer<typeof invitationStoredStatusSchema>;

export const invitationStatusSchema = z.enum(["pending", "accepted", "cancelled", "expired"]);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const invitationRecordSchema = z.object({
  id: idSchema,
  clinicId: idSchema,
  email: z.string().email(),
  fullName: z.string(),
  roleId: idSchema,
  allBranches: z.boolean(),
  branchIds: z.array(idSchema),
  status: invitationStoredStatusSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  invitedBy: z.string(),
  respondedAt: z.string().datetime().nullable(),
  /** Hash of the current link token; the plain token is never stored on the record. */
  tokenHash: z.string(),
});
export type InvitationRecord = z.infer<typeof invitationRecordSchema>;

export const invitationSchema = invitationRecordSchema.omit({ tokenHash: true }).extend({
  status: invitationStatusSchema,
  roleNameAr: z.string(),
  roleNameEn: z.string(),
  /** Opaque token used in the invitation link. */
  token: z.string(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export function computeInvitationStatus(
  record: Pick<InvitationRecord, "status" | "expiresAt">,
  now: number = Date.now(),
): InvitationStatus {
  if (record.status === "pending" && new Date(record.expiresAt).getTime() <= now) return "expired";
  return record.status;
}

export const invitationListQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().max(100),
  status: invitationStatusSchema.nullable(),
});
export type InvitationListQuery = z.infer<typeof invitationListQuerySchema>;

export const invitationPreviewSchema = z.object({
  clinicNameAr: z.string(),
  clinicNameEn: z.string(),
  roleNameAr: z.string(),
  roleNameEn: z.string(),
  fullName: z.string(),
  email: z.string(),
  status: invitationStatusSchema,
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export const acceptInvitationInputSchema = z
  .object({
    password: z.string().min(8, "invite.validation.passwordShort").max(128, "validation.tooLong"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "invite.validation.passwordMismatch",
    path: ["confirmPassword"],
  });
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInputSchema>;

export const acceptedInvitationSchema = z.object({
  clinicId: idSchema,
  memberId: idSchema,
  roleKey: z.string().nullable(),
});
export type AcceptedInvitation = z.infer<typeof acceptedInvitationSchema>;
