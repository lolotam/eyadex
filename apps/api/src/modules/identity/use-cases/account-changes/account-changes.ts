import type { AccountRequest, AccountResponse } from "@eyadex/contracts/settings-http";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { sql } from "drizzle-orm";

import { scrubAuditName } from "../../../../shared/audit-name-scrub.ts";
import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import type { Clock } from "../../../tenancy/index.ts";

/** اللي "حسابي" محتاجه: pool العيادة، الوقت، والـ ids. */
export interface AccountChangesDeps {
  /** الـ pool على `eyadex_app`. */
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** صاحب الحساب: من سياق الجلسة بس، مش من الطلب. */
export interface AccountOwner {
  readonly clinicId: string;
  readonly userId: string;
  readonly membershipId: string;
}

interface AccountRow {
  full_name: string;
  email: string;
  preferred_language: "ar" | "en";
  role_name_ar: string;
  role_name_en: string;
}

const toView = (row: AccountRow): AccountResponse => ({
  fullName: row.full_name,
  email: row.email,
  preferredLanguage: row.preferred_language,
  roleNameAr: row.role_name_ar,
  roleNameEn: row.role_name_en,
});

async function readRow(tx: Tx, owner: AccountOwner, lock: boolean): Promise<AccountResponse> {
  const rows = await tx.execute<AccountRow>(
    lock
      ? sql`SELECT m.full_name, m.email, m.preferred_language,
              r.name_ar AS role_name_ar, r.name_en AS role_name_en
            FROM memberships m JOIN roles r ON r.clinic_id = m.clinic_id AND r.id = m.role_id
            WHERE m.clinic_id = ${owner.clinicId} AND m.id = ${owner.membershipId}
              AND m.user_id = ${owner.userId}
            FOR UPDATE OF m`
      : sql`SELECT m.full_name, m.email, m.preferred_language,
              r.name_ar AS role_name_ar, r.name_en AS role_name_en
            FROM memberships m JOIN roles r ON r.clinic_id = m.clinic_id AND r.id = m.role_id
            WHERE m.clinic_id = ${owner.clinicId} AND m.id = ${owner.membershipId}
              AND m.user_id = ${owner.userId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new ApiError("not_found");
  return toView(row);
}

// PRD §4.11: an allowlist; the name is text a person typed.
const snapshot = (v: AccountResponse) => ({
  fullName: scrubAuditName(v.fullName),
  preferredLanguage: v.preferredLanguage,
});

/**
 * "حسابي" (story 64، ADR-0020): العضو بيغيّر اسمه ولغة واجهته في عضويته هو بس. الإيميل والدور
 * للعرض. كلمة المرور من Better Auth (`/auth/change-password`)، مش من هنا.
 */
export class AccountChanges {
  constructor(private readonly deps: AccountChangesDeps) {}

  /**
   * الحساب الحالي.
   *
   * @param owner صاحب الجلسة
   * @returns الاسم واللغة والإيميل والدور
   */
  read(owner: AccountOwner): Promise<AccountResponse> {
    return this.deps.db.withTenant(owner.clinicId, (tx) => readRow(tx, owner, false));
  }

  /**
   * يحفظ الاسم واللغة ويكتب سطر `user.profile_updated` في سجل العيادة.
   *
   * @param owner صاحب الجلسة
   * @param input القيم بعد الـ contract
   * @returns الحساب بعد الحفظ
   */
  update(owner: AccountOwner, input: AccountRequest): Promise<AccountResponse> {
    const { db, clock, ids } = this.deps;
    return db.withTenant(owner.clinicId, async (tx) => {
      const before = await readRow(tx, owner, true);
      const now = clock.now();
      await tx.execute(
        sql`UPDATE memberships SET full_name = ${input.fullName},
              preferred_language = ${input.preferredLanguage},
              updated_at = ${now.toISOString()}::timestamptz
            WHERE clinic_id = ${owner.clinicId} AND id = ${owner.membershipId}`,
      );
      const after: AccountResponse = { ...before, ...input };
      await writeClinicAudit(tx, {
        clinicId: owner.clinicId,
        id: ids.newId(),
        actorUserId: owner.userId,
        action: "user.profile_updated",
        entityType: "user",
        entityId: owner.membershipId,
        details: { before: snapshot(before), after: snapshot(after) },
        createdAt: now,
      });
      return after;
    });
  }
}
