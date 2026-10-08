import {
  isBirthDateValid,
  normalizeKuwaitPhone,
  searchDigits,
  todayInTimeZone,
  type Gender,
  type PatientInput,
  type PatientRecordActions,
  type PatientStatus,
} from "@eyadex/contracts/patients";
import type { PermissionAction } from "@eyadex/contracts/permissions";
import { maskPhone, maskPhonesInText } from "@eyadex/observability";

/** فروع الفاعل زي ما الـ guard حلّها (نفس شكل `BranchScope` في identity). */
export type MemberBranches =
  { readonly all: true } | { readonly all: false; readonly branchIds: readonly string[] };

/** نطاق فعل واحد على المراجعين: كل الفروع، أو قايمة فروع. */
export type PatientScope = MemberBranches;

/** نطاق كل فعل؛ `null` = الفاعل ما يملكش الفعل ده خالص. */
export interface PatientScopes {
  readonly view: PatientScope | null;
  readonly create: PatientScope | null;
  readonly update: PatientScope | null;
  readonly deactivate: PatientScope | null;
}

/**
 * نطاق فعل على المراجعين (PRD §4.7): مفتاح `clinic` = كل الفروع؛ مفتاح `branch` = فروع العضو (أو
 * كلها لو عضويته "كل الفروع")؛ غير كده = ممنوع. بيقرا المفاتيح الفعلية بس، عمره ما بيبص على اسم دور.
 *
 * @param permissions المفاتيح الفعلية للفاعل (من غير مفاتيح موديول مقفول)
 * @param branches فروع الفاعل
 * @param action الفعل
 * @returns النطاق، أو `null` لو مفيش صلاحية
 */
export function patientScopeFor(
  permissions: readonly string[],
  branches: MemberBranches,
  action: PermissionAction,
): PatientScope | null {
  if (permissions.includes(`${action}:patients:clinic`)) return { all: true };
  if (permissions.includes(`${action}:patients:branch`)) return branches;
  return null;
}

/**
 * نطاقات الأفعال الأربعة مرة واحدة، عشان أزرار كل سجل.
 *
 * @param permissions المفاتيح الفعلية
 * @param branches فروع الفاعل
 * @returns نطاق كل فعل
 */
export function patientScopes(
  permissions: readonly string[],
  branches: MemberBranches,
): PatientScopes {
  return {
    view: patientScopeFor(permissions, branches, "view"),
    create: patientScopeFor(permissions, branches, "create"),
    update: patientScopeFor(permissions, branches, "update"),
    deactivate: patientScopeFor(permissions, branches, "deactivate"),
  };
}

/**
 * هل النطاق ده بيغطي الفرع؟
 *
 * @param scope النطاق، أو `null`
 * @param branchId الفرع
 * @returns `true` لو مغطّي
 */
export function coversBranch(scope: PatientScope | null, branchId: string): boolean {
  if (scope === null) return false;
  return scope.all || scope.branchIds.includes(branchId);
}

/**
 * أزرار سجل واحد: الفعل مسموح وفرع الملف جوه نطاق الفعل ده بالذات.
 *
 * @param scopes نطاقات الفاعل
 * @param branchId فرع تسجيل الملف
 * @returns التعديل والأرشفة
 */
export function recordActions(scopes: PatientScopes, branchId: string): PatientRecordActions {
  return {
    update: coversBranch(scopes.update, branchId),
    deactivate: coversBranch(scopes.deactivate, branchId),
  };
}

/** كلمة البحث بعد التفكيك: نمط للاسم، وأرقام للموبايل ورقم الملف والرقم المدني. */
export interface SearchTerms {
  /** نمط `ILIKE` بحروف `%` و `_` و `\` محمية؛ `null` = مفيش بحث. */
  readonly namePattern: string | null;
  /** نمط `LIKE` للأرقام بس؛ `null` = الكلمة مافيهاش أرقام. */
  readonly digitsPattern: string | null;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * نفس قاعدة الـ mock (`matchesSearch`): الاسم بيحتوي الكلمة، أو أرقام الكلمة جوه أرقام الموبايل أو
 * رقم الملف بستة أرقام أو الرقم المدني.
 *
 * @param q الكلمة بعد الـ trim
 * @returns الأنماط
 */
export function searchTerms(q: string): SearchTerms {
  if (q === "") return { namePattern: null, digitsPattern: null };
  const digits = searchDigits(q);
  return {
    namePattern: `%${escapeLike(q)}%`,
    digitsPattern: digits === "" ? null : `%${digits}%`,
  };
}

/**
 * تاريخ الميلاد يوم حقيقي مش بعد النهارده بتوقيت العيادة (بالساعة المحقونة).
 *
 * @param birthDate YYYY-MM-DD
 * @param timeZone منطقة العيادة
 * @param now اللحظة من الـ Clock
 * @returns `true` لو مقبول؛ منطقة زمنية مش معروفة = مرفوض
 */
export function isBirthDateAllowed(birthDate: string, timeZone: string, now: Date): boolean {
  let today: string;
  try {
    today = todayInTimeZone(timeZone, now);
  } catch {
    return false;
  }
  return isBirthDateValid(birthDate, today);
}

/** المدخل بعد التطبيع: الموبايل بالشكل `+965XXXXXXXX`، والرقم المدني الفاضي `null`. */
export interface NormalizedPatient {
  readonly fullName: string;
  readonly phone: string;
  readonly birthDate: string;
  readonly gender: Gender;
  readonly registrationBranchId: string;
  readonly civilId: string | null;
}

/**
 * بيطبّع مدخل عدّى الـ contract. موبايل مايتطبّعش = `null` (المنادي بيرفض بـ validation).
 *
 * @param input المدخل بعد `patientInputSchema`
 * @returns المدخل المطبّع، أو `null`
 */
export function normalizePatientInput(input: PatientInput): NormalizedPatient | null {
  const phone = normalizeKuwaitPhone(input.phone);
  if (phone === null) return null;
  return {
    fullName: input.fullName,
    phone,
    birthDate: input.birthDate,
    gender: input.gender,
    registrationBranchId: input.registrationBranchId,
    civilId: input.civilId === "" ? null : input.civilId,
  };
}

/** ملف كما القرارات والسجل محتاجينه. */
export interface PatientRecord extends NormalizedPatient {
  readonly id: string;
  readonly fileNumber: number;
  readonly status: PatientStatus;
}

/** لقطة سجل التدقيق: قايمة حقول مسموحة بس. */
export interface PatientAuditSnapshot {
  readonly id: string;
  readonly fileNumber: number;
  readonly fullName: string;
  readonly phone: string;
  readonly gender: Gender;
  readonly registrationBranchId: string;
  readonly status: PatientStatus;
}

/**
 * لقطة "قبل/بعد" لسجل التدقيق (PRD §4.11، CLAUDE.md §5): الرقم المدني مش موجود بأي شكل، والموبايل
 * آخر 3 أرقام بس، وأي رقم موبايل مكتوب جوه الاسم بيتغطّى. تاريخ الميلاد برة القايمة كمان: سياسة
 * التنقية (ADR-0001) بتشيله من أي سجل محفوظ، فالقايمة نفسها ماتسيبش حاجة تتشال بعدين.
 *
 * @param patient الملف
 * @returns اللقطة
 */
export function patientAuditSnapshot(patient: PatientRecord): PatientAuditSnapshot {
  return {
    id: patient.id,
    fileNumber: patient.fileNumber,
    fullName: maskPhonesInText(patient.fullName),
    phone: maskPhone(patient.phone),
    gender: patient.gender,
    registrationBranchId: patient.registrationBranchId,
    status: patient.status,
  };
}

/** ملف موجود بنفس الموبايل أو الرقم المدني. */
export interface DuplicateFile {
  readonly id: string;
  readonly fileNumber: number;
  readonly registrationBranchId: string;
}

/**
 * التكرار بيتكشف بس لفاعل يقدر يفتح الملف الموجود (نفس قاعدة الـ mock)؛ غيره بياخد validation عادي،
 * فمفيش ملف مخفي بيتأكد وجوده لحد.
 *
 * @param existing الملف الموجود
 * @param view نطاق العرض للفاعل
 * @returns `taken` بالـ id ورقم الملف، أو `hidden`
 */
export function duplicateDisclosure(
  existing: DuplicateFile,
  view: PatientScope | null,
):
  | { readonly kind: "taken"; readonly patientId: string; readonly fileNumber: number }
  | {
      readonly kind: "hidden";
    } {
  if (!coversBranch(view, existing.registrationBranchId)) return { kind: "hidden" };
  return { kind: "taken", patientId: existing.id, fileNumber: existing.fileNumber };
}
