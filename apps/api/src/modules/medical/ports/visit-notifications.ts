import type { PatientNotificationList } from "@eyadex/contracts/notifications";
import type { Tx } from "@eyadex/db";

import type { PrescriptionNotice } from "../domain/visit-notices.ts";

/**
 * منفذ رسائل المراجع الخاصة بالزيارات (ADR-0031): بتنفّذه notifications (`PgVisitNotifications`) ومربوط في
 * medical.module.ts، فموديول الطب عمره ما بيسمّي جداول الرسائل.
 */
export interface VisitNotifications {
  /**
   * بيحط رسالة الروشتة في الطابور جوه transaction الاعتماد، بعد قفل الزيارة: صف لكل قناة شغّالة (البريد،
   * وواتساب لو قناته مربوطة). لو القنوات أو رسالة الروشتة مقفولة، أو اتحطت قبل كده للزيارة دي، مفيش حاجة
   * بتتكتب.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param notice الرسالة
   * @returns `true` لو اتحط صف واحد على الأقل بحدث outbox
   */
  queuePrescription(tx: Tx, notice: PrescriptionNotice): Promise<boolean>;

  /**
   * تاريخ رسائل زيارة، الأحدث الأول. المنادي هو اللي بيقرر إن الفاعل يقدر يشوف الزيارة.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param visitId الزيارة
   * @returns الرسائل (من غير عنوان ولا نص)
   */
  history(tx: Tx, clinicId: string, visitId: string): Promise<PatientNotificationList>;
}
