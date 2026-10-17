import type { NotificationChannel } from "@eyadex/contracts/notifications";
import type { Tx } from "@eyadex/db";

/** طابور رسايل المراجع زي ما المالية محتاجاه (بيتربط بـ adapter موديول الإشعارات في `billing.module.ts`). */
export interface BillingInvoiceNotifier {
  /**
   * بيحط رسالة فاتورة في الطابور بمفتاح العميل `sendRequestId` (spec §8 rule 15، R2-5): نفس المفتاح بنفس
   * الفاتورة والقناة بيرجّع الصف الأول، وبفاتورة أو قناة تانية `send_request_conflict` ومفيش حاجة بتتكتب.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`، بعد قفل الفاتورة
   * @param request العيادة والفاتورة ومراجعها والقناة والمفتاح والعضوية اللي طلبت
   * @returns id صف الرسالة
   */
  queueInvoice(tx: Tx, request: InvoiceSendRequest): Promise<string>;

  /**
   * الصف اللي المفتاح ده حطّه قبل كده (R2-5): الضغطة المعادة بترجعه قبل أي حكم جديد على الفاتورة.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param request نفس طلب `queueInvoice`
   * @returns id الصف الأول، أو `null` لو المفتاح جديد؛ بفاتورة أو قناة تانية `send_request_conflict`
   */
  firstSend(tx: Tx, request: InvoiceSendRequest): Promise<string | null>;
}

/** ضغطة «ابعت» واحدة على فاتورة. */
export interface InvoiceSendRequest {
  readonly clinicId: string;
  readonly invoiceId: string;
  readonly patientId: string;
  readonly channel: NotificationChannel;
  readonly sendRequestId: string;
  readonly requestedBy: string;
}
