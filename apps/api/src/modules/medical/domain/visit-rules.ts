import type { VisitStatus } from "@eyadex/contracts/visits";

import type { ApiErrorCode } from "@eyadex/contracts/common";

/** فروع العضو: كل الفروع، أو قايمة فروع (نفس شكل `BranchScope` في identity). */
export type MemberBranches =
  { readonly all: true } | { readonly all: false; readonly branchIds: readonly string[] };

/** فاعل على الزيارات: عيادته وعضويته، مفاتيحه الفعلية (بعد الموديولات المقفولة)، فروعه ولغته. */
export interface MedicalActor {
  readonly clinicId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly language: "ar" | "en";
  readonly permissions: readonly string[];
  readonly member: MemberBranches;
}

/**
 * وصول عرض الزيارات (spec §2): `clinic` = كل الزيارات، `branch` = زيارات فروع العضو، `own` = كل زيارات
 * مراجعين الفاعل (P2-4، حتى اللي كتبها دكتور تاني)، غير كده مفيش.
 */
export type VisitReach = MemberBranches | { readonly own: string };

/** وصول المحتوى الطبي: كل مراجعين العيادة، أو مراجعين الفاعل بس (`own`). مفيش نطاق `branch`. */
export type MedicalReach = { readonly all: true } | { readonly own: string };

/**
 * وصول عرض الزيارات من مفاتيح الفاعل، الأوسع يكسب (PRD §4.7).
 *
 * @param actor الفاعل
 * @returns الوصول، أو `null` لو مالوش أي مفتاح عرض زيارات
 */
export function visitViewReach(actor: MedicalActor): VisitReach | null {
  if (actor.permissions.includes("view:visits:clinic")) return { all: true };
  if (actor.permissions.includes("view:visits:branch")) return actor.member;
  if (actor.permissions.includes("view:visits:own")) return { own: actor.membershipId };
  return null;
}

/**
 * وصول المحتوى الطبي لفعل (عرض أو تعديل)، الأوسع يكسب: `clinic` ثم `own` (P2-5: من غير مفتاح = مفيش).
 *
 * @param actor الفاعل
 * @param action `view` أو `update`
 * @returns الوصول، أو `null`
 */
export function medicalReach(actor: MedicalActor, action: "view" | "update"): MedicalReach | null {
  if (actor.permissions.includes(`${action}:medical:clinic`)) return { all: true };
  if (actor.permissions.includes(`${action}:medical:own`)) return { own: actor.membershipId };
  return null;
}

/**
 * هل وصول العرض بيشوف الزيارة؟ بفرع الزيارة، أو تحت `own` لما المراجع يكون من مراجعين الفاعل.
 *
 * @param reach وصول العرض
 * @param visit فرع الزيارة
 * @param patientIsOwn المراجع من مراجعين الفاعل (موعد مش ملغي أو أي زيارة معاه، R1-18)
 * @returns `true` لو ظاهرة
 */
export function visitReachSees(
  reach: VisitReach | null,
  visit: { readonly branchId: string },
  patientIsOwn: boolean,
): boolean {
  if (reach === null) return false;
  if ("own" in reach) return patientIsOwn;
  return reach.all || reach.branchIds.includes(visit.branchId);
}

/**
 * علاقة الفاعل بملف مراجع واحد: هل هو من مراجعينه (`own`، spec §2)، وهل نطاق عرض المراجعين بتاعه
 * (`view:patients:*`، نفس قاعدة `GET /patients/:id`) بيشوفه.
 */
export interface FileAccess {
  /** المراجع من مراجعين الفاعل: موعد مش ملغي أو أي زيارة معاه (R1-18). */
  readonly own: boolean;
  /** نطاق عرض المراجعين بيشوف الملف؛ موديول المراجعين مقفول = مفيش نطاق (قرار المالك 2026-10-11). */
  readonly inPatientReach: boolean;
}

/**
 * هل وصول المحتوى بيغطي ملف المراجع ده؟ المحتوى الطبي جوه نطاق المراجعين دايمًا (قرار المالك
 * 2026-10-11): ملف برّه نطاق عرض المراجعين مش مغطّي، أيًا كان مفتاح الطب.
 *
 * @param reach وصول المحتوى
 * @param file علاقة الفاعل بالملف
 * @returns `true` لو مغطّي
 */
export function medicalReachCovers(reach: MedicalReach | null, file: FileAccess): boolean {
  if (reach === null || !file.inPatientReach) return false;
  return "all" in reach || file.own;
}

/**
 * P2-2: زيارة من موعد محتاجة الفاعل يكون مقدّم خدمة الموعد، والمراجع يكون وصل.
 *
 * @param appointment حالة الموعد ومقدّم خدمته
 * @param membershipId عضوية الفاعل
 * @returns `null` = مسموح، أو كود الرفض
 */
export function startFromAppointmentProblem(
  appointment: { readonly status: string; readonly providerMembershipId: string },
  membershipId: string,
): ApiErrorCode | null {
  if (appointment.providerMembershipId !== membershipId) return "forbidden";
  if (appointment.status !== "arrived") return "appointment_not_arrived";
  return null;
}

/** الكتابات على زيارة موجودة؛ التشخيصات والروشتة زي الملاحظة: المسودة بس. */
export type VisitWrite = "note" | "diagnoses" | "prescription" | "sign" | "cancel" | "addendum";

/**
 * P2-3، P2-6: مقدّم خدمة الزيارة بس اللي بيكتب؛ المسودة بتتعدل وتتعتمد وتتلغي، والمعتمدة بتاخد ملحق بس،
 * والملغية مابتتغيرش.
 *
 * @param visit حالة الزيارة ومقدّم خدمتها
 * @param membershipId عضوية الفاعل
 * @param write الكتابة المطلوبة
 * @returns `null` = مسموح، أو كود الرفض
 */
export function visitWriteProblem(
  visit: { readonly status: VisitStatus; readonly providerMembershipId: string },
  membershipId: string,
  write: VisitWrite,
): ApiErrorCode | null {
  if (visit.providerMembershipId !== membershipId) return "visit_not_provider";
  if (visit.status === "cancelled") return "invalid_transition";
  if (write === "addendum") return visit.status === "signed" ? null : "visit_not_signed";
  return visit.status === "signed" ? "visit_signed" : null;
}

/** أقسام الملاحظة الأربعة بالترتيب، زي `visitNoteInputSchema`. */
export const NOTE_SECTIONS = ["complaint", "examination", "assessment", "plan"] as const;
export type NoteSection = (typeof NOTE_SECTIONS)[number];
export type NoteText = Readonly<Record<NoteSection, string | null>>;

/** ملاحظة فاضية: كل الأقسام `null`. */
export const EMPTY_NOTE: NoteText = {
  complaint: null,
  examination: null,
  assessment: null,
  plan: null,
};

/**
 * قسم فاضي بيتخزّن `null` (R1-8): نص من مسافات بس مالوش معنى.
 *
 * @param text النص بعد العقد
 * @returns النص، أو `null` لو فاضي
 */
export function sectionValue(text: string | null): string | null {
  return text === null || text.trim() === "" ? null : text;
}

/**
 * spec §4: الاعتماد محتاج قسم ملاحظة واحد على الأقل مش فاضي أو تشخيص واحد.
 *
 * @param note أقسام الملاحظة
 * @param diagnosisCount عدد التشخيصات النشطة
 * @returns `true` لو تتعتمد
 */
export function isSignable(note: NoteText, diagnosisCount: number): boolean {
  return diagnosisCount > 0 || NOTE_SECTIONS.some((s) => sectionValue(note[s]) !== null);
}

/**
 * أسماء الحقول اللي اتغيرت بس، عشان السجل يقول إيه اتغير من غير القيمة نفسها (R3-4).
 *
 * @param before القيم قبل
 * @param after القيم بعد
 * @returns أسماء الحقول المتغيرة بترتيب `after`
 */
export function changedFields(
  before: Readonly<Record<string, string | null>>,
  after: Readonly<Record<string, string | null>>,
): string[] {
  return Object.keys(after).filter((key) => (before[key] ?? null) !== (after[key] ?? null));
}

/** اللي الصفحة تقدر تعرضه للفاعل على الزيارة (UX بس: كل كتابة بتتفحص تاني). */
export interface VisitAbilities {
  readonly edit: boolean;
  readonly sign: boolean;
  readonly cancel: boolean;
  readonly addAddendum: boolean;
}

/**
 * الأزرار: مقدّم الخدمة اللي وصول `update:medical:*` بتاعه بيغطي ملف المراجع (جوه نطاق المراجعين، قرار
 * المالك 2026-10-11، زي `lockVisitForWrite`)، بحالة الزيارة، والاعتماد لما فيه محتوى.
 *
 * @param actor الفاعل
 * @param visit حالة الزيارة ومقدّم خدمتها
 * @param file علاقة الفاعل بملف المراجع
 * @param signable فيها محتوى يتعتمد (`isSignable`)
 * @returns الأزرار
 */
export function visitAbilities(
  actor: MedicalActor,
  visit: { readonly status: VisitStatus; readonly providerMembershipId: string },
  file: FileAccess,
  signable: boolean,
): VisitAbilities {
  const may = (write: VisitWrite) =>
    medicalReachCovers(medicalReach(actor, "update"), file) &&
    visitWriteProblem(visit, actor.membershipId, write) === null;
  return {
    edit: may("note"),
    sign: may("sign") && signable,
    cancel: may("cancel"),
    addAddendum: may("addendum"),
  };
}

/**
 * زرار المرفقات في صفحة الزيارة بنفس قاعدة رفعها (`Attachments.uploadTarget`): وصول `update:medical:*`
 * بيغطي المراجع والملف نشط. مش مربوط بمقدّم الخدمة ولا بحالة الزيارة، فالزيارة المعتمدة بتاخد مرفق.
 *
 * @param actor الفاعل
 * @param file علاقة الفاعل بالملف
 * @param patientActive ملف المراجع نشط
 * @returns `true` لو يقدر يرفع ويأرشف
 */
export function mayAttach(actor: MedicalActor, file: FileAccess, patientActive: boolean): boolean {
  return patientActive && medicalReachCovers(medicalReach(actor, "update"), file);
}

/**
 * P2-2، R3-1: الزيارة المباشرة في فرع الفاعل شغّال فيه.
 *
 * @param member فروع الفاعل
 * @param branchId الفرع
 * @returns `true` لو شغّال فيه
 */
export function worksIn(member: MemberBranches, branchId: string): boolean {
  return member.all || member.branchIds.includes(branchId);
}

/**
 * الزيارة المباشرة لملف من ملفات الفرع نفسه، زي ما بحث الزيارة المباشرة بيلاقيه (R3-1). ملف فرع تاني
 * مش ظاهر للفاعل (`not_found`، زي موديول المراجعين)، فمفيش زيارة بتخلّي أي ملف في العيادة "بتاعه".
 *
 * @param patient فرع تسجيل الملف
 * @param branchId فرع الزيارة
 * @returns `true` لو مسموح
 */
export function walkInReaches(
  patient: { readonly registrationBranchId: string },
  branchId: string,
): boolean {
  return patient.registrationBranchId === branchId;
}
