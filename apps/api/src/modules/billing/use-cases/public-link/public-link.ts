import { createHash } from "node:crypto";

import { SYSTEM_ACTOR_ID } from "@eyadex/contracts/audit";
import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { ApiError } from "../../../../shared/errors.ts";
import { writeFinanceAudit } from "../../../../shared/finance-audit.ts";
import type { Clock } from "../../../tenancy/index.ts";
import { lookupInvoiceLink } from "../../persistence/pg-invoice-link-lookup.ts";
import { readInvoice } from "../../persistence/pg-invoice-store.ts";
import type { InvoicePdfRenderer } from "../../ports/invoice-pdf.ts";

// 32 random bytes in base64url, as the worker mints them (C1): exactly 43 characters, no padding.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * رابط المراجع الخاص (spec §8 rule 16، R2-7): من غير جلسة. الرمز بيتحوّل لـ hash ويتدوّر عليه بالدالة
 * المحدودة، وبعدين الفاتورة جوه عيادتها. منتهي أو مقفول أو مجهول = نفس الرد `invoice_link_expired`.
 */
export class PublicInvoiceLinks {
  constructor(
    private readonly deps: {
      readonly db: Database;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly pdf: InvoicePdfRenderer;
    },
  ) {}

  /**
   * بيفتح الرابط: آخر نسخة من الفاتورة PDF، وصف سجل وصول للمراجع بفاعل النظام وطريق `patient_link`.
   *
   * @param token الرمز من المسار
   * @returns ملف الـ PDF
   */
  async open(token: string): Promise<Uint8Array> {
    if (!TOKEN.test(token)) throw new ApiError("invoice_link_expired");
    const hash = createHash("sha256").update(Buffer.from(token, "base64url")).digest();
    const link = await lookupInvoiceLink(this.deps.db, hash);
    if (link === null) throw new ApiError("invoice_link_expired");
    const invoice = await this.deps.db.withTenant(link.clinicId, async (tx) => {
      const found = await readInvoice(tx, link.clinicId, link.invoiceId);
      // A void revokes its links in its own transaction; one that commits after the lookup lands here.
      if (found === null || found.status === "void") throw new ApiError("invoice_link_expired");
      await writeFinanceAudit(tx, {
        clinicId: link.clinicId,
        id: this.deps.ids.newId(),
        actorUserId: SYSTEM_ACTOR_ID,
        action: "invoice.link_opened",
        entityType: "invoice_link",
        entityId: link.linkId,
        branchId: found.branchId,
        before: null,
        after: null,
        via: "patient_link",
        createdAt: this.deps.clock.now(),
      });
      return found;
    });
    return this.deps.pdf.render(link.clinicId, invoice);
  }
}
