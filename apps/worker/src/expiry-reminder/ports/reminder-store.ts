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
   * يعيد فحص العيادة جوه سياقها، ولو التنبيه لسه مستحق وماتسجلش لنفس الانتهاء قبل كده وفيه أدمن نشط:
   * يسجّله ويكتب حدث `clinic.expiry_reminder` لكل أدمن نشط في نفس الـ transaction.
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
  /** المستلم لو لسه أدمن نشط، وإلا `null`. */
  readonly recipient: ReminderRecipient | null;
}

/** قارئ حالة الإرسال على pool العيادة. */
export interface ReminderStateReader {
  /**
   * يمسك صف العيادة وعضوية المستلم ودوره `FOR SHARE` ويشغّل `fn` وهم ممسوكين: تجديد أو إيقاف أو تعطيل
   * المستلم بيستنى لحد ما الإرسال يرجع، فالحالة اللي اتفحصت هي الحالة اللي اتبعت عليها.
   *
   * @param clinicId العيادة
   * @param membershipId المستلم من الحدث
   * @param fn القرار والإرسال؛ بياخد الحالة (`null` لو العيادة مش موجودة)
   * @returns نتيجة `fn`
   */
  whileLocked<T>(
    clinicId: string,
    membershipId: string,
    fn: (state: ReminderState | null) => Promise<T>,
  ): Promise<T>;
}
