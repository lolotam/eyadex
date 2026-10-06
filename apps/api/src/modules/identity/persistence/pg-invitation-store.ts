import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// Invitation SQL for slice 7 (ADR-0012), inside the caller's withTenant(clinicId) transaction.

export interface InvitationLock {
  readonly id: string;
  readonly email: string;
  readonly status: "pending" | "accepted" | "cancelled";
  readonly expiresAt: Date;
}

/** The invitation, row-locked; `null` = unknown here (another clinic's id included). */
export async function findInvitationForUpdate(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<InvitationLock | null> {
  const rows = await tx.execute<{
    id: string;
    email: string;
    status: InvitationLock["status"];
    expires_at: Date | string;
  }>(
    sql`SELECT id, email, status, expires_at FROM invitations
        WHERE clinic_id = ${clinicId} AND id = ${id} FOR UPDATE`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { id: row.id, email: row.email, status: row.status, expiresAt: new Date(row.expires_at) };
}

/** Holds the email for this invitation (0015); `false` = a platform account, member or live invitation has it. */
export async function reserveEmail(
  tx: Tx,
  email: string,
  invitationId: string,
  expiresAt: Date,
): Promise<boolean> {
  const rows = await tx.execute<{ ok: boolean }>(
    sql`SELECT reserve_invitation_email(${email}, ${invitationId},
          ${expiresAt.toISOString()}::timestamptz) AS ok`,
  );
  return rows[0]?.ok === true;
}

/** Moves this invitation's own hold to the new expiry; `false` = the hold lapsed and someone else took it. */
export async function renewEmail(
  tx: Tx,
  email: string,
  invitationId: string,
  expiresAt: Date,
): Promise<boolean> {
  const rows = await tx.execute<{ ok: boolean }>(
    sql`SELECT renew_invitation_email(${email}, ${invitationId},
          ${expiresAt.toISOString()}::timestamptz) AS ok`,
  );
  return rows[0]?.ok === true;
}

/** Frees this invitation's own hold; a hold already taken by another invitation is left alone. */
export async function releaseEmail(tx: Tx, email: string, invitationId: string): Promise<void> {
  await tx.execute(sql`SELECT release_invitation_email(${email}, ${invitationId})`);
}

export interface NewInvitation {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly roleId: string;
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
  readonly expiresAt: Date;
  readonly invitedBy: string;
  readonly tokenHash: string;
}

export async function insertInvitation(
  tx: Tx,
  clinicId: string,
  invitation: NewInvitation,
  newId: () => string,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`INSERT INTO invitations (clinic_id, id, email, full_name, role_id, all_branches, status,
          expires_at, invited_by_user_id, token_hash, created_at, responded_at)
        VALUES (${clinicId}, ${invitation.id}, ${invitation.email}, ${invitation.fullName},
          ${invitation.roleId}, ${invitation.allBranches}, 'pending',
          ${invitation.expiresAt.toISOString()}::timestamptz, ${invitation.invitedBy},
          ${invitation.tokenHash}, ${now.toISOString()}::timestamptz, NULL)`,
  );
  for (const branchId of invitation.allBranches ? [] : [...new Set(invitation.branchIds)]) {
    await tx.execute(
      sql`INSERT INTO invitation_branches (clinic_id, id, invitation_id, branch_id)
          VALUES (${clinicId}, ${newId()}, ${invitation.id}, ${branchId})`,
    );
  }
}

/** Resend: a new hash (the old link dies at once) and a new expiry. */
export async function rotateInvitation(
  tx: Tx,
  clinicId: string,
  id: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE invitations SET token_hash = ${tokenHash},
          expires_at = ${expiresAt.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
}

export async function cancelInvitation(
  tx: Tx,
  clinicId: string,
  id: string,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE invitations SET status = 'cancelled', responded_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
}

/** What the invitation email needs about the clinic. */
export async function readClinicForMail(
  tx: Tx,
  clinicId: string,
): Promise<{ nameAr: string; nameEn: string; language: "ar" | "en" }> {
  const rows = await tx.execute<{ name_ar: string; name_en: string; default_language: "ar" | "en" }>(
    sql`SELECT name_ar, name_en, default_language FROM clinics WHERE id = ${clinicId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error("clinic in context is not visible");
  return { nameAr: row.name_ar, nameEn: row.name_en, language: row.default_language };
}
