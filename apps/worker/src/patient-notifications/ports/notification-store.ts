import type { CurrencyCode } from "@eyadex/contracts/money";
import type {
  MessageKind,
  MessageLanguage,
  NotificationChannel,
  NotificationRoute,
  NotificationSettings,
  NotificationSkipReason,
} from "@eyadex/contracts/notifications";
import type { WhatsappStatus, WhatsappTransport } from "@eyadex/contracts/whatsapp";

import type { LockedClinicProvider } from "../../invitation-mail/ports/invitation-state-reader.ts";
import type { AppointmentNow } from "../domain/skip-decision.ts";

/** صف الدفتر ممسوك `FOR UPDATE`. مفيه عنوان ولا نص (spec §2). */
export interface LedgerRow {
  readonly id: string;
  readonly kind: MessageKind;
  readonly channel: NotificationChannel;
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

/** الفاتورة وقت الإرسال `FOR SHARE`: آخر نسخة، واللي الرسالة بتقوله عنها بس (spec §8 rule 15). */
export interface InvoiceSubject {
  readonly number: string;
  readonly totalMinor: string;
  readonly currency: CurrencyCode;
  readonly currencyExponent: number;
  readonly status: "issued" | "void";
}

/** صفّي مزود العيادة ممسوكين `FOR UPDATE` (الأساسي الأول). */
export interface LockedProviders {
  readonly primary: LockedClinicProvider | null;
  readonly fallback: LockedClinicProvider | null;
}

/** صف قناة واتساب العيادة ممسوك `FOR UPDATE` (0057): الطابور بيمشي رسالة واحدة في المرة لكل عيادة. */
export interface LockedWhatsappChannel {
  readonly kind: "locked";
  readonly id: string;
  readonly sealedCredentials: string | null;
  readonly phoneNumberId: string | null;
  readonly transport: WhatsappTransport | null;
  readonly status: WhatsappStatus;
  readonly instanceName: string | null;
  /** عمود `templates` كما هو (kind → `{name, language}`)؛ بيتحقق منه وقت الاستخدام. */
  readonly templates: unknown;
  readonly nextSendAt: Date | null;
  /**
   * بعد أي محاولة إرسال: الدور الجاي للعيادة (`next_send_at`) وكود آخر فشل (أو `null` بعد نجاح).
   *
   * @param next أول وقت مسموح بالرسالة الجاية
   * @param error كود الفشل، أو `null`
   * @param at وقت المحاولة
   * @returns اكتمال كتابة الدور والكود
   */
  recordSend(next: Date, error: string | null, at: Date): Promise<void>;
  /**
   * يفصل قناة Evolution بعد إغلاق الاتصال.
   * @param at وقت الفصل
   * @returns اكتمال الكتابة
   */
  disconnect(at: Date): Promise<void>;
}

/**
 * قناة واتساب العيادة وقت الإرسال: مفيش صف (مش مربوطة)، أو صف ممسوك عند إرسال تاني لنفس العيادة دلوقتي
 * (`busy`، الرسالة تستنى دورها)، أو ممسوك لنا.
 */
export type WhatsappChannelState =
  { readonly kind: "none" } | { readonly kind: "busy" } | LockedWhatsappChannel;

/** نتيجة المحاولة اللي بتتكتب على صف الدفتر في نفس الـ transaction. */
export type LedgerOutcome =
  | {
      readonly kind: "sent";
      readonly route: NotificationRoute;
      readonly messageId?: string;
      readonly at: Date;
    }
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
    /** `patients.phone` (عنوان واتساب). عمره ما بيتسجّل. */
    readonly phone: string;
    readonly language: MessageLanguage | null;
    readonly optedOut: boolean;
  };
  /** لرسايل المواعيد؛ `null` لو الموعد مش موجود أو الرسالة وصفة. */
  readonly appointment: AppointmentSubject | null;
  /** للوصفة؛ `null` لو الزيارة مش موجودة أو مش موقّعة أو الرسالة موعد. */
  readonly visit: VisitSubject | null;
  /** للفاتورة؛ `null` لو الفاتورة مش موجودة أو الرسالة مش فاتورة. */
  readonly invoice: InvoiceSubject | null;
  /** صفّي مزود الإيميل؛ فاضيين لصف واتساب (مالوش سلسلة مزودين). */
  readonly providers: LockedProviders;
  /** لصفوف واتساب بس؛ `null` لصف إيميل. */
  readonly whatsapp: WhatsappChannelState | null;
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
  /**
   * بيقفل رابط الفاتورة الحي بتاع الرسالة دي (C1-Q4): فشل بيثبت إن الرسالة ماوصلتش.
   *
   * @param at وقت القفل
   * @returns اكتمال الكتابة
   */
  revokeInvoiceLinks(at: Date): Promise<void>;
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
   * بيمسك صف الدفتر `FOR UPDATE`، وبعدين المراجع والعيادة والإعدادات والموعد أو الزيارة `FOR SHARE`، ثم
   * لصف إيميل صفّي مزود العيادة `FOR UPDATE` (الأساسي قبل البديل)، ولصف واتساب صف قناة العيادة
   * `FOR UPDATE SKIP LOCKED`، ويشغّل `use` والكل ممسوك: أي تعديل على الموعد أو المراجع بيستنى الإرسال،
   * فاللي اتفحص هو اللي اتبعت عليه.
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
