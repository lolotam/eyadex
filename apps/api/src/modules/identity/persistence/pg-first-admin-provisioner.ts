import { createHash, randomBytes } from "node:crypto";

import type { Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { sql } from "drizzle-orm";

import type {
  FirstAdminProvisioner,
  FirstAdminRequest,
  FirstAdminResult,
} from "../../tenancy/index.ts";
import { invitationExpiry, SYSTEM_ROLES } from "../domain/system-roles.ts";

/**
 * بيعمل رمز دعوة عشوائي (32 بايت) والـ hash بتاعه. الـ hash بس بيتخزن (CLAUDE.md §8)، وهو نفس
 * اللي `invitation_clinic_for_token` بيدوّر بيه.
 *
 * @returns الرمز والـ SHA-256 hex بتاعه
 */
export function issueInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInvitationToken(token) };
}

/**
 * الـ hash بتاع رمز دعوة.
 *
 * @param token الرمز
 * @returns SHA-256 hex
 */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** تنفيذ `identity` لـ port بتاع `tenancy`: الأدوار، الإيميل، والدعوة جوه transaction العيادة. */
export class PgFirstAdminProvisioner implements FirstAdminProvisioner {
  constructor(private readonly ids: IdGenerator) {}

  async provision(tx: Tx, request: FirstAdminRequest): Promise<FirstAdminResult> {
    const { clinicId, now } = request;
    const at = now.toISOString();
    const rows = await tx.execute<{ id: string; key: string }>(sql`SELECT id, key FROM permissions`);
    const catalogue = new Map(rows.map((row) => [row.key, row.id]));
    let adminRoleId: string | undefined;
    for (const role of SYSTEM_ROLES) {
      const roleId = this.ids.newId();
      if (role.key === "clinic_admin") adminRoleId = roleId;
      await tx.execute(
        sql`INSERT INTO roles (clinic_id, id, system_key, name_ar, name_en, is_locked, is_active,
              created_at, updated_at)
            VALUES (${clinicId}, ${roleId}, ${role.key}, ${role.nameAr}, ${role.nameEn},
              ${role.isLocked}, true, ${at}::timestamptz, ${at}::timestamptz)`,
      );
      for (const key of role.permissions) {
        const permissionId = catalogue.get(key);
        // The catalogue is seeded by db/sql/0026; a missing key is a broken database, not input.
        if (permissionId === undefined) throw new Error(`permission catalogue is missing ${key}`);
        await tx.execute(
          sql`INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
              VALUES (${clinicId}, ${this.ids.newId()}, ${roleId}, ${permissionId}, ${at}::timestamptz)`,
        );
      }
    }
    const invitationId = this.ids.newId();
    const expiresAt = invitationExpiry(now);
    const held = await tx.execute<{ ok: boolean }>(
      sql`SELECT reserve_invitation_email(${request.email}, ${invitationId},
            ${expiresAt.toISOString()}::timestamptz) AS ok`,
    );
    if (held[0]?.ok !== true) return { kind: "email_taken" };
    const { token, hash } = issueInvitationToken();
    await tx.execute(
      sql`INSERT INTO invitations (clinic_id, id, email, full_name, role_id, all_branches, status,
            expires_at, invited_by_user_id, token_hash, created_at, responded_at)
          VALUES (${clinicId}, ${invitationId}, ${request.email}, ${request.fullName}, ${adminRoleId!},
            true, 'pending', ${expiresAt.toISOString()}::timestamptz, ${request.actorUserId},
            ${hash}, ${at}::timestamptz, NULL)`,
    );
    return { kind: "invited", invitationId, expiresAt, token };
  }
}
