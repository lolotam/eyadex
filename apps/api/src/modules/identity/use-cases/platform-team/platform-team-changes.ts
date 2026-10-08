import type {
  InvitePlatformAccountRequest,
  PlatformAccountResponse,
  PlatformMeResponse,
  PlatformTeamListQuery,
  PlatformTeamListResponse,
} from "@eyadex/contracts/platform-console";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import type { SecretSealer } from "@eyadex/secrets";

import { scrubAuditText } from "@eyadex/observability";
import { ApiError } from "../../../../shared/errors.ts";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  requestHash,
} from "../../../../shared/idempotency.ts";
import { appendOutboxEvent } from "../../../../shared/outbox.ts";
import { writePlatformAudit } from "../../../../shared/platform-audit.ts";
import type { Clock } from "../../../tenancy/index.ts";
import {
  decideDeactivation,
  decideInvite,
  platformInviteExpiry,
  reactivatedState,
} from "../../domain/platform-team-rules.ts";
import { issueInvitationToken } from "../../persistence/pg-first-admin-provisioner.ts";
import {
  accountByEmail,
  accountById,
  accountByUser,
  insertInvitedAccount,
  lockPlatformTeam,
  otherActiveCount,
  pageAccounts,
  reissueLink,
  reservePlatformEmail,
  setAccountStatus,
  toPlatformAccount,
  type PlatformAccountRow,
} from "../../persistence/pg-platform-team.ts";
import { decodeCursor, encodeCursor } from "../../queries/page-cursor.ts";

/** الحدث اللي الـ worker بيبعت بيه إيميل الدعوة (ADR-0020). */
export const PLATFORM_TEAM_INVITED_EVENT = "platform.team_invited";

/** اللي تغييرات الفريق محتاجاها — كله متحقن. */
export interface PlatformTeamDeps {
  /** الـ pool على `eyadex_platform` (الجدول ده بس، 0037). */
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** `OUTBOX_SEAL_KEY`: الرابط بيتقفل بـ id الحدث، والـ worker بس اللي يفتحه (ADR-0006). */
  readonly sealer: SecretSealer;
}

/** نتيجة تغيير حالة: الحساب، ومستخدم لازم جلساته تتلغي بعد الـ commit (لو فيه). */
export interface StatusChange {
  readonly account: PlatformAccountResponse;
  readonly revokeUserId: string | null;
}

// PRD §4.11: an allowlist; the name is text a person typed. No hash, link or user id.
const snapshot = (a: PlatformAccountResponse) => ({
  fullName: scrubAuditText(a.fullName),
  email: a.email,
  status: a.status,
});

/**
 * The guard checked the actor before the team lock; a deactivation that committed while this request
 * waited for the lock must still win, or an account could reactivate itself (Codex r2, ADR-0020).
 */
async function assertActorActive(tx: Tx, actorUserId: string): Promise<void> {
  const actor = await accountByUser(tx, actorUserId);
  if (actor?.status !== "active") throw new ApiError("account_disabled");
}

const facts = (row: PlatformAccountRow) => ({
  status: row.status,
  joinedAt: row.joined_at === null ? null : new Date(row.joined_at),
});

/**
 * فريق المنصة (stories 24–25، ADM-02، ADR-0020): القايمة، الدعوة، التعطيل وإعادة التفعيل. كل تغيير
 * transaction واحدة على pool المنصة تحت قفل الفريق، بسطر واحد في سجل المنصة. إلغاء الجلسات بعد
 * الـ commit عند المنادي.
 */
export class PlatformTeamChanges {
  constructor(private readonly deps: PlatformTeamDeps) {}

  /**
   * الحساب اللي داخل دلوقتي. الـ gate اتأكد إنه نشط قبل ما يوصل هنا.
   *
   * @param userId مستخدم الجلسة
   * @returns الـ id والاسم والإيميل
   */
  async me(userId: string): Promise<PlatformMeResponse> {
    const row = await this.deps.db.withNoTenant((tx) => accountByUser(tx, userId));
    if (row === null) throw new ApiError("account_disabled");
    return { id: row.id, fullName: row.full_name, email: row.email };
  }

  /**
   * صفحة من الفريق، الأقدم الأول.
   *
   * @param query الـ cursor والحد
   * @returns الصفحة
   */
  async list(query: PlatformTeamListQuery): Promise<PlatformTeamListResponse> {
    const after = decodeCursor(query.cursor);
    const { rows, total } = await this.deps.db.withNoTenant((tx) =>
      pageAccounts(tx, after, query.limit),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toPlatformAccount),
      nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.id) : null,
      total,
    };
  }

  /**
   * يدعو عضو جديد، أو يبعت رابط جديد لحساب لسه مدعو. الإيميل بيتحجز عالميًا (0015).
   *
   * @param actorUserId عضو الفريق اللي بيدعو
   * @param input الاسم والإيميل
   * @param idempotencyKey إعادة نفس الطلب بترجع نفس الحساب من غير دعوة تانية
   * @returns الحساب
   */
  async invite(
    actorUserId: string,
    input: InvitePlatformAccountRequest,
    idempotencyKey: string,
  ): Promise<PlatformAccountResponse> {
    const { db, clock, ids, sealer } = this.deps;
    const scope = `platform:team-invite:${actorUserId}`;
    return db.withNoTenant(async (tx) => {
      const claim = await claimIdempotencyKey<{ accountId: string }>(
        tx,
        scope,
        idempotencyKey,
        requestHash(input),
        clock.now(),
      );
      if (claim.kind === "conflict") throw new ApiError("idempotency_conflict");
      if (claim.kind === "replay") return this.current(tx, claim.response.accountId);
      await lockPlatformTeam(tx);
      await assertActorActive(tx, actorUserId);
      const existing = await accountByEmail(tx, input.email, "update");
      const decision = decideInvite(existing);
      if (decision === "email_taken") throw new ApiError("email_taken");
      const now = clock.now();
      const { token, hash } = issueInvitationToken();
      const expiresAt = platformInviteExpiry(now);
      let accountId: string;
      if (existing === null) {
        if (!(await reservePlatformEmail(tx, input.email))) throw new ApiError("email_taken");
        accountId = ids.newId();
        await insertInvitedAccount(tx, {
          id: accountId,
          email: input.email,
          fullName: input.fullName,
          tokenHash: hash,
          tokenExpiresAt: expiresAt,
          invitedBy: actorUserId,
          now,
        });
      } else {
        accountId = existing.id;
        await reissueLink(tx, accountId, { hash, expiresAt, invitedBy: actorUserId, now });
      }
      const account = await this.current(tx, accountId);
      const eventId = ids.newId();
      await appendOutboxEvent(tx, {
        id: eventId,
        clinicId: null,
        type: PLATFORM_TEAM_INVITED_EVENT,
        payload: {
          accountId,
          email: account.email,
          fullName: account.fullName,
          expiresAt: expiresAt.toISOString(),
          // Only the worker (same key) can open it, and only inside this event (ADR-0006).
          sealedToken: sealer.seal(token, eventId),
        },
        createdAt: now,
      });
      await writePlatformAudit(tx, {
        id: ids.newId(),
        actorUserId,
        action: "platform_account.invited",
        clinicId: null,
        details: {
          accountId,
          before: existing === null ? null : snapshot(toPlatformAccount(existing)),
          after: snapshot(account),
        },
        createdAt: now,
      });
      await completeIdempotencyKey(tx, scope, idempotencyKey, { accountId });
      return account;
    });
  }

  /**
   * يعطّل حساب. آخر حساب نشط مايتعطلش (ADM-02)؛ الرابط المعلّق بيموت.
   *
   * @param actorUserId عضو الفريق
   * @param accountId الحساب
   * @returns الحساب، والمستخدم اللي جلساته تتلغي بعد الـ commit
   */
  deactivate(actorUserId: string, accountId: string): Promise<StatusChange> {
    return this.change(actorUserId, accountId, async (tx, row) => {
      const decision = decideDeactivation(row, await otherActiveCount(tx, row.id));
      if (decision === "refuse") throw new ApiError("last_active_platform_account");
      if (decision === "noop") return null;
      return { status: "deactivated", action: "platform_account.deactivated" };
    });
  }

  /**
   * يرجّع حساب معطّل: نشط لو كان انضم، ومدعو لو لأ (رابطه مات؛ دعوة تانية بتبعت واحد جديد).
   *
   * @param actorUserId عضو الفريق
   * @param accountId الحساب
   * @returns الحساب
   */
  reactivate(actorUserId: string, accountId: string): Promise<StatusChange> {
    return this.change(actorUserId, accountId, async (_tx, row) => {
      const next = reactivatedState(facts(row));
      return next === null ? null : { status: next, action: "platform_account.reactivated" };
    });
  }

  private async current(tx: Tx, accountId: string): Promise<PlatformAccountResponse> {
    const row = await accountById(tx, accountId);
    if (row === null) throw new ApiError("not_found");
    return toPlatformAccount(row);
  }

  private change(
    actorUserId: string,
    accountId: string,
    decide: (
      tx: Tx,
      row: PlatformAccountRow,
    ) => Promise<{ status: PlatformAccountRow["status"]; action: string } | null>,
  ): Promise<StatusChange> {
    const { db, clock, ids } = this.deps;
    return db.withNoTenant(async (tx) => {
      await lockPlatformTeam(tx);
      await assertActorActive(tx, actorUserId);
      const row = await accountById(tx, accountId, "update");
      if (row === null) throw new ApiError("not_found");
      const change = await decide(tx, row);
      const before = toPlatformAccount(row);
      // Repeating a state changes nothing and records nothing.
      if (change === null) return { account: before, revokeUserId: null };
      const now = clock.now();
      await setAccountStatus(tx, row.id, change.status, now);
      const after = await this.current(tx, row.id);
      await writePlatformAudit(tx, {
        id: ids.newId(),
        actorUserId,
        action: change.action,
        clinicId: null,
        details: { accountId: row.id, before: snapshot(before), after: snapshot(after) },
        createdAt: now,
      });
      return {
        account: after,
        revokeUserId: change.status === "deactivated" ? row.user_id : null,
      };
    });
  }
}
