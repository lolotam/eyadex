import type { SendInvoiceRequest, SendInvoiceResponse } from "@eyadex/contracts/finance";
import type { Database } from "@eyadex/db";

import { ApiError } from "../../../../shared/errors.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import { viewReach } from "../../domain/invoice-reach.ts";
import { shareInvoice } from "../../persistence/pg-invoice-changes.ts";
import type { BillingInvoiceNotifier } from "../../ports/billing-notifier.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import { invoiceVisible } from "../invoice-visible.ts";

/**
 * إرسال الفاتورة للمراجع (FIN-5، spec §8 rule 15): أي حد يشوف الفاتورة يقدر يبعتها. الـ API بيحط الرسالة
 * في الطابور بس؛ الـ worker بيعمل الرابط ويبعته، ويتخطى لو الفاتورة اتلغت قبل الإرسال.
 */
export class InvoiceSends {
  constructor(
    private readonly deps: {
      readonly db: Database;
      readonly patients: BillingPatientReader;
      readonly notifier: BillingInvoiceNotifier;
    },
  ) {}

  /**
   * بيحط رسالة الفاتورة في الطابور على القناة المطلوبة.
   *
   * @param actor الفاعل (شايل `view:invoices` بأي نطاق)
   * @param id الفاتورة
   * @param body القناة ومفتاح الضغطة
   * @returns id صف الرسالة؛ ضغطة جديدة على فاتورة ملغية → `invoice_void`
   */
  send(actor: BillingActor, id: string, body: SendInvoiceRequest): Promise<SendInvoiceResponse> {
    const reach = viewReach(actor);
    if (reach === null) throw new ApiError("forbidden");
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const invoice = await shareInvoice(tx, actor.clinicId, id);
      if (
        invoice === null ||
        !(await invoiceVisible(tx, this.deps.patients, actor, reach, invoice))
      ) {
        throw new ApiError("not_found");
      }
      const request = {
        clinicId: actor.clinicId,
        invoiceId: id,
        patientId: invoice.patientId,
        channel: body.channel,
        sendRequestId: body.sendRequestId,
        requestedBy: actor.membershipId,
      };
      // A retried press answers with the row it queued, even if the invoice was voided since (R2-5).
      const first = await this.deps.notifier.firstSend(tx, request);
      if (first !== null) return { notificationId: first };
      if (invoice.status === "void") throw new ApiError("invoice_void");
      return { notificationId: await this.deps.notifier.queueInvoice(tx, request) };
    });
  }
}
