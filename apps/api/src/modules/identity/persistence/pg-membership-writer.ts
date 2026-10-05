import type { Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { sql } from "drizzle-orm";

import type { PendingInvitation } from "./pg-invitation-acceptance.ts";

/** اللي بيتكتب لما الدعوة تتقبل. */
export interface AcceptedMembership {
  readonly clinicId: string;
  readonly userId: string;
  readonly invitation: PendingInvitation;
  readonly branchIds: readonly string[];
  readonly language: "ar" | "en";
  readonly now: Date;
}

/**
 * العضوية + فروعها + الدعوة `accepted` + تحويل حجز الإيميل + سطر audit، في transaction العيادة.
 * لو الحجز ماتحوّلش (منتهي أو مش بتاع الدعوة دي) بيرجّع `false` واللي بينادي بيرجّع الـ transaction.
 *
 * @param tx transaction العيادة (مقفول فيها صف الدعوة)
 * @param ids مولّد الـ ids
 * @param input العضوية
 * @returns `true` لو كله اتكتب
 */
export async function writeAcceptedMembership(
  tx: Tx,
  ids: IdGenerator,
  input: AcceptedMembership,
): Promise<boolean> {
  const { clinicId, invitation } = input;
  const at = input.now.toISOString();
  // The hold first: the membership trigger (0017) only admits an email held as a membership.
  const converted = await tx.execute<{ ok: boolean }>(
    sql`SELECT convert_invitation_email_to_membership(${invitation.email}, ${invitation.id}) AS ok`,
  );
  if (converted[0]?.ok !== true) return false;
  const membershipId = ids.newId();
  await tx.execute(
    sql`INSERT INTO memberships (clinic_id, id, user_id, full_name, email, role_id, all_branches,
          status, preferred_language, last_login_at, created_at, updated_at)
        VALUES (${clinicId}, ${membershipId}, ${input.userId}, ${invitation.fullName},
          ${invitation.email}, ${invitation.roleId}, ${invitation.allBranches}, 'active',
          ${input.language}, NULL, ${at}::timestamptz, ${at}::timestamptz)`,
  );
  if (!invitation.allBranches) {
    for (const branchId of input.branchIds) {
      await tx.execute(
        sql`INSERT INTO membership_branches (clinic_id, id, membership_id, branch_id, created_at)
            VALUES (${clinicId}, ${ids.newId()}, ${membershipId}, ${branchId}, ${at}::timestamptz)`,
      );
    }
  }
  await tx.execute(
    sql`UPDATE invitations SET status = 'accepted', responded_at = ${at}::timestamptz
        WHERE id = ${invitation.id}`,
  );
  // Allowlist (PRD §4.11): no token, no hash, no password.
  const details = {
    after: {
      invitationId: invitation.id,
      email: invitation.email,
      fullName: invitation.fullName,
      roleId: invitation.roleId,
      allBranches: invitation.allBranches,
      branchIds: invitation.allBranches ? [] : input.branchIds,
    },
  };
  await tx.execute(
    sql`INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category, entity_type,
          entity_id, branch_id, details, created_at)
        VALUES (${clinicId}, ${ids.newId()}, ${input.userId}, 'invitation.accepted',
          'administrative', 'membership', ${membershipId}, NULL,
          ${JSON.stringify(details)}::jsonb, ${at}::timestamptz)`,
  );
  return true;
}
