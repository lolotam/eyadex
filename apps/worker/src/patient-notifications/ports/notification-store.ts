import type {
  MessageLanguage,
  NotificationKind,
  NotificationRoute,
  NotificationSettings,
  NotificationSkipReason,
} from "@eyadex/contracts/notifications";

import type { LockedClinicProvider } from "../../invitation-mail/ports/invitation-state-reader.ts";
import type { AppointmentNow } from "../domain/skip-decision.ts";

/** صف الدفتر ممسوك `FOR UPDATE`. مفيه عنوان ولا نص (spec §2). */
export interface LedgerRow {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly patientId: string;
  readonly subjectId: string;
  /** آخر فشل `<route>:<code>`، عشان المحاولة الجاية تعرف تكمّل منين. */
  readonly lastError: string | null;
}

/** الموعد وقت الإرسال، مع اللي الرسالة بتقوله عنه بس (N-4). */
export interface AppointmentSubject extends AppointmentNow {
  readonly startsAt: Date;
  readonly branch: {
    readonly nameAr: string;
    readonly nameEn: string;
    readonly address: string | null;
  };
  readonly providerName: string;
}

/** ظروف سطر دوا زي ما اتخزّنت، كل ظرف مربوط بصفه (ADR-0028). */
export interface SealedPrescriptionLine {
  readonly id: string;
  readonly medicine: string;
  readonly dose: string;
  readonly frequency: string;
  readonly duration: string;
  readonly note: string | null;
}

/** الزيارة الموقّعة وقت الإرسال: الفرع والطبيب اللي وقّع وسطور الوصفة النشطة. */
export interface VisitSubject {
  readonly visitId: string;
  readonly branchId: string;
  readonly doctorName: string;
  /** مستخدم الطبيب اللي وقّع: فاعل سطر السجل `patient.prescription_sent`. */
  readonly signerUserId: string;
  readonly lines: readonly SealedPrescriptionLine[];
}

/** صفّي مزود العيادة ممسوكين `FOR UPDATE` (الأساسي الأول). */
export interface LockedProviders {
  readonly primary: LockedClinicProvider | null;
  readonly fallback: LockedClinicProvider | null;
}

/** نتيجة المحاولة اللي بتتكتب على صف الدفتر في نفس الـ transaction. */
export type LedgerOutcome =
  | { readonly kind: "sent"; readonly route: NotificationRoute; readonly at: Date }
  | { readonly kind: "skipped"; readonly reason: NotificationSkipReason; readonly at: Date }
  /** `final` = الفشل الخامس أو فشل مالوش علاج: الصف بيبقى `failed`؛ غير كده بيفضل `queued`. */
  | {
      readonly kind: "failure";
      readonly error: string;
      readonly attempts: number;
      readonly final: boolean;
      readonly at: Date;
    };

/** كل اللي الإرسال محتاجه، مقري والصفوف ممسوكة. */
export interface ReadyNotification {
  readonly ledger: LedgerRow;
  readonly clinic: {
    readonly nameAr: string;
    readonly nameEn: string;
    readonly language: MessageLanguage;
    readonly timeZone: string;
  };
  readonly settings: NotificationSettings;
  readonly patient: {
    readonly email: string | null;
    readonly language: MessageLanguage | null;
    readonly optedOut: boolean;
  };
  /** لرسايل المواعيد؛ `null` لو الموعد مش موجود أو الرسالة وصفة. */
  readonly appointment: AppointmentSubject | null;
  /** للوصفة؛ `null` لو الزيارة مش موجودة أو مش موقّعة أو الرسالة موعد. */
  readonly visit: VisitSubject | null;
  readonly providers: LockedProviders;
  /**
   * بيكتب نتيجة المحاولة على صف الدفتر (والصف لسه `queued`): `sent` بالمسار والوقت، `skipped` بالسبب،
   * أو الفشل (عدد المحاولات وكود قصير، و`failed` لو نهائي).
   */
  record(outcome: LedgerOutcome): Promise<void>;
  /**
   * سطر سجل وصول للمراجع `patient.prescription_sent` (N-5): الفاعل الطبيب اللي وقّع، والفرع فرع الزيارة،
   * والتفاصيل id الزيارة بس — مفيش اسم دوا.
   */
  auditPrescriptionSent(at: Date): Promise<void>;
}

/** حالة صف الدفتر وقت الـ claim. */
export type LockedNotification =
  | { readonly kind: "missing" }
  /** الصف مش `queued` (اتبعت أو اتخطّى أو فشل نهائي): الحدث بيتقفل من غير إرسال. */
  | { readonly kind: "settled" }
  | ({ readonly kind: "ready" } & ReadyNotification);

/** قارئ وكاتب الدفتر على pool الـ `eyadex_app` تحت `withTenant` (RLS بيقصره على عيادة الحدث). */
export interface NotificationStore {
  /**
   * بيمسك صف الدفتر `FOR UPDATE`، وبعدين المراجع والعيادة والإعدادات والموعد أو الزيارة `FOR SHARE`، وصفّي
   * مزود العيادة `FOR UPDATE` (الأساسي قبل البديل)، ويشغّل `use` والكل ممسوك: أي تعديل على الموعد أو
   * المراجع بيستنى الإرسال، فاللي اتفحص هو اللي اتبعت عليه.
   *
   * @param clinicId عيادة الحدث
   * @param notificationId صف الدفتر
   * @param use بيقرر ويبعت ويكتب النتيجة والصفوف ممسوكة
   * @returns اللي `use` رجّعه
   */
  whileLocked<T>(
    clinicId: string,
    notificationId: string,
    use: (state: LockedNotification) => Promise<T>,
  ): Promise<T>;
}
