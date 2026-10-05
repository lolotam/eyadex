import type { Database, Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** دعوة pending ومش منتهية، مقفولة `FOR UPDATE` جوه transaction العيادة. */
export interface PendingInvitation {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly roleId: string;
  readonly allBranches: boolean;
  readonly expiresAt: Date;
}

/** اللي القبول محتاجه من العيادة: الاشتراك، اللغة، والاسمين. */
export interface InvitationClinic {
  readonly status: "trial" | "active" | "suspended";
  readonly expiresAt: Date;
  readonly defaultLanguage: "ar" | "en";
  readonly nameAr: string;
  readonly nameEn: string;
}

/**
 * العيادة صاحبة الـ hash، قبل ما يكون في عيادة معروفة: المسار الوحيد المسموح من غير سياق (0014).
 *
 * @param db الـ pool على `eyadex_app`
 * @param tokenHash الـ SHA-256 بتاع الرمز
 * @returns الـ id أو `null` (مستخدمة، منتهية، ملغية، أو مش موجودة — كلهم واحد)
 */
export async function clinicForToken(db: Database, tokenHash: string): Promise<string | null> {
  return db.withNoTenant(async (tx) => {
    const rows = await tx.execute<{ clinic_id: string | null }>(
      sql`SELECT invitation_clinic_for_token(${tokenHash}) AS clinic_id`,
    );
    return rows[0]?.clinic_id ?? null;
  });
}

/**
 * بيقفل الدعوة لو لسه pending ومش منتهية. طلب قبول متوازي بيستنى هنا، وبعد الـ commit بيلاقي
 * الحالة `accepted` فبيرجع `null` (INV-01).
 *
 * @param tx transaction العيادة
 * @param tokenHash الـ hash
 * @param lock `FOR UPDATE` للقبول؛ القراءة بس (inspect) من غير قفل
 * @returns الدعوة أو `null`
 */
export async function pendingInvitation(
  tx: Tx,
  tokenHash: string,
  lock: boolean,
): Promise<PendingInvitation | null> {
  const rows = await tx.execute<{
    id: string;
    email: string;
    full_name: string;
    role_id: string;
    all_branches: boolean;
    expires_at: string;
  }>(
    lock
      ? sql`SELECT id, email, full_name, role_id, all_branches, expires_at FROM invitations
            WHERE token_hash = ${tokenHash} AND status = 'pending' AND expires_at > now()
            FOR UPDATE`
      : sql`SELECT id, email, full_name, role_id, all_branches, expires_at FROM invitations
            WHERE token_hash = ${tokenHash} AND status = 'pending' AND expires_at > now()`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    roleId: row.role_id,
    allBranches: row.all_branches,
    expiresAt: new Date(row.expires_at),
  };
}

/**
 * العيادة الحالية (RLS بيوري العيادة بتاعة السياق بس).
 *
 * @param tx transaction العيادة
 * @param clinicId الـ id
 * @returns العيادة أو `null`
 */
export async function invitationClinic(tx: Tx, clinicId: string): Promise<InvitationClinic | null> {
  const rows = await tx.execute<{
    status: InvitationClinic["status"];
    expires_at: string;
    default_language: InvitationClinic["defaultLanguage"];
    name_ar: string;
    name_en: string;
  }>(
    sql`SELECT status, expires_at, default_language, name_ar, name_en FROM clinics
        WHERE id = ${clinicId}`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    status: row.status,
    expiresAt: new Date(row.expires_at),
    defaultLanguage: row.default_language,
    nameAr: row.name_ar,
    nameEn: row.name_en,
  };
}

/**
 * الفروع اللي الدعوة بتديها، والدور والفروع لسه نشطين؟
 *
 * @param tx transaction العيادة
 * @param invitation الدعوة
 * @returns الفروع، و`usable: false` لو الدور أو أي فرع اتعطّل
 */
export async function invitationGrants(
  tx: Tx,
  invitation: PendingInvitation,
): Promise<{ usable: boolean; branchIds: string[] }> {
  const role = await tx.execute<{ is_active: boolean }>(
    sql`SELECT is_active FROM roles WHERE id = ${invitation.roleId}`,
  );
  const branches = await tx.execute<{ branch_id: string; is_active: boolean }>(
    sql`SELECT ib.branch_id, b.is_active FROM invitation_branches ib
        JOIN branches b ON b.clinic_id = ib.clinic_id AND b.id = ib.branch_id
        WHERE ib.invitation_id = ${invitation.id}`,
  );
  const usable = role[0]?.is_active === true && branches.every((branch) => branch.is_active);
  return { usable, branchIds: branches.map((branch) => branch.branch_id) };
}
