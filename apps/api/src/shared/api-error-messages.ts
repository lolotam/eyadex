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
  unknown: { message_ar: "حدث خطأ ما", message_en: "Something went wrong" },
} satisfies Record<ApiErrorCode, { message_ar: string; message_en: string }>;
