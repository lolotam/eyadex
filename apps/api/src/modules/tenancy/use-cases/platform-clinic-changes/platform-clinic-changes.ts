import { NO_FEATURES, type ClinicModule } from "@eyadex/contracts/clinics";
import { moduleDependencyGap } from "@eyadex/contracts/onboarding";
import type {
  UpdateLimitsRequest,
  UpdateSubscriptionRequest,
} from "@eyadex/contracts/platform-clinics";
import type { PlatformClinicFinanceRequest } from "@eyadex/contracts/finance";
import { DatabaseError, type Database, type Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { sql } from "drizzle-orm";

import { ApiError } from "../../../../shared/errors.ts";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  requestHash,
} from "../../../../shared/idempotency.ts";
import { writePlatformAudit } from "../../../../shared/platform-audit.ts";
import type { ClinicStatus } from "../../domain/clinic-access.ts";
import { resolveExpiry } from "../../domain/subscription.ts";
import type { Clock } from "../../ports/clock.ts";

/** اللي الـ use cases محتاجينه: pool المنصة، الوقت، والـ ids. */
export interface PlatformClinicChangesDeps {
  /** الـ pool على `eyadex_platform` (UPDATE على clinics و clinic_features بس، 0013). */
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

interface ClinicRow {
  status: ClinicStatus;
  expires_at: Date | string;
  max_users: number;
  max_branches: number;
}

/** الحقول المسموحة في before/after بتاع سجل المنصة: مفيش أي حاجة غيرها (PRD §4.11). */
interface Subscription {
  status: ClinicStatus;
  expiresAt: string;
}

const iso = (value: Date | string) => new Date(value).toISOString();

/**
 * تغييرات المنصة على عيادة واحدة (stories 9–15، ADR-0010). كل واحد transaction واحدة: يقفل صف
 * العيادة، يكتب التغيير، ويكتب صف واحد في سجل المنصة. إبطال الكاش بعد الـ commit عند المنادي
 * (`platform`)، لأن `tenancy` ماتستوردش `identity`.
 */
export class PlatformClinicChanges {
  constructor(private readonly deps: PlatformClinicChangesDeps) {}

  /**
   * يفتح أو يقفل موديول. صفوف `role_permissions` مابتتلمسش (FLAG-02).
   *
   * @param actorUserId عضو فريق المنصة
   * @param clinicId العيادة
   * @param module الموديول
   * @param enabled الحالة الجديدة
   * @returns بيخلص بعد الـ commit؛ عيادة مش موجودة → `not_found`؛ موديول من غير اللي محتاجه
   *   (الطبي من غير المراجعين، P2-14) → `validation`
   */
  async setFeature(actorUserId: string, clinicId: string, module: ClinicModule, enabled: boolean) {
    await this.inClinic(actorUserId, clinicId, async (tx, _clinic, now) => {
      const rows = await tx.execute<{ module: ClinicModule; enabled: boolean }>(
        sql`SELECT module, enabled FROM clinic_features WHERE clinic_id = ${clinicId}`,
      );
      const before = rows.filter((row) => row.module === module);
      // صف ناقص = مقفول (default deny)، نفس قاعدة isModuleEnabled.
      const next = Object.fromEntries(rows.map((row) => [row.module, row.enabled]));
      next[module] = enabled;
      if (moduleDependencyGap({ ...NO_FEATURES, ...next })) {
        throw new ApiError("validation", [{ path: ["enabled"], code: "module_requires" }]);
      }
      await tx.execute(
        sql`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
            VALUES (${clinicId}, ${this.deps.ids.newId()}, ${module}, ${enabled},
                    ${now.toISOString()}::timestamptz)
            ON CONFLICT (clinic_id, module)
            DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
      );
      return {
        action: "clinic.feature_changed",
        details: {
          module,
          before: { enabled: before[0]?.enabled ?? false },
          after: { enabled },
        },
      };
    });
  }

  /**
   * يغيّر الحالة و/أو الانتهاء (مدة من النهارده أو تاريخ صريح). البيانات مابتتلمسش (story 78).
   *
   * @param actorUserId عضو فريق المنصة
   * @param clinicId العيادة
   * @param input الطلب بعد الـ contract
   * @param idempotencyKey إلزامي مع `durationDays`: إعادة نفس الطلب ماتمدّش الاشتراك تاني
   * @returns بيخلص بعد الـ commit؛ نفس المفتاح بطلب مختلف → `idempotency_conflict`
   */
  async updateSubscription(
    actorUserId: string,
    clinicId: string,
    input: UpdateSubscriptionRequest,
    idempotencyKey?: string,
  ) {
    const scope = `platform:clinic-subscription:${actorUserId}`;
    await this.inClinic(actorUserId, clinicId, async (tx, clinic, now) => {
      if (idempotencyKey !== undefined) {
        const claim = await claimIdempotencyKey<{ clinicId: string }>(
          tx,
          scope,
          idempotencyKey,
          requestHash({ clinicId, ...input }),
          now,
        );
        // A replay already moved the expiry once; recomputing from the retry time would move it again.
        if (claim.kind === "replay") return null;
        if (claim.kind === "conflict") throw new ApiError("idempotency_conflict");
      }
      const before: Subscription = { status: clinic.status, expiresAt: iso(clinic.expires_at) };
      const expiresAt =
        input.durationDays !== undefined
          ? resolveExpiry({ kind: "duration", days: input.durationDays }, now)
          : input.expiresAt !== undefined
            ? resolveExpiry({ kind: "date", at: new Date(input.expiresAt) }, now)
            : new Date(before.expiresAt);
      const after: Subscription = {
        status: input.status ?? clinic.status,
        expiresAt: expiresAt.toISOString(),
      };
      await tx.execute(
        sql`UPDATE clinics SET status = ${after.status},
              expires_at = ${after.expiresAt}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
            WHERE id = ${clinicId}`,
      );
      if (idempotencyKey !== undefined) {
        await completeIdempotencyKey(tx, scope, idempotencyKey, { clinicId });
      }
      return { action: "clinic.subscription_changed", details: { before, after } };
    });
  }

  /**
   * يغيّر الحدود. حد أقل من الاستهلاك الحالي مسموح: بيمنع الإضافات الجديدة بس (PRD §4.9).
   *
   * @param actorUserId عضو فريق المنصة
   * @param clinicId العيادة
   * @param input الطلب بعد الـ contract
   * @returns بيخلص بعد الـ commit
   */
  async updateLimits(actorUserId: string, clinicId: string, input: UpdateLimitsRequest) {
    await this.inClinic(actorUserId, clinicId, async (tx, clinic, now) => {
      const before = {
        maxUsers: Number(clinic.max_users),
        maxBranches: Number(clinic.max_branches),
      };
      const after = {
        maxUsers: input.maxUsers ?? before.maxUsers,
        maxBranches: input.maxBranches ?? before.maxBranches,
      };
      await tx.execute(
        sql`UPDATE clinics SET max_users = ${after.maxUsers}, max_branches = ${after.maxBranches},
              updated_at = ${now.toISOString()}::timestamptz
            WHERE id = ${clinicId}`,
      );
      return { action: "clinic.limits_changed", details: { before, after } };
    });
  }

  /**
   * عملة العيادة ونسبة ضريبتها (spec §8 rule 6). العملة بتتغير بس جوه `finance_set_currency` (0061)، تحت
   * قفل مالية العيادة، ومادام مفيش سعر ولا فاتورة؛ غير كده `currency_locked`. نفس القيم = مفيش صف سجل.
   *
   * @param actorUserId عضو فريق المنصة
   * @param clinicId العيادة
   * @param input العملة و/أو الضريبة
   * @returns بيخلص لما التغيير يتحفظ
   */
  async updateFinance(actorUserId: string, clinicId: string, input: PlatformClinicFinanceRequest) {
    await this.inClinic(actorUserId, clinicId, async (tx, _clinic, now) => {
      const [row] = await tx.execute<{ currency: string; tax_rate_bp: number }>(
        sql`SELECT currency, tax_rate_bp FROM clinics WHERE id = ${clinicId}`,
      );
      const before = { currency: row!.currency, taxRateBp: row!.tax_rate_bp };
      const after = {
        currency: input.currency ?? before.currency,
        taxRateBp: input.taxRateBp ?? before.taxRateBp,
      };
      if (after.currency === before.currency && after.taxRateBp === before.taxRateBp) return null;
      if (after.currency !== before.currency) await setCurrency(tx, clinicId, after.currency);
      await tx.execute(
        sql`UPDATE clinics SET tax_rate_bp = ${after.taxRateBp},
              updated_at = ${now.toISOString()}::timestamptz WHERE id = ${clinicId}`,
      );
      return { action: "clinic.finance_changed", details: { before, after } };
    });
  }

  private async inClinic(
    actorUserId: string,
    clinicId: string,
    change: (
      tx: Tx,
      clinic: ClinicRow,
      now: Date,
    ) => Promise<{ action: string; details: Record<string, unknown> } | null>,
  ): Promise<void> {
    const { db, clock, ids } = this.deps;
    const now = clock.now();
    await db.withTenant(clinicId, async (tx) => {
      // The row lock orders concurrent platform changes on one clinic; each sees the other's result.
      const rows = await tx.execute<ClinicRow>(
        sql`SELECT status, expires_at, max_users, max_branches FROM clinics
            WHERE id = ${clinicId} FOR UPDATE`,
      );
      const clinic = rows[0];
      if (clinic === undefined) throw new ApiError("not_found");
      const changed = await change(tx, clinic, now);
      // null = an idempotent replay: nothing changed, so nothing is audited.
      if (changed === null) return;
      const { action, details } = changed;
      await writePlatformAudit(tx, {
        id: ids.newId(),
        actorUserId,
        action,
        clinicId,
        details,
        createdAt: now,
      });
    });
  }
}

// The contract admits supported currencies only, so the one refusal of the function the API can reach is
// currency_locked (a price or an invoice exists). DatabaseError keeps the SQLSTATE, never the message.
async function setCurrency(tx: Tx, clinicId: string, currency: string): Promise<void> {
  try {
    await tx.execute(sql`SELECT finance_set_currency(${clinicId}::uuid, ${currency}::char(3))`);
  } catch (error) {
    if (error instanceof DatabaseError && error.code === "P0001") {
      throw new ApiError("currency_locked");
    }
    throw error;
  }
}
