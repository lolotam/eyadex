import type { ScheduleWriteResponse, TimeOffInput, WallShift } from "@eyadex/contracts/schedules";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { lockProvider } from "../../../../shared/provider-lock.ts";
import type { Clock } from "../../../tenancy/index.ts";
import { decideBranchSchedule, scheduleAuditSnapshot } from "../../domain/schedule-rules.ts";
import { providerWorksIn, reachCovers, type Reach } from "../../domain/scheduling-scope.ts";
import {
  decideTimeOffCancel,
  normalizeNote,
  timeOffAuditSnapshot,
  type TimeOffRecord,
} from "../../domain/time-off-rules.ts";
import {
  findTimeOff,
  insertTimeOff,
  markTimeOffCancelled,
  readScheduleRows,
  replaceBranchRows,
} from "../../persistence/pg-schedule-store.ts";
import type { ProviderDirectory, ProviderRecord } from "../../ports/provider-directory.ts";
import type { SchedulingBranchReader } from "../../ports/scheduling-branch-reader.ts";
import {
  projectSchedule,
  providerVisible,
  type ScheduleViewer,
} from "../../queries/provider-schedule.ts";

export interface ScheduleChangesDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly providers: ProviderDirectory;
  readonly branches: SchedulingBranchReader;
}

/**
 * The caller of a schedules write: a viewer whose `reach` is the write route's, who is acting (for the
 * audit row), and the reach of its view keys, which clips the schedule the write answers with.
 */
export interface ScheduleActor extends ScheduleViewer {
  readonly userId: string;
  readonly viewReach: Reach;
}

/**
 * جداول العمل والإجازات (D-6، D-13، D-14، ADR-0026 §3–§4). كل كتابة transaction واحدة تحت قفل مقدّم
 * الخدمة (نفس قفل الحجز في A2)، فيها صف سجل إداري واحد؛ الأسبوع بيتحفظ لكل فرع لوحده، والتداخل بيتقرر
 * على كل صفوف مقدّم الخدمة في كل الفروع، النايمة كمان. مفيش حذف إلا استبدال صفوف أسبوع الفرع.
 */
export class ScheduleChanges {
  constructor(private readonly deps: ScheduleChangesDeps) {}

  /**
   * يستبدل أسبوع مقدّم خدمة في فرع؛ نفس الصفوف = نفس الرد من غير صف سجل. فرع نايم (متعطّل أو مقدّم
   * الخدمة سابه) بيقبل أسبوع فاضي بس، يعني مسح صفوفه.
   *
   * @param actor الفاعل بوصول `update:schedules`
   * @param membershipId مقدّم الخدمة
   * @param branchId الفرع
   * @param shifts الأسبوع بعد `branchScheduleInputSchema` (فاضي = مسح صفوف الفرع)
   * @returns الجدول بعد الحفظ زي ما مفاتيح العرض بتشوفه، أو `null` لو مش شايفة مقدّم الخدمة
   */
  replaceBranch(
    actor: ScheduleActor,
    membershipId: string,
    branchId: string,
    shifts: readonly WallShift[],
  ): Promise<ScheduleWriteResponse> {
    const { db, clock, ids, branches } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockProvider(tx, actor.clinicId, membershipId);
      const provider = await this.bookable(tx, actor, membershipId);
      const branch = await branches.lockForFiling(tx, actor.clinicId, branchId);
      if (branch === null) throw new ApiError("not_found");
      if (!reachCovers(actor.reach, branchId)) throw new ApiError("forbidden");
      // A dormant branch (inactive, or the provider left it) takes only an empty week: clearing its
      // rows is the way out when they block hours elsewhere (ADR-0026 §4).
      if (shifts.length > 0) {
        if (!branch.isActive) throw new ApiError("branch_inactive");
        if (!providerWorksIn(provider, branchId)) throw new ApiError("provider_not_in_branch");
      }
      const current = await readScheduleRows(tx, actor.clinicId, membershipId);
      const decision = decideBranchSchedule(current, branchId, shifts);
      if (decision.kind === "overlap") {
        // A branch the caller cannot view stays unnamed (Codex PR #63).
        const named = reachCovers(actor.viewReach, decision.branchId);
        throw new ApiError("schedule_overlap", named ? { branchId: decision.branchId } : undefined);
      }
      if (decision.kind === "replace") {
        const now = clock.now();
        const newId = () => ids.newId();
        await replaceBranchRows(
          tx,
          actor.clinicId,
          membershipId,
          branchId,
          decision.shifts,
          newId,
          now,
        );
        const before = current.filter((r) => r.branchId === branchId);
        await this.audit(tx, actor, "schedule.replaced", "provider_schedule", membershipId, {
          before: scheduleAuditSnapshot(provider.fullName, branchId, before),
          after: scheduleAuditSnapshot(provider.fullName, branchId, decision.shifts),
        });
      }
      return this.answer(tx, actor, provider);
    });
  }

  /**
   * يضيف إجازة لمقدّم خدمة قابل للحجز.
   *
   * @param actor الفاعل (`update:schedules:clinic`)
   * @param membershipId مقدّم الخدمة
   * @param input البداية والنهاية والملاحظة بعد `timeOffInputSchema`
   * @returns الجدول بعد الإضافة زي ما مفاتيح العرض بتشوفه، أو `null` لو مش شايفة مقدّم الخدمة
   */
  addTimeOff(
    actor: ScheduleActor,
    membershipId: string,
    input: TimeOffInput,
  ): Promise<ScheduleWriteResponse> {
    const { db, ids } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockProvider(tx, actor.clinicId, membershipId);
      const provider = await this.bookable(tx, actor, membershipId);
      const record: TimeOffRecord = {
        id: ids.newId(),
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        note: normalizeNote(input.note),
        cancelledAt: null,
      };
      await insertTimeOff(tx, actor.clinicId, membershipId, record, this.deps.clock.now());
      await this.audit(tx, actor, "time_off.added", "provider_time_off", record.id, {
        before: null,
        after: timeOffAuditSnapshot(provider.fullName, record),
      });
      return this.answer(tx, actor, provider);
    });
  }

  /**
   * يلغي إجازة (مفيش حذف)؛ الملغية قبل كده = نفس الرد من غير صف سجل.
   *
   * @param actor الفاعل (`update:schedules:clinic`)
   * @param membershipId مقدّم الخدمة
   * @param timeOffId الإجازة
   * @returns الجدول بعد الإلغاء زي ما مفاتيح العرض بتشوفه، أو `null` لو مش شايفة مقدّم الخدمة
   */
  cancelTimeOff(
    actor: ScheduleActor,
    membershipId: string,
    timeOffId: string,
  ): Promise<ScheduleWriteResponse> {
    const { db, clock } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockProvider(tx, actor.clinicId, membershipId);
      const provider = await this.visible(tx, actor, membershipId);
      const record = await findTimeOff(tx, actor.clinicId, membershipId, timeOffId);
      if (record === null) throw new ApiError("not_found");
      if (decideTimeOffCancel(record) === "cancel") {
        const now = clock.now();
        await markTimeOffCancelled(tx, actor.clinicId, record.id, now);
        await this.audit(tx, actor, "time_off.cancelled", "provider_time_off", record.id, {
          before: timeOffAuditSnapshot(provider.fullName, record),
          after: timeOffAuditSnapshot(provider.fullName, { ...record, cancelledAt: now }),
        });
      }
      return this.answer(tx, actor, provider);
    });
  }

  // Also a provider seen only through its rows in the caller's reach: the replace route can then clear
  // them, while a non-empty week stays `provider_not_in_branch` (ADR-0026 §4).
  private async visible(
    tx: Tx,
    actor: ScheduleActor,
    membershipId: string,
  ): Promise<ProviderRecord> {
    const provider = await this.deps.providers.find(tx, actor.clinicId, membershipId);
    if (provider === null || !(await providerVisible(tx, actor.clinicId, actor.reach, provider)))
      throw new ApiError("not_found");
    return provider;
  }

  // D-1, rule 1: only an active member with "accepts appointments" on has a schedule to edit.
  private async bookable(
    tx: Tx,
    actor: ScheduleActor,
    membershipId: string,
  ): Promise<ProviderRecord> {
    const provider = await this.visible(tx, actor, membershipId);
    if (!provider.active || !provider.acceptsAppointments) {
      throw new ApiError("provider_not_bookable");
    }
    return provider;
  }

  // The answer shows only what the caller's view keys reach, never the write's wider reach; a provider
  // those keys cannot see at all (its GET is not_found) gets no schedule, not even its name (Codex PR #63).
  private async answer(
    tx: Tx,
    actor: ScheduleActor,
    provider: ProviderRecord,
  ): Promise<ScheduleWriteResponse> {
    const { providers, branches, clock } = this.deps;
    if (!(await providerVisible(tx, actor.clinicId, actor.viewReach, provider))) {
      return { schedule: null };
    }
    const viewer = { ...actor, reach: actor.viewReach };
    const schedule = await projectSchedule(
      { tx, providers, branches },
      viewer,
      provider,
      clock.now(),
    );
    return { schedule };
  }

  private async audit(
    tx: Tx,
    actor: ScheduleActor,
    action: string,
    entityType: "provider_schedule" | "provider_time_off",
    entityId: string,
    details: { before: unknown; after: unknown },
  ): Promise<void> {
    await writeClinicAudit(tx, {
      clinicId: actor.clinicId,
      id: this.deps.ids.newId(),
      actorUserId: actor.userId,
      action,
      entityType,
      entityId,
      details,
      createdAt: this.deps.clock.now(),
    });
  }
}
