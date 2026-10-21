import type {
  CashClosingDetail,
  CashClosingPreview,
  CreateCashClosingRequest,
} from "@eyadex/contracts/finance";
import { DatabaseError, type Database, type Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { writeFinanceAudit } from "../../../../shared/finance-audit.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor, MemberBranches } from "../../domain/billing-actor.ts";
import {
  closingPeriod,
  expectedCash,
  requireNoteForDifference,
  requireNotClosedToday,
  requirePreviewCurrent,
} from "../../domain/cash-closing-rules.ts";
import { reachesBranch } from "../../domain/invoice-reach.ts";
import { cashClosingsReach } from "../../domain/money-reach.ts";
import { clinicBusinessDay } from "../../domain/payment-rules.ts";
import { insertClosing, readClosing } from "../../persistence/pg-cash-closings.ts";
import {
  advanceDrawer,
  branchExists,
  clinicMoneyFacts,
  drawerMovements,
  lockDrawer,
  methodTotals,
  readDrawer,
  shareBranch,
} from "../../persistence/pg-cash-drawer.ts";
import { closingClaim } from "../payments/payment-claim.ts";
import { closingInReach, drawerMovement } from "./closing-view.ts";

/** الرد المحفوظ في مفتاح العيادة: الإقفال اللي أول طلب كتبه. */
interface ClosingClaim {
  readonly closingId: string;
}

/**
 * إقفال صندوق الفرع (FIN-15، F2-Q9، F2-Q10، F2-Q11، spec §4.4، §4.6، §8d R3-3): المعاينة بتورّي الفترة
 * من آخر إقفال لحد آخر رقم نقدي من غير ما تكتب حاجة، والإقفال بيأكد إن الدرج ما اتحركش من وقت المعاينة
 * وبعدين بيكتب المتوقع (نقد داخل − نقد خارج في الفترة) والمعدود. القفل: المفتاح (0) وبعدين الفرع (9،
 * `FOR SHARE`) وبعدين الدرج (9a) — من غير قفل مراجع، فعمره ما يستنى دفعة مستنياه.
 */
export class CashClosings {
  constructor(
    private readonly deps: {
      readonly db: Database;
      readonly clock: Clock;
      readonly ids: IdGenerator;
    },
  ) {}

  /**
   * معاينة الإقفال: الفترة ومبالغها وحركاتها، ومجاميع كل طريقة في يوم العمل للعلم بس. مفيش حاجة بتتكتب.
   *
   * @param actor الفاعل (شايل `create:cash_closings` بنطاق `clinic` أو `branch`)
   * @param branchId الفرع
   * @returns المعاينة
   */
  preview(actor: BillingActor, branchId: string): Promise<CashClosingPreview> {
    const reach = this.reach(actor);
    if (!reachesBranch(reach, branchId)) throw new ApiError("not_found");
    const { db, clock } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      if (!(await branchExists(tx, actor.clinicId, branchId))) throw new ApiError("not_found");
      const facts = await clinicMoneyFacts(tx, actor.clinicId);
      const period = closingPeriod(await readDrawer(tx, actor.clinicId, branchId));
      const movements = await drawerMovements(
        tx,
        actor.clinicId,
        branchId,
        period.fromCashSeq,
        period.throughCashSeq,
      );
      const sums = expectedCash(period, movements.map(drawerMovement));
      const day = clinicBusinessDay(clock.now(), facts.timezone);
      return {
        branchId,
        businessDate: day.businessDate,
        previousClosingId: period.previousClosingId,
        fromCashSeq: String(period.fromCashSeq),
        throughCashSeq: String(period.throughCashSeq),
        cashInMinor: String(sums.cashInMinor),
        cashOutMinor: String(sums.cashOutMinor),
        expectedMinor: String(sums.expectedMinor),
        methodTotals: await methodTotals(tx, actor.clinicId, branchId, day.businessDate),
        movements,
        currency: facts.currency,
        currencyExponent: facts.currencyExponent,
      };
    });
  }

  /**
   * بيقفل صندوق الفرع على الفترة اللي المعاينة ورّتها، ويجيب الإقفال بحركاته.
   *
   * @param actor الفاعل (شايل `create:cash_closings` بنطاق `clinic` أو `branch`)
   * @param body الفرع، وآخر إقفال وآخر رقم نقدي من المعاينة، والمعدود، والملاحظة
   * @param idempotencyKey المفتاح
   * @returns الإقفال بحركاته
   */
  close(
    actor: BillingActor,
    body: CreateCashClosingRequest,
    idempotencyKey: string,
  ): Promise<CashClosingDetail> {
    const reach = this.reach(actor);
    // A replay whose branch left the caller's reach is not_found too (spec §4.4).
    if (!reachesBranch(reach, body.branchId)) throw new ApiError("not_found");
    const claim = closingClaim(actor, body, idempotencyKey);
    const { db, clock, ids } = this.deps;
    return db
      .withTenant(actor.clinicId, async (tx) => {
        const claimed = await claimClinicIdempotencyKey<ClosingClaim>(
          tx,
          claim,
          ids.newId(),
          clock.now(),
        );
        if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
        if (claimed.kind === "replay") {
          return closingInReach(tx, actor.clinicId, reach, claimed.response.closingId);
        }
        const closingId = await this.write(tx, actor, body);
        await completeClinicIdempotencyKey(tx, claim, { closingId });
        return closingInReach(tx, actor.clinicId, reach, closingId);
      })
      .catch((error: unknown) => {
        // The once-a-day rule is judged on the last closing; a clock set back to an earlier closed day
        // reaches the unique index instead, and hears the same domain answer, not a 500.
        if (
          error instanceof DatabaseError &&
          error.constraint === "cash_closings_business_date_unique"
        ) {
          throw new ApiError("cash_closing_exists");
        }
        throw error;
      });
  }

  /**
   * الكتابة تحت الأقفال: الفرع `FOR SHARE`، بعدين الدرج `FOR UPDATE` (ADR-0027 items 9 و 9a). الوقت
   * بيتقرا بعد الأقفال، والمعاينة لازم تبقى لسه صالحة (R3-3).
   *
   * @returns معرّف الإقفال اللي اتكتب
   */
  private async write(
    tx: Tx,
    actor: BillingActor,
    body: CreateCashClosingRequest,
  ): Promise<string> {
    const { clock, ids } = this.deps;
    const { clinicId } = actor;
    if (!(await shareBranch(tx, clinicId, body.branchId))) throw new ApiError("not_found");
    const drawer = await lockDrawer(tx, ids, clinicId, body.branchId, clock.now());
    const period = closingPeriod(drawer);
    requirePreviewCurrent(period, {
      previousClosingId: body.previousClosingId,
      throughCashSeq: BigInt(body.throughCashSeq),
    });
    const now = clock.now();
    const facts = await clinicMoneyFacts(tx, clinicId);
    const day = clinicBusinessDay(now, facts.timezone);
    const last =
      drawer.lastClosingId === null ? null : await readClosing(tx, clinicId, drawer.lastClosingId);
    requireNotClosedToday(last?.businessDate ?? null, day.businessDate);
    const movements = await drawerMovements(
      tx,
      clinicId,
      body.branchId,
      period.fromCashSeq,
      period.throughCashSeq,
    );
    const sums = expectedCash(period, movements.map(drawerMovement));
    const note = body.note ?? null;
    requireNoteForDifference(BigInt(body.countedMinor), sums.expectedMinor, note);
    const closingId = ids.newId();
    await insertClosing(tx, clinicId, {
      id: closingId,
      branchId: body.branchId,
      businessDate: day.businessDate,
      fromCashSeq: period.fromCashSeq,
      toCashSeq: period.throughCashSeq,
      expectedMinor: sums.expectedMinor,
      countedMinor: body.countedMinor,
      methodTotals: await methodTotals(tx, clinicId, body.branchId, day.businessDate),
      note,
      previousClosingId: period.previousClosingId,
      currency: facts.currency,
      currencyExponent: facts.currencyExponent,
      closedBy: actor.membershipId,
      closedAt: now,
    });
    await advanceDrawer(
      tx,
      clinicId,
      body.branchId,
      { id: closingId, toCashSeq: period.throughCashSeq },
      now,
    );
    // F2-Q19: administrative and out of the platform's view; the note appears as its length only.
    await writeFinanceAudit(tx, {
      clinicId,
      id: ids.newId(),
      actorUserId: actor.userId,
      action: "cash_closing.closed",
      entityType: "cash_closing",
      entityId: closingId,
      branchId: body.branchId,
      before: null,
      after: {
        businessDate: day.businessDate,
        fromCashSeq: String(period.fromCashSeq),
        toCashSeq: String(period.throughCashSeq),
        expectedMinor: String(sums.expectedMinor),
        countedMinor: body.countedMinor,
        differenceMinor: String(BigInt(body.countedMinor) - sums.expectedMinor),
        currency: facts.currency,
        previousClosingId: period.previousClosingId,
      },
      ...(note === null ? {} : { noteLength: note.length }),
      createdAt: now,
    });
    return closingId;
  }

  /**
   * نطاق الإقفال: فرع الإقفال جوه مفتاح `create:cash_closings`.
   *
   * @returns الفروع
   * @throws ApiError `forbidden` لما مالوش المفتاح بأي نطاق
   */
  private reach(actor: BillingActor): MemberBranches {
    const reach = cashClosingsReach(actor, "create");
    if (reach === null) throw new ApiError("forbidden");
    return reach;
  }
}
