import type { ClinicTerm } from "../domain/reminder-rules.ts";

/** العيادات اللي جوه نافذة التنبيه — على pool المنصة (`clinics` و `platform_settings` بس). */
export interface DueClinicFinder {
  /**
   * العيادات اللي مش موقوفة وانتهاؤها خلال أيام التنبيه.
   *
   * @param now الوقت من الـ Clock
   * @returns ids العيادات، الأقرب انتهاءً الأول
   */
  dueClinics(now: Date): Promise<string[]>;
}

/** دفتر التنبيهات (0038) على pool العيادة، تحت `withTenant`. */
export interface ReminderLedger {
  /**
   * يعيد فحص العيادة جوه سياقها، ولو التنبيه لسه مستحق وماتسجلش لنفس الانتهاء قبل كده: يسجّله ويكتب
   * حدث `clinic.expiry_reminder` في نفس الـ transaction.
   *
   * @param clinicId العيادة
   * @param now الوقت من الـ Clock، بيتقري بعد ما الصف يتقري
   * @returns `true` لو اتسجّل تنبيه جديد
   */
  queue(clinicId: string, now: () => Date): Promise<boolean>;
}

/** أدمن نشط هيستلم التنبيه. */
export interface ReminderRecipient {
  readonly membershipId: string;
  readonly fullName: string;
  readonly email: string;
}

/** اللي الإرسال محتاجه، مقري وقت الإرسال. */
export interface ReminderState {
  readonly clinic: ClinicTerm & {
    readonly nameAr: string;
    readonly nameEn: string;
    readonly language: "ar" | "en";
    readonly timezone: string;
  };
  readonly recipients: readonly ReminderRecipient[];
}

/** قارئ حالة الإرسال على pool العيادة. */
export interface ReminderStateReader {
  /**
   * العيادة وأدمنها النشطين (دور النظام `clinic_admin`).
   *
   * @param clinicId العيادة
   * @returns الحالة، أو `null` لو العيادة مش موجودة
   */
  read(clinicId: string): Promise<ReminderState | null>;
}
