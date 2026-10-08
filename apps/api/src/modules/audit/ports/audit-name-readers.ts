import type { Tx } from "@eyadex/db";

/** اسم بالعربي والإنجليزي (دور، فرع، عيادة). */
export interface BilingualName {
  readonly nameAr: string;
  readonly nameEn: string;
}

/** عضو في العيادة ليه اسم القارئ يقدر يشوفه. */
export interface MemberName {
  readonly userId: string;
  readonly fullName: string;
}

/**
 * أسماء أعضاء العيادة (جدول العضويات، ملك identity). الـ port ده بتاع السجل، و identity هي اللي
 * بتنفّذه (`PgMemberNames`)، فالسجل مابيقراش جدول موديول تاني مباشرة (apps/api/AGENTS.md).
 */
export interface AuditMemberNameReader {
  /**
   * كل أعضاء العيادة (أي حالة)، لبحث الفاعل بالاسم المعروض.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @returns الأعضاء
   */
  allOf(tx: Tx, clinicId: string): Promise<readonly MemberName[]>;

  /**
   * أسماء مجموعة فاعلين في نداء واحد (صفحة كاملة من السجل، من غير N+1).
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param userIds الفاعلين (التكرار مسموح)
   * @returns الاسم لكل فاعل عضو في العيادة
   */
  namesOf(
    tx: Tx,
    clinicId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

/**
 * أسماء الأدوار (ملك identity، `PgRoleNames`) أو الفروع (ملك tenancy، `PgFilingBranches`) اللي
 * اللقطات بتشاور عليها.
 */
export interface AuditRefNameReader {
  /**
   * الاسمين لمجموعة ids في نداء واحد.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param ids الـ ids (التكرار مسموح)
   * @returns الاسمين لكل id موجود في العيادة
   */
  namesOf(
    tx: Tx,
    clinicId: string,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, BilingualName>>;
}

/** اللي السجل محتاجه من جدول العيادات (ملك tenancy، `PgClinicNames`). */
export interface AuditClinicReader {
  /**
   * المنطقة الزمنية للعيادة، لفلتر الأيام.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @returns اسم المنطقة (IANA)، أو `null` لو العيادة مش ظاهرة في السياق ده
   */
  timeZoneOf(tx: Tx, clinicId: string): Promise<string | null>;

  /**
   * أسماء مجموعة عيادات في نداء واحد (صفحة من سجل المنصة).
   *
   * @param tx الـ transaction على pool المنصة (`withNoTenant`)
   * @param clinicIds العيادات (التكرار مسموح)
   * @returns الاسمين لكل عيادة ظاهرة
   */
  namesOf(tx: Tx, clinicIds: readonly string[]): Promise<ReadonlyMap<string, BilingualName>>;

  /**
   * كل العيادات بالاسمين، مرتبة بالاسم الإنجليزي ثم الـ id، لفلتر العيادة في سجل المنصة.
   *
   * @param tx الـ transaction على pool المنصة (`withNoTenant`)
   * @returns العيادات
   */
  listOptions(tx: Tx): Promise<readonly (BilingualName & { readonly id: string })[]>;
}

/** كل قرّاء الأسماء اللي السجل محتاجهم، متربطين في `audit.module.ts` بس. */
export interface AuditNameReaders {
  readonly members: AuditMemberNameReader;
  readonly roles: AuditRefNameReader;
  readonly branches: AuditRefNameReader;
  readonly clinics: AuditClinicReader;
}

/** Token الـ DI لقرّاء الأسماء. */
export const AUDIT_NAME_READERS = Symbol("audit.AuditNameReaders");
