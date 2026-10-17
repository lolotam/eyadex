import type { ApiErrorCode } from "@eyadex/contracts/common";

/**
 * The bilingual text the API puts in the error envelope (CLAUDE.md §6). It is the same wording the web app
 * shows in a toast, so a user reads one sentence whether the failure came from the mock or from the API.
 *
 * TODO(spec) — this table repeats apps/web's i18n `errors` block because packages/contracts cannot be
 * imported at runtime yet (see config.ts). When it can, this file becomes the single source and the web
 * dictionary reads from it. Until then `Record<ApiErrorCode, …>` makes TypeScript fail if a code is added to
 * the contract without a message here.
 *
 * TODO(spec) — `role_in_use` carries a `{count}` placeholder: the client fills it from `details`, since the
 * count is per request and the envelope's text is a static fallback.
 */
export const API_ERROR_MESSAGES = {
  not_found: { message_ar: "غير موجود", message_en: "Not found" },
  unauthorized: { message_ar: "سجّل الدخول للمتابعة", message_en: "Sign in to continue" },
  two_factor_required: {
    message_ar: "فعّل التحقق بخطوتين لحسابك قبل المتابعة",
    message_en: "Turn on two-step verification for your account to continue",
  },
  invalid_credentials: {
    message_ar: "البيانات غير صحيحة، تأكد منها وأعد المحاولة",
    message_en: "Those details are not correct; check them and try again",
  },
  invitation_invalid: {
    message_ar: "رابط الدعوة غير صالح أو انتهت صلاحيته، اطلب من مدير العيادة دعوة جديدة",
    message_en:
      "This invitation link is not valid or has expired; ask the clinic admin for a new invitation",
  },
  account_other_area: {
    message_ar: "هذا البريد مستخدم لحساب في منطقة أخرى، اطلب دعوة ببريد مختلف",
    message_en:
      "This email belongs to an account in another area; ask for an invitation with a different email",
  },
  rate_limited: {
    message_ar: "محاولات كثيرة، انتظر قليلًا ثم أعد المحاولة",
    message_en: "Too many attempts; wait a moment and try again",
  },
  two_factor_busy: {
    message_ar: "يوجد إعداد آخر للتحقق بخطوتين قيد التنفيذ، انتظر قليلًا ثم أعد المحاولة",
    message_en: "Another two-step verification setup is in progress; wait a moment and try again",
  },
  idempotency_conflict: {
    message_ar: "تم إرسال هذا الطلب من قبل ببيانات مختلفة، أغلق النموذج وابدأ من جديد",
    message_en:
      "This request was already sent with different details; close the form and start again",
  },
  slug_taken: {
    message_ar: "هذا المعرّف مستخدم لعيادة أخرى",
    message_en: "This slug is already used by another clinic",
  },
  reserved_slug: {
    message_ar: "هذا العنوان محجوز لمنصة Eyadex",
    message_en: "This address is reserved by Eyadex",
  },
  limit_below_usage: {
    message_ar: "لا يمكن أن تكون الحدود أقل من الاستخدام الحالي",
    message_en: "Limits cannot be lower than current usage",
  },
  limit_reached: {
    message_ar: "تم الوصول للحد المسموح للعيادة",
    message_en: "The clinic limit has been reached",
  },
  branch_has_exclusive_members: {
    message_ar: "بعض المستخدمين ليس لهم فرع نشط غير هذا الفرع؛ أكّد الإيقاف للمتابعة",
    message_en: "Some users have no other active branch; confirm to deactivate it",
  },
  last_active_branch: {
    message_ar: "لا يمكن إيقاف آخر فرع نشط للعيادة",
    message_en: "The clinic's last active branch cannot be deactivated",
  },
  forbidden: {
    message_ar: "غير مسموح لك بهذا الإجراء",
    message_en: "You are not allowed to do this",
  },
  module_disabled: {
    message_ar: "هذا الموديول متوقف لهذه العيادة",
    message_en: "This module is turned off for the clinic",
  },
  validation: { message_ar: "بعض الحقول غير صحيحة", message_en: "Some fields are invalid" },
  email_taken: {
    message_ar: "هذا البريد مستخدم لدى مستخدم آخر أو في دعوة معلّقة",
    message_en: "This email already belongs to a user or a pending invitation",
  },
  last_active_admin: {
    message_ar: "لا يمكن تعطيل آخر مدير نشط للعيادة أو نقله إلى دور آخر",
    message_en: "The clinic's last active admin cannot be deactivated or moved to another role",
  },
  account_disabled: {
    message_ar: "تم تعطيل هذا الحساب",
    message_en: "This account has been deactivated",
  },
  subscription_blocked: {
    message_ar: "اشتراك العيادة لا يسمح بالدخول حاليًا",
    message_en: "The clinic's subscription does not allow access right now",
  },
  role_inactive: {
    message_ar: "لا يمكن إسناد دور معطّل",
    message_en: "A deactivated role cannot be assigned",
  },
  branch_inactive: {
    message_ar: "لا يمكن إسناد فرع معطّل",
    message_en: "A deactivated branch cannot be assigned",
  },
  invitation_expired: {
    message_ar: "انتهت صلاحية هذه الدعوة",
    message_en: "This invitation has expired",
  },
  invitation_cancelled: {
    message_ar: "تم إلغاء هذه الدعوة",
    message_en: "This invitation was cancelled",
  },
  invitation_used: {
    message_ar: "تم استخدام هذه الدعوة من قبل",
    message_en: "This invitation was already used",
  },
  role_locked: {
    message_ar: "دور مدير العيادة مقفل ولا يمكن تعديله أو تعطيله",
    message_en: "The Clinic Admin role is locked and cannot be changed or deactivated",
  },
  role_in_use: {
    message_ar:
      "هذا الدور مُسند إلى {count} من المستخدمين (بمن فيهم المعطّلون). انقلهم إلى دور آخر أولًا",
    message_en:
      "This role is held by {count} users, deactivated ones included. Move them to another role first",
  },
  role_name_taken: {
    message_ar: "يوجد دور آخر في العيادة بهذا الاسم",
    message_en: "Another role in this clinic already uses this name",
  },
  patient_phone_taken: {
    message_ar: "هذا الهاتف مسجّل لمراجع آخر في هذه العيادة",
    message_en: "This phone already belongs to another patient in this clinic",
  },
  patient_civil_id_taken: {
    message_ar: "هذا الرقم المدني مسجّل لمراجع آخر في هذه العيادة",
    message_en: "This civil ID already belongs to another patient in this clinic",
  },
  last_active_platform_account: {
    message_ar: "لا يمكن تعطيل آخر حساب نشط في المنصة",
    message_en: "The last active platform account cannot be deactivated",
  },
  service_name_taken: {
    message_ar: "توجد خدمة أخرى في العيادة بهذا الاسم",
    message_en: "Another service in this clinic already uses this name",
  },
  schedule_overlap: {
    message_ar: "فترات العمل تتداخل مع فترة أخرى لنفس الشخص",
    message_en: "These working hours overlap another period of the same person",
  },
  provider_not_bookable: {
    message_ar: "هذا المستخدم غير متاح للحجز؛ فعّل استقبال المواعيد له أولًا",
    message_en: "This user cannot be booked; turn on accepting appointments for them first",
  },
  provider_not_in_branch: {
    message_ar: "هذا المستخدم لا يعمل في هذا الفرع",
    message_en: "This user does not work in this branch",
  },
  outside_schedule: {
    message_ar: "الموعد خارج ساعات عمل مقدّم الخدمة في هذا الفرع",
    message_en: "The appointment is outside the provider's working hours in this branch",
  },
  provider_time_off: {
    message_ar: "مقدّم الخدمة في إجازة في هذا الوقت",
    message_en: "The provider is on time off at this time",
  },
  appointment_overlap: {
    message_ar: "مقدّم الخدمة لديه موعد آخر في هذا الوقت",
    message_en: "The provider already has another appointment at this time",
  },
  patient_inactive: {
    message_ar: "ملف المراجع مؤرشف؛ استرجعه قبل الحجز",
    message_en: "The patient's file is archived; restore it before booking",
  },
  service_inactive: {
    message_ar: "هذه الخدمة معطّلة",
    message_en: "This service is inactive",
  },
  invalid_transition: {
    message_ar: "لا يمكن نقل الموعد إلى هذه الحالة من حالته الحالية",
    message_en: "The appointment cannot move to this status from its current one",
  },
  appointment_not_arrived: {
    message_ar: "لا تبدأ الزيارة إلا بعد تسجيل وصول المراجع للموعد",
    message_en: "A visit starts only once the patient has arrived for the appointment",
  },
  visit_exists: {
    message_ar: "توجد زيارة لهذا الموعد بالفعل",
    message_en: "This appointment already has a visit",
  },
  visit_signed: {
    message_ar: "الزيارة موقّعة ولا يمكن تعديلها؛ أضف ملحقًا بدلًا من ذلك",
    message_en: "The visit is signed and cannot be changed; add an addendum instead",
  },
  visit_not_signed: {
    message_ar: "لا يمكن إضافة ملحق قبل توقيع الزيارة",
    message_en: "An addendum can be added only after the visit is signed",
  },
  visit_not_provider: {
    message_ar: "مقدّم الخدمة في الزيارة فقط يمكنه تعديلها أو توقيعها",
    message_en: "Only the visit's provider can change or sign it",
  },
  visit_empty: {
    message_ar: "اكتب شيئًا في ملاحظة الزيارة قبل توقيعها",
    message_en: "Write something in the visit note before signing it",
  },
  icd10_unknown: {
    message_ar: "رمز ICD-10-CM غير موجود في القائمة",
    message_en: "This ICD-10-CM code is not in the list",
  },
  medicine_name_taken: {
    message_ar: "يوجد دواء آخر في قائمة العيادة بهذا الاسم",
    message_en: "Another medicine in the clinic list already uses this name",
  },
  attachment_too_large: {
    message_ar: "الملف أكبر من 20 ميجابايت",
    message_en: "The file is larger than 20 MB",
  },
  attachment_type: {
    message_ar: "نوع الملف غير مدعوم؛ ارفع صورة JPEG أو PNG أو WebP أو ملف PDF",
    message_en: "This file type is not supported; upload a JPEG, PNG or WebP image or a PDF",
  },
  attachment_patient_mismatch: {
    message_ar: "هذه الزيارة لا تخص ملف هذا المراجع",
    message_en: "This visit does not belong to this patient's file",
  },
  role_self_change: {
    message_ar: "لا يمكنك تغيير دورك بنفسك",
    message_en: "You cannot change your own role",
  },
  price_missing: {
    message_ar: "لا يوجد سعر لهذه الخدمة؛ أضف السعر من إعدادات الخدمات أولًا",
    message_en: "This service has no price; set it in the services settings first",
  },
  invoice_prefix_missing: {
    message_ar: "حدد بادئة الفواتير لهذا الفرع قبل إصدار أول فاتورة",
    message_en: "Set this branch's invoice prefix before issuing its first invoice",
  },
  invoice_prefix_locked: {
    message_ar: "لا يمكن تغيير بادئة الفواتير بعد إصدار أول فاتورة في الفرع",
    message_en: "The invoice prefix cannot change after the branch's first invoice",
  },
  invoice_prefix_taken: {
    message_ar: "هذه البادئة مستخدمة لفرع آخر في العيادة",
    message_en: "Another branch of the clinic uses or used this prefix",
  },
  invoice_already_exists: {
    message_ar: "يوجد بالفعل فاتورة لهذا الموعد أو لهذه الزيارة",
    message_en: "An invoice already exists for this appointment or visit",
  },
  invoice_void: {
    message_ar: "هذه الفاتورة ملغاة ولا يمكن تعديلها",
    message_en: "This invoice is void and cannot be changed",
  },
  appointment_not_billable: {
    message_ar:
      "لا يمكن إصدار فاتورة من موعد لم يحضره المراجع أو أُلغي؛ أصدر فاتورة يدوية عند الحاجة",
    message_en:
      "A no-show or cancelled appointment has no invoice of its own; issue a manual invoice",
  },
  currency_locked: {
    message_ar: "لا يمكن تغيير العملة بعد تسعير خدمة أو إصدار فاتورة",
    message_en: "The currency cannot change once a price or an invoice exists",
  },
  currency_unsupported: {
    message_ar: "هذه العملة غير مدعومة",
    message_en: "This currency is not supported",
  },
  discount_exceeds_total: {
    message_ar: "الخصم أكبر من قيمة الفاتورة",
    message_en: "The discount is larger than the invoice amount",
  },
  discount_reason_required: {
    message_ar: "اكتب سبب الخصم",
    message_en: "Write the reason for the discount",
  },
  precondition_required: {
    message_ar: "أعد تحميل الفاتورة ثم أعد المحاولة",
    message_en: "Reload the invoice, then try again",
  },
  version_conflict: {
    message_ar: "عدّل شخص آخر هذه الفاتورة للتو؛ أعد تحميلها ثم أعد المحاولة",
    message_en: "Someone else just changed this invoice; reload it and try again",
  },
  send_request_conflict: {
    message_ar: "طلب الإرسال هذا مستخدم لفاتورة أو قناة أخرى",
    message_en: "This send request was already used for another invoice or channel",
  },
  invoice_link_expired: {
    message_ar: "رابط الفاتورة غير صالح أو انتهت صلاحيته؛ اطلب رابطاً جديداً من العيادة",
    message_en: "This invoice link is no longer valid; ask the clinic for a new one",
  },
  unknown: { message_ar: "حدث خطأ ما", message_en: "Something went wrong" },
} satisfies Record<ApiErrorCode, { message_ar: string; message_en: string }>;
