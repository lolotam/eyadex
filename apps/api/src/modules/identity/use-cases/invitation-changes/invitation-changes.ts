import type { Invitation } from "@eyadex/contracts/invitations";
import type { InviteUserInput } from "@eyadex/contracts/users";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { maskPhonesInText } from "@eyadex/observability";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import { appendOutboxEvent } from "../../../../shared/outbox.ts";
import type { SecretSealer } from "../../../../shared/secret-sealer.ts";
import { checkLimit, usersUsage, type Clock } from "../../../tenancy/index.ts";
import { invitationExpiry } from "../../domain/system-roles.ts";
import {
  decideInvitationCancel,
  decideInvitationResend,
  personAuditSnapshot,
} from "../../domain/user-rules.ts";
import { issueInvitationToken } from "../../persistence/pg-first-admin-provisioner.ts";
import {
  cancelInvitation,
  findInvitationForUpdate,
  insertInvitation,
  readClinicForMail,
  releaseEmail,
  renewEmail,
  reserveEmail,
  rotateInvitation,
} from "../../persistence/pg-invitation-store.ts";
import {
  activeRole,
  assertActiveBranches,
  lockClinicUsers,
  readSeats,
} from "../../persistence/pg-user-store.ts";
import { findInvitationView } from "../../queries/invitation-views.ts";
import { usersLimitError, type UserActor } from "../user-changes/user-changes.ts";

/** نوع حدث الـ outbox اللي الـ dispatcher هيبعت بيه إيميل الدعوة (ADR-0006، ADR-0012). */
export const USER_INVITED_EVENT = "clinic.user_invited";

export interface InvitationChangesDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly sealer: SecretSealer;
}

export interface InvitationChange {
  readonly invitation: Invitation;
  readonly changed: boolean;
}

/**
 * دعوة/إعادة إرسال/إلغاء (stories 35–37، 43، ADR-0012). كل عملية transaction واحدة تحت قفل
 * مستخدمي العيادة. الرمز الخام بيتقفل في حدث الـ outbox بس؛ مابيرجعش في أي رد ولا بيتسجّل.
 */
export class InvitationChanges {
  constructor(private readonly deps: InvitationChangesDeps) {}

  /**
   * دعوة جديدة بمفتاح `Idempotency-Key` إلزامي؛ الإعادة بترجع نفس الدعوة ومن غير حدث تاني.
   *
   * @param actor الفاعل
   * @param input الجسم بعد الـ contract
   * @param idempotencyKey المفتاح
   * @returns الدعوة (`token` دايمًا `null`)
   */
  async invite(
    actor: UserActor,
    input: InviteUserInput,
    idempotencyKey: string,
  ): Promise<InvitationChange> {
    const { db, clock, ids } = this.deps;
    const now = clock.now();
    const { clinicId } = actor;
    const branchIds = input.allBranches ? [] : input.branchIds;
    const claim = {
      clinicId,
      scope: `invitation:create:${actor.userId}`,
      key: idempotencyKey,
      hash: requestHash(input),
    };
    return db.withTenant(clinicId, async (tx) => {
      const claimed = await claimClinicIdempotencyKey<{ invitationId: string }>(
        tx,
        claim,
        ids.newId(),
        now,
      );
      if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
      if (claimed.kind === "replay") {
        return { invitation: await this.view(tx, clinicId, claimed.response.invitationId), changed: false };
      }
      const role = await activeRole(tx, clinicId, input.roleId);
      await assertActiveBranches(tx, clinicId, branchIds);
      await lockClinicUsers(tx, clinicId);
      await this.assertSeat(tx, clinicId, now);
      const id = ids.newId();
      const expiresAt = invitationExpiry(now);
      if (!(await reserveEmail(tx, input.email, id, expiresAt))) throw new ApiError("email_taken");
      const { token, hash } = issueInvitationToken();
      await insertInvitation(
        tx,
        clinicId,
        {
          id,
          email: input.email,
          fullName: input.fullName,
          roleId: role.id,
          allBranches: input.allBranches,
          branchIds,
          expiresAt,
          invitedBy: actor.userId,
          tokenHash: hash,
        },
        () => ids.newId(),
        now,
      );
      const invitation = await this.view(tx, clinicId, id);
      await this.mail(tx, invitation, token, "invited");
      await this.audit(tx, actor, "invitation.sent", id, { after: snapshot(invitation) });
      await completeClinicIdempotencyKey(tx, claim, { invitationId: id });
      return { invitation, changed: true };
    });
  }

  /**
   * يعيد إرسال دعوة pending (حتى المنتهية): رمز جديد، انتهاء جديد، والرابط القديم بيموت فورًا.
   * دعوة منتهية بترجع تاخد مقعد، فبتعدّي على فحص الحد.
   *
   * @param actor الفاعل
   * @param invitationId الدعوة
   * @returns الدعوة بعد الإرسال
   */
  async resend(actor: UserActor, invitationId: string): Promise<InvitationChange> {
    const { db, clock } = this.deps;
    const now = clock.now();
    const { clinicId } = actor;
    return db.withTenant(clinicId, async (tx) => {
      await lockClinicUsers(tx, clinicId);
      const locked = await findInvitationForUpdate(tx, clinicId, invitationId);
      if (locked === null) throw new ApiError("not_found");
      const decision = decideInvitationResend(locked.status, locked.expiresAt, now);
      if (decision === "not_pending") {
        throw new ApiError(locked.status === "accepted" ? "invitation_used" : "invitation_cancelled");
      }
      if (decision === "reoccupies_seat") await this.assertSeat(tx, clinicId, now);
      const before = await this.view(tx, clinicId, invitationId);
      const expiresAt = invitationExpiry(now);
      // The hold first: the 0017 trigger checks it covers the new expiry.
      if (!(await renewEmail(tx, locked.email, invitationId, expiresAt))) {
        throw new ApiError("email_taken");
      }
      const { token, hash } = issueInvitationToken();
      await rotateInvitation(tx, clinicId, invitationId, hash, expiresAt);
      const invitation = await this.view(tx, clinicId, invitationId);
      await this.mail(tx, invitation, token, "resent");
      await this.audit(tx, actor, "invitation.resent", invitationId, {
        before: snapshot(before),
        after: snapshot(invitation),
      });
      return { invitation, changed: true };
    });
  }

  /**
   * يلغي دعوة pending ويحرّر الإيميل. ملغاة أصلاً: no-op. مقبولة: `invitation_used`.
   *
   * @param actor الفاعل
   * @param invitationId الدعوة
   * @returns الدعوة بعد الإلغاء
   */
  async cancel(actor: UserActor, invitationId: string): Promise<InvitationChange> {
    const { db, clock } = this.deps;
    const now = clock.now();
    const { clinicId } = actor;
    return db.withTenant(clinicId, async (tx) => {
      await lockClinicUsers(tx, clinicId);
      const locked = await findInvitationForUpdate(tx, clinicId, invitationId);
      if (locked === null) throw new ApiError("not_found");
      const decision = decideInvitationCancel(locked.status);
      if (decision === "accepted") throw new ApiError("invitation_used");
      const before = await this.view(tx, clinicId, invitationId);
      if (decision === "already_cancelled") return { invitation: before, changed: false };
      await releaseEmail(tx, locked.email, invitationId);
      await cancelInvitation(tx, clinicId, invitationId, now);
      const invitation = await this.view(tx, clinicId, invitationId);
      await this.audit(tx, actor, "invitation.cancelled", invitationId, {
        before: snapshot(before),
        after: snapshot(invitation),
      });
      return { invitation, changed: true };
    });
  }

  private async assertSeat(tx: Tx, clinicId: string, now: Date): Promise<void> {
    const seats = await readSeats(tx, clinicId, now);
    const usage = usersUsage(seats.members, seats.invitations, seats.max);
    if (checkLimit(usage).kind === "exceeded") throw usersLimitError(usage.used, usage.max);
  }

  // One event per send. The dispatcher re-checks pending + unexpired + sha256(token) = token_hash at send
  // time, so a cancelled or superseded link is never mailed (ADR-0012).
  private async mail(
    tx: Tx,
    invitation: Invitation,
    token: string,
    reason: "invited" | "resent",
  ): Promise<void> {
    const clinic = await readClinicForMail(tx, invitation.clinicId);
    const eventId = this.deps.ids.newId();
    await appendOutboxEvent(tx, {
      id: eventId,
      clinicId: invitation.clinicId,
      type: USER_INVITED_EVENT,
      payload: {
        clinicId: invitation.clinicId,
        invitationId: invitation.id,
        email: invitation.email,
        fullName: invitation.fullName,
        language: clinic.language,
        clinicNameAr: clinic.nameAr,
        clinicNameEn: clinic.nameEn,
        roleNameAr: invitation.roleNameAr,
        roleNameEn: invitation.roleNameEn,
        expiresAt: invitation.expiresAt,
        reason,
        sealedToken: this.deps.sealer.seal(token, eventId),
      },
      createdAt: this.deps.clock.now(),
    });
  }

  private async view(tx: Tx, clinicId: string, id: string): Promise<Invitation> {
    const view = await findInvitationView(tx, clinicId, id, this.deps.clock.now());
    if (view === null) throw new ApiError("not_found");
    return view;
  }

  private audit(
    tx: Tx,
    actor: UserActor,
    action: string,
    invitationId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    return writeClinicAudit(tx, {
      clinicId: actor.clinicId,
      id: this.deps.ids.newId(),
      actorUserId: actor.userId,
      action,
      entityType: "invitation",
      entityId: invitationId,
      details,
      createdAt: this.deps.clock.now(),
    });
  }
}

const snapshot = (invitation: Invitation) => {
  const s = personAuditSnapshot(invitation);
  return { ...s, fullName: maskPhonesInText(s.fullName) };
};
