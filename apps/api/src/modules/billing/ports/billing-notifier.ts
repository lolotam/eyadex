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
  queueInvoice(
    tx: Tx,
    request: {
      readonly clinicId: string;
      readonly invoiceId: string;
      readonly patientId: string;
      readonly channel: NotificationChannel;
      readonly sendRequestId: string;
      readonly requestedBy: string;
    },
  ): Promise<string>;
}
