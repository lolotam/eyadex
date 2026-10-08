import type { AcceptInvitationRequest } from "@eyadex/contracts/invitation-acceptance";
import type {
  AcceptPlatformInvitationResponse,
  InspectPlatformInvitationResponse,
} from "@eyadex/contracts/platform-console";
import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { scrubAuditText } from "@eyadex/observability";
import { ApiError } from "../../../../shared/errors.ts";
import { writePlatformAudit } from "../../../../shared/platform-audit.ts";
import type { Clock } from "../../../tenancy/index.ts";
import { invitationUsable } from "../../domain/platform-team-rules.ts";
import { hashInvitationToken } from "../../persistence/pg-first-admin-provisioner.ts";
import {
  accountByTokenHash,
  markJoined,
  type PlatformAccountRow,
} from "../../persistence/pg-platform-team.ts";
import type { PlatformAuthAccounts } from "../../ports/clinic-accounts.ts";

/** اللي قبول دعوة الفريق محتاجه — كله متحقن. */
export interface AcceptPlatformInvitationDeps {
  /** الـ pool على `eyadex_platform`. */
  readonly db: Database;
  /** حسابات منطقة المنصة (Better Auth على `eyadex_auth`). */
  readonly accounts: PlatformAuthAccounts;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

// One answer for every unusable link: used, expired, deactivated or unknown (ADR-0008's rule).
const invalid = () => new ApiError("invitation_invalid");

const linkFacts = (row: PlatformAccountRow) => ({
  status: row.status,
  linkExpiresAt: row.token_expires_at === null ? null : new Date(row.token_expires_at),
});

/**
 * قبول دعوة فريق المنصة (story 24، ADR-0020)، بنفس شكل ADR-0008: صف الحساب مقفول، الحساب بيتعمل
 * على منطقة المنصة وهو لسه مقفول، وبعدين الصف بيتربط ويبقى نشط في نفس الـ transaction. الدخول بعدها
 * من شاشة الدخول، وتسجيل TOTP الإجباري بيشتغل هناك.
 */
export class AcceptPlatformInvitation {
  constructor(private readonly deps: AcceptPlatformInvitationDeps) {}

  /**
   * المعاينة قبل كلمة المرور.
   *
   * @param token الرمز من الرابط (في الجسم بس)
   * @returns الاسم والإيميل والانتهاء، أو `invitation_invalid`
   */
  async inspect(token: string): Promise<InspectPlatformInvitationResponse> {
    const hash = hashInvitationToken(token);
    const row = await this.deps.db.withNoTenant((tx) => accountByTokenHash(tx, hash));
    if (row === null || !invitationUsable(linkFacts(row), this.deps.clock.now())) throw invalid();
    return {
      fullName: row.full_name,
      email: row.email,
      expiresAt: new Date(row.token_expires_at ?? Number.NaN).toISOString(),
    };
  }

  /**
   * القبول: حساب منصة جديد (أو إعادة استخدام حساب منصة سابه فشل سابق)، والصف يبقى نشط ومربوط.
   *
   * @param input الرمز وكلمة المرور
   * @returns الإيميل؛ مفيش جلسة
   */
  async accept(input: AcceptInvitationRequest): Promise<AcceptPlatformInvitationResponse> {
    const { db, accounts, clock, ids } = this.deps;
    const hash = hashInvitationToken(input.token);
    return db.withNoTenant(async (tx) => {
      // Every accept of this link waits here; a waiter re-reads a cleared hash and is refused.
      const row = await accountByTokenHash(tx, hash, "update");
      if (row === null) throw invalid();
      const now = clock.now();
      if (!invitationUsable(linkFacts(row), now)) throw invalid();
      // The email is this row's alone (UNIQUE), so a platform account with it can only be a previous
      // attempt of this link that failed after creating it; a clinic account is never reused (0024).
      const existing = await accounts.findAccountByEmail(row.email);
      if (existing !== null && existing.area !== "platform")
        throw new ApiError("account_other_area");
      let userId: string;
      if (existing === null) {
        ({ userId } = await accounts.createUserAccount({
          email: row.email,
          name: row.full_name,
          password: input.password,
        }));
      } else {
        userId = existing.userId;
        await accounts.setAccountPassword(userId, input.password);
      }
      await markJoined(tx, row.id, userId, now);
      const shown = (status: string) => ({
        fullName: scrubAuditText(row.full_name),
        email: row.email,
        status,
      });
      await writePlatformAudit(tx, {
        id: ids.newId(),
        actorUserId: userId,
        action: "platform_account.joined",
        clinicId: null,
        details: { accountId: row.id, before: shown(row.status), after: shown("active") },
        createdAt: now,
      });
      return { email: row.email };
    });
  }
}
