import type { Tx } from "@eyadex/db";

import type { FileAccess, MemberBranches } from "../domain/visit-rules.ts";

/** ملف مراجع زي ما موديول الطب محتاجه: اسمه ورقم ملفه وفرع تسجيله وحالته. مفيش تليفون ولا رقم مدني. */
export interface MedicalPatient {
  readonly id: string;
  readonly fullName: string;
  readonly fileNumber: number;
  readonly registrationBranchId: string;
  readonly active: boolean;
}

/** الفاعل زي ما نطاق عرض المراجعين محتاجه: مفاتيحه الفعلية وفروعه وعضويته. */
export interface PatientViewer {
  readonly permissions: readonly string[];
  readonly member: MemberBranches;
  readonly membershipId: string;
}

/** مرشّح للزيارة المباشرة: الاسم ورقم الملف بس (R3-1). */
export interface WalkInCandidate {
  readonly patientId: string;
  readonly fullName: string;
  readonly fileNumber: number;
}

/**
 * اللي موديول الطب محتاجه من ملفات المراجعين (ملك patients)، جوه الـ transaction بتاعته. الـ port ده بتاع
 * الطب، وموديول المراجعين بينفّذه (`PgMedicalPatients`)، والربط في `medical.module.ts` بس (ADR-0029).
 */
export interface MedicalPatientReader {
  /**
   * الملف من غير قفل (للقراية).
   *
   * @param tx transaction الطب جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param patientId الملف
   * @returns الملف، أو `null` لو مش ملف في العيادة دي
   */
  find(tx: Tx, clinicId: string, patientId: string): Promise<MedicalPatient | null>;

  /**
   * الملف وصفّه مقفول `FOR SHARE` لحد آخر الـ transaction (ترتيب الأقفال ADR-0027: بعد صف العضوية وقبل
   * صف الفرع)، فأرشفته بالتوازي بتستنى، والصف اللي بيشاور عليه عمره ما يتكتب على ملف اتغير.
   *
   * @param tx transaction الطب جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param patientId الملف
   * @returns الملف، أو `null`
   */
  lockForVisit(tx: Tx, clinicId: string, patientId: string): Promise<MedicalPatient | null>;

  /**
   * أسماء وأرقام ملفات في جملة واحدة.
   *
   * @param tx transaction الطب
   * @param clinicId العيادة
   * @param patientIds الملفات
   * @returns كل ملف موجود بالمعرّف بتاعه
   */
  labels(
    tx: Tx,
    clinicId: string,
    patientIds: readonly string[],
  ): Promise<ReadonlyMap<string, MedicalPatient>>;

  /**
   * علاقة الفاعل بالملف، محسوبة دلوقتي جوه نفس الـ transaction بقواعد موديول المراجعين نفسها: `own`
   * (موعد مش ملغي أو أي زيارة معاه بأي حالة، R1-18) وهل نطاق عرض المراجعين بيشوفه (`GET /patients/:id`،
   * قرار المالك 2026-10-11). ملف مش موجود = الاتنين `false`.
   *
   * @param tx transaction الطب
   * @param clinicId العيادة
   * @param viewer الفاعل
   * @param patientId الملف
   * @returns العلاقة
   */
  access(tx: Tx, clinicId: string, viewer: PatientViewer, patientId: string): Promise<FileAccess>;

  /**
   * ملفات نشطة متسجّلة في الفرع، بالاسم أو رقم الملف بس (مش التليفون ولا الرقم المدني)، 20 بالكتير.
   *
   * @param tx transaction الطب
   * @param clinicId العيادة
   * @param branchId فرع التسجيل
   * @param q كلمة البحث بعد العقد
   * @returns المرشّحين بالاسم
   */
  walkInCandidates(
    tx: Tx,
    clinicId: string,
    branchId: string,
    q: string,
  ): Promise<readonly WalkInCandidate[]>;
}
