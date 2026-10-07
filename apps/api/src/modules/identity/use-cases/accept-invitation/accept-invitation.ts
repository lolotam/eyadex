import type {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  InspectInvitationResponse,
} from "@eyadex/contracts/invitation-acceptance";
import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { ApiError } from "../../../../shared/errors.ts";
import { decideClinicAccess, type Clock } from "../../../tenancy/index.ts";
import { hashInvitationToken } from "../../persistence/pg-first-admin-provisioner.ts";
import {
  clinicForToken,
  invitationClinic,
  invitationGrants,
  pendingInvitation,
} from "../../persistence/pg-invitation-acceptance.ts";
import { writeAcceptedMembership } from "../../persistence/pg-membership-writer.ts";
import { lockClinicBranches } from "../../persistence/pg-user-store.ts";
import type { ClinicAccounts } from "../../ports/clinic-accounts.ts";

/** اللي القبول محتاجه — كله متحقن. */
export interface AcceptInvitationDeps {
  /** الـ pool على `eyadex_app`. */
  readonly db: Database;
  /** حسابات منطقة العيادة (Better Auth على `eyadex_auth`). */
  readonly accounts: ClinicAccounts;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

// One answer for every reason a link cannot be used: used, expired, cancelled, unknown, or a clinic
// that is blocked or a role/branch switched off since (ADR-0008). TODO(spec): a clearer message for
// the last two once the PRD decides what an invitee may learn about the clinic.
const invalid = () => new ApiError("invitation_invalid");

/**
 * قبول الدعوة (PRD stories 28/57، INV-01). transactionين: الحساب على `eyadex_auth` وجانب العيادة
 * تحت `withTenant` — الحساب بيتعمل وصف الدعوة مقفول، فأي فشل بعده بيرجّع العيادة كلها، وإعادة
 * نفس الرابط بتلاقي الحساب وبتعيد استخدامه (ADR-0008، مصفوفة الفشل).
 */
export class AcceptInvitation {
  constructor(private readonly deps: AcceptInvitationDeps) {}

  /** المعاينة قبل كلمة المرور: الاسم والإيميل والعيادة، أو `invitation_invalid` واحدة. */
  async inspect(token: string): Promise<InspectInvitationResponse> {
    const hash = hashInvitationToken(token);
    const clinicId = await clinicForToken(this.deps.db, hash);
    if (clinicId === null) throw invalid();
    return this.deps.db.withTenant(clinicId, async (tx) => {
      const invitation = await pendingInvitation(tx, hash, false);
      const clinic = await invitationClinic(tx, clinicId);
      if (invitation === null || clinic === null) throw invalid();
      if (decideClinicAccess(clinic, this.deps.clock.now()) !== "allowed") throw invalid();
      // The same checks as accept: a link accept would refuse is not shown as valid here.
      if (!(await invitationGrants(tx, invitation)).usable) throw invalid();
      return {
        clinicNameAr: clinic.nameAr,
        clinicNameEn: clinic.nameEn,
        email: invitation.email,
        fullName: invitation.fullName,
        expiresAt: invitation.expiresAt.toISOString(),
      };
    });
  }

  /** القبول نفسه. مابيعملش جلسة: المستخدم بيدخل بعدها من شاشة الدخول العادية. */
  async accept(input: AcceptInvitationRequest): Promise<AcceptInvitationResponse> {
    const { db, accounts, clock, ids } = this.deps;
    const hash = hashInvitationToken(input.token);
    const clinicId = await clinicForToken(db, hash);
    if (clinicId === null) throw invalid();
    return db.withTenant(clinicId, async (tx) => {
      // The row lock serialises every accept of this link: a parallel one waits, then sees `accepted`.
      const invitation = await pendingInvitation(tx, hash, true);
      const clinic = await invitationClinic(tx, clinicId);
      if (invitation === null || clinic === null) throw invalid();
      const now = clock.now();
      if (decideClinicAccess(clinic, now) !== "allowed") throw invalid();
      // Row, then branches (ADR-0012 §16): a parallel branch deactivation either commits first and the
      // grants below see it, or waits and then counts this member among the stranded ones.
      await lockClinicBranches(tx, clinicId);
      const grants = await invitationGrants(tx, invitation);
      if (!grants.usable) throw invalid();

      // The email is held for THIS invitation (0015/0017), so a clinic account with it and no
      // membership can only be a previous attempt of this same link that failed after creating it.
      const existing = await accounts.findAccountByEmail(invitation.email);
      if (existing !== null && existing.area !== "clinic") throw new ApiError("account_other_area");
      let userId: string;
      if (existing === null) {
        ({ userId } = await accounts.createUserAccount({
          email: invitation.email,
          name: invitation.fullName,
          password: input.password,
        }));
      } else {
        userId = existing.userId;
        await accounts.setAccountPassword(userId, input.password);
      }

      const written = await writeAcceptedMembership(tx, ids, {
        clinicId,
        userId,
        invitation,
        branchIds: grants.branchIds,
        language: clinic.defaultLanguage,
        now,
      });
      // A hold that no longer matches (it expired between the lookup and now) rolls everything back.
      if (!written) throw invalid();
      return { clinicId, email: invitation.email };
    });
  }
}
