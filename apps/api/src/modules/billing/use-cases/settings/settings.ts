import type { FinanceSettings, InvoicePrefixItem } from "@eyadex/contracts/finance";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import type { BlobStore } from "../../../../shared/blob/blob-store.ts";
import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { LOGO_MAX_BYTES, logoType, type LogoType } from "../../domain/logo.ts";
import {
  listPrefixes,
  lockBranchPrefix,
  logoKey,
  prefixTaken,
  readFinanceSettings,
  setBranchPrefix,
  setCommercialRegNo,
  setLogoKey,
} from "../../persistence/pg-finance-settings.ts";

export interface SettingsDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly blobs: BlobStore;
}

/**
 * إعدادات المالية بتاعة العيادة (spec §3.3، §8 rule 9): العملة والضريبة للقراية (المنصة بتحطهم)، رقم
 * السجل التجاري، اللوجو في الـ bucket الخاص، وبادئة فواتير كل فرع. كل تغيير صف سجل إداري.
 */
export class ClinicFinanceSettings {
  constructor(private readonly deps: SettingsDeps) {}

  /**
   * العملة وخاناتها والضريبة والسجل التجاري وهل فيه لوجو.
   *
   * @param clinicId العيادة
   * @returns الإعدادات
   */
  get(clinicId: string): Promise<FinanceSettings> {
    return this.deps.db.withTenant(clinicId, (tx) => readFinanceSettings(tx, clinicId));
  }

  /**
   * رقم السجل التجاري، أو `null` لمسحه.
   *
   * @param actor الفاعل (شايل `update:clinic_settings:clinic`)
   * @param commercialRegNo الرقم
   * @returns الإعدادات بعد الحفظ
   */
  setCommercialRegNo(
    actor: BillingActor,
    commercialRegNo: string | null,
  ): Promise<FinanceSettings> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const now = this.deps.clock.now();
      await setCommercialRegNo(tx, actor.clinicId, commercialRegNo, now);
      await this.audit(tx, actor, "clinic.commercial_reg_no_set", "clinic", actor.clinicId, {
        changed: ["commercialRegNo"],
      });
      return readFinanceSettings(tx, actor.clinicId);
    });
  }

  /**
   * لوجو جديد (PNG أو JPEG لحد 1 ميجا، النوع من البايتات نفسها) بمفتاح جديد؛ القديم بيفضل في الـ bucket.
   *
   * @param actor الفاعل (شايل `update:clinic_settings:clinic`)
   * @param bytes الصورة
   * @returns الإعدادات بعد الحفظ
   */
  async setLogo(actor: BillingActor, bytes: Buffer): Promise<FinanceSettings> {
    if (bytes.length === 0 || bytes.length > LOGO_MAX_BYTES || logoType(bytes) === null) {
      throw new ApiError("validation", [{ path: ["logo"], code: "invalid" }]);
    }
    const key = `clinic/${actor.clinicId}/logo/${this.deps.ids.newId()}`;
    // The bucket first: a failed upload leaves the clinic on its old logo, never on a missing key.
    await this.deps.blobs.put(key, bytes);
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      await setLogoKey(tx, actor.clinicId, key, this.deps.clock.now());
      await this.audit(tx, actor, "clinic.logo_set", "clinic", actor.clinicId, {
        changed: ["logo"],
      });
      return readFinanceSettings(tx, actor.clinicId);
    });
  }

  /**
   * اللوجو الحالي بنوعه.
   *
   * @param clinicId العيادة
   * @returns البايتات ونوعها
   */
  async logo(clinicId: string): Promise<{ bytes: Buffer; type: LogoType }> {
    const key = await this.deps.db.withTenant(clinicId, (tx) => logoKey(tx, clinicId));
    if (key === null) throw new ApiError("not_found");
    const bytes = await this.deps.blobs.get(key);
    return { bytes, type: logoType(bytes) ?? "image/png" };
  }

  /**
   * بادئة كل فرع وهل اتقفلت.
   *
   * @param clinicId العيادة
   * @returns بند لكل فرع
   */
  prefixes(clinicId: string): Promise<{ items: InvoicePrefixItem[] }> {
    return this.deps.db.withTenant(clinicId, async (tx) => ({
      items: await listPrefixes(tx, clinicId),
    }));
  }

  /**
   * بادئة الفرع: بتتقفل بعد أول فاتورة، وبادئة اتستخدمت لفرع تاني عمرها ما ترجع (spec §8 rule 9).
   *
   * @param actor الفاعل (شايل `update:branches:clinic`)
   * @param branchId الفرع
   * @param prefix البادئة
   * @returns بند الفرع بعد الحفظ
   */
  setPrefix(actor: BillingActor, branchId: string, prefix: string): Promise<InvoicePrefixItem> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const current = await lockBranchPrefix(tx, actor.clinicId, branchId);
      if (current === null) throw new ApiError("not_found");
      if (current.invoicePrefix === prefix) return current;
      if (current.locked) throw new ApiError("invoice_prefix_locked");
      if (await prefixTaken(tx, actor.clinicId, branchId, prefix)) {
        throw new ApiError("invoice_prefix_taken");
      }
      await setBranchPrefix(tx, actor.clinicId, branchId, prefix, this.deps.clock.now());
      await this.audit(tx, actor, "branch.invoice_prefix_set", "branch", branchId, {
        invoicePrefix: prefix,
      });
      return { branchId, invoicePrefix: prefix, locked: false };
    });
  }

  private audit(
    tx: Tx,
    actor: BillingActor,
    action: string,
    entityType: string,
    entityId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    return writeClinicAudit(tx, {
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
