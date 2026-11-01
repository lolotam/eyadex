import { z } from "zod";
import { utcDatetime } from "./datetime-compat.ts";
import { idSchema, pageQuerySchema } from "./common.ts";

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
  expiresAt: utcDatetime(),
  createdAt: utcDatetime(),
  invitedBy: z.string(),
  respondedAt: utcDatetime().nullable(),
  /** Hash of the current link token; the plain token is never stored on the record. */
  tokenHash: z.string(),
});
export type InvitationRecord = z.infer<typeof invitationRecordSchema>;

export const invitationSchema = invitationRecordSchema.omit({ tokenHash: true }).extend({
  status: invitationStatusSchema,
  roleNameAr: z.string(),
  roleNameEn: z.string(),
  /** Always null: the only response that carries a token is `InvitationLink` (copy link). */
  token: z.string().nullable(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/** `POST /v1/invitations/:id/link`: a fresh link token, returned once (ADR-0012 §6). */
export const invitationLinkSchema = z.object({
  token: z.string().min(1),
  expiresAt: utcDatetime(),
});
export type InvitationLink = z.infer<typeof invitationLinkSchema>;

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
  /** null = the API's inspect answer does not name the role. */
  roleNameAr: z.string().nullable(),
  roleNameEn: z.string().nullable(),
  fullName: z.string(),
  email: z.string(),
  status: invitationStatusSchema,
  /** Who invites: a clinic (absent) or the platform team (ADR-0020), so the page picks its copy. */
  area: z.enum(["clinic", "platform"]).optional(),
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
  /** null = a platform-team invitation (ADR-0020): no clinic. */
  clinicId: idSchema.nullable(),
  /** null = no session is opened; the person signs in with email and password (ADR-0008). */
  memberId: idSchema.nullable(),
  roleKey: z.string().nullable(),
});
export type AcceptedInvitation = z.infer<typeof acceptedInvitationSchema>;
