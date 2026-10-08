import type { Invitation, InvitationLink } from "@eyadex/contracts/invitations";
import type { InviteUserInput } from "@eyadex/contracts/users";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import { appendOutboxEvent } from "../../../../shared/outbox.ts";
import type { SecretSealer } from "@eyadex/secrets";
import type { Clock } from "../../../tenancy/index.ts";
import { invitationExpiry } from "../../domain/system-roles.ts";
import { decideInvitationCancel } from "../../domain/user-rules.ts";
import { issueInvitationToken } from "../../persistence/pg-first-admin-provisioner.ts";
import {
  cancelInvitation,
  findInvitationForUpdate,
  insertInvitation,
  readClinicForMail,
  releaseEmail,
  reserveEmail,
} from "../../persistence/pg-invitation-store.ts";
import {
  activeRole,
  assertActiveBranches,
  lockClinicBranches,
  lockClinicUsers,
} from "../../persistence/pg-user-store.ts";
import {
  assertMayTouchAdmin,
  auditSnapshot,
  type UserActor,
} from "../user-changes/user-changes.ts";
import { lockClinicRoles } from "../../persistence/pg-role-store.ts";
import { assertActorMay, assertMayGrantRole } from "../role-changes/grant-bound.ts";
import { assertSeat, invitationView, rotateInvitationLink } from "./invitation-rotation.ts";

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
    const claimedAt = clock.now();
    const { clinicId } = actor;
    const branchIds = input.allBranches ? [] : input.branchIds;
    const claim = {
      clinicId,
      scope: `invitation:create:${actor.userId}`,
      key: idempotencyKey,
      hash: requestHash(input),
    };
    return db.withTenant(clinicId, async (tx) => {
      // The roles lock first, in every path that grants a role (ADR-0017 §6).
      await lockClinicRoles(tx, clinicId);
      // Before any row, the idempotency claim included: the guard's grant may have been revoked.
      await assertActorMay(tx, actor, "create:users:clinic");
      const claimed = await claimClinicIdempotencyKey<{ invitationId: string }>(
        tx,
        claim,
        ids.newId(),
        claimedAt,
      );
      if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
      if (claimed.kind === "replay") {
        return {
          invitation: await this.view(tx, clinicId, claimed.response.invitationId),
          changed: false,
        };
      }
      // Users lock, then branches: a parallel branch deactivation waits, so the branches checked
      // here are still active at COMMIT (ADR-0012 §16).
      await lockClinicUsers(tx, clinicId);
      await lockClinicBranches(tx, clinicId);
      // Decided after both locks: an invitation that expired while waiting no longer holds a seat,
      // and the new link gets its full seven days.
      const now = clock.now();
      const role = await activeRole(tx, clinicId, input.roleId);
      await assertActiveBranches(tx, clinicId, branchIds);
      await assertMayTouchAdmin(tx, actor, [role.systemKey]);
      await assertMayGrantRole(tx, actor, "create:users:clinic", role.id, {
        allBranches: input.allBranches,
        branchIds,
      });
      await assertSeat(tx, clinicId, now);
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
      await this.audit(tx, actor, "invitation.sent", id, { after: auditSnapshot(invitation) });
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
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const { before, invitation, token } = await rotateInvitationLink(
        tx,
        this.deps.clock,
        actor,
        invitationId,
      );
      await this.mail(tx, invitation, token, "resent");
      await this.audit(tx, actor, "invitation.resent", invitationId, {
        before: auditSnapshot(before),
        after: auditSnapshot(invitation),
      });
      return { invitation, changed: true };
    });
  }

  /**
   * ينسخ رابط دعوة pending (حتى المنتهية): نفس فحوص إعادة الإرسال وبنفس الترتيب، ورمز جديد يموّت
   * أي رابط قديم (حتى اللي اتبعت بالإيميل). من غير حدث outbox، والرمز بيرجع في الرد ده بس.
   *
   * @param actor الفاعل
   * @param invitationId الدعوة
   * @returns الرابط الجديد وانتهاؤه، ومعاه هل حصل تغيير (دايمًا `true`)
   */
  async copyLink(
    actor: UserActor,
    invitationId: string,
  ): Promise<{ link: InvitationLink; changed: boolean }> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const { before, invitation, token } = await rotateInvitationLink(
        tx,
        this.deps.clock,
        actor,
        invitationId,
      );
      await this.audit(tx, actor, "invitation.link_copied", invitationId, {
        before: auditSnapshot(before),
        after: auditSnapshot(invitation),
      });
      return { link: { token, expiresAt: invitation.expiresAt }, changed: true };
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
    const { clinicId } = actor;
    return db.withTenant(clinicId, async (tx) => {
      // Roles lock first and the route's permission rechecked, like every identity write (ADR-0017 §6).
      await lockClinicRoles(tx, clinicId);
      await lockClinicUsers(tx, clinicId);
      await assertActorMay(tx, actor, "deactivate:users:clinic");
      const now = clock.now();
      const locked = await findInvitationForUpdate(tx, clinicId, invitationId);
      if (locked === null) throw new ApiError("not_found");
      await assertMayTouchAdmin(tx, actor, [locked.roleSystemKey]);
      const decision = decideInvitationCancel(locked.status);
      if (decision === "accepted") throw new ApiError("invitation_used");
      const before = await this.view(tx, clinicId, invitationId);
      if (decision === "already_cancelled") return { invitation: before, changed: false };
      await releaseEmail(tx, locked.email, invitationId);
      await cancelInvitation(tx, clinicId, invitationId, now);
      const invitation = await this.view(tx, clinicId, invitationId);
      await this.audit(tx, actor, "invitation.cancelled", invitationId, {
        before: auditSnapshot(before),
        after: auditSnapshot(invitation),
      });
      return { invitation, changed: true };
    });
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

  private view(tx: Tx, clinicId: string, id: string): Promise<Invitation> {
    return invitationView(tx, clinicId, id, this.deps.clock.now());
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
