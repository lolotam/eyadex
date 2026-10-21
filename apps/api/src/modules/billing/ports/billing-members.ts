import type { Tx } from "@eyadex/db";

/**
 * أقفال عضوية أطباء سطور الفاتورة (spec §8d item 4، ADR-0027 items 5a و6). الموديول مبيقراش جدول
 * العضويات، فالقفل بييجي من موديول الهوية عن طريق البورت ده، وبيترتبط في `billing.module.ts`.
 */
export interface BillingLineDoctorLocks {
  /**
   * بيقفل صفوف عضوية أطباء السطور مرتبة بالمعرّف، بنفس قفل `KEY SHARE` اللي بياخده المفتاح الأجنبي
   * بتاع السطر وقت الإدخال. كده الإصدار والتعديل بياخدوا القفل ده قبل صف المراجع (ADR-0027 item 6)،
   * وما بيستنّوا عضوية وهما ماسكين فرع. ومعرّف عضو مش موجود ما بيقفلش حاجة؛ المفتاح الأجنبي بتاع
   * السطر هو اللي بيرفضه زي ما هو.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param membershipIds معرّفات أطباء السطور؛ التكرار بيتشال، والقائمة الفاضية مبتعملش استعلام
   * @returns مفيش قيمة؛ بترجع لما القفل ياخد
   */
  lockLineDoctors(tx: Tx, clinicId: string, membershipIds: readonly string[]): Promise<void>;
}
