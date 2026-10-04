import { sql } from "drizzle-orm";
import { systemUuidV7 } from "@eyadex/ids";
import postgres, { type Sql } from "postgres";

import { requireTestUrls } from "./test-urls.ts";

/** مولّد UUID v7 الحقيقي — نفس اللي بيتحقن في الإنتاج، عشان الـ fixtures تبقى متسلسلة زي البيانات. */
export const newTestId = systemUuidV7().newId;

/**
 * قايمة ids جاهزة للـ `IN`. لازم `sql.join`، لأن Drizzle بتفكّر الـ array JS سجلّ واحد فتبني
 * `IN (($1, $2))` (وPostgreSQL يقول `uuid = record`) — فبنبني قايمة placeholders مربوطة بنفسها.
 *
 * @param ids القيم اللي داخل الـ `IN`
 * @returns جزء SQL قابل للدمج جوّه query تانية
 */
export const idList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql.raw(", "),
  );

/** عيادة واحدة ومالهاش أي علاقة بغيرها: كل test بيبني اتنين وبيقرا غيره. */
export interface ClinicFixture {
  readonly clinicId: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly roleId: string;
  /** hash الدعوة المولّد من الـ test — مش token حقيقي، ومحدش بيعرفه غير الاختبار. */
  readonly invitationTokenHash: string;
}

/** روابط الدور الواحد: owner للـ fixtures والقرارات، والدورين التشغيليين للـ wrappers. */
export const TEST_URLS = requireTestUrls();

/**
 * owner بـ pool من connection واحدة. الـ owner مش دور تشغيل (CLAUDE.md §5)، فبنستعمله للـ fixtures
 * ونتأكّد من النتيجة من برّه — مش عشان التطبيق يوصله.
 *
 * @returns عميل postgres مربوط بالـ owner
 */
export const createOwner = (): Sql =>
  postgres(TEST_URLS.ownerUrl, { max: 1, onnotice: () => undefined });

/**
 * بيبني عيارَتين (A و B) بكل صفوفهم: عيادة + فرع + دور + مراجع + دعوة pending. كل الـ ids جديدة في
 * كل تشغيل، لأن الداتابيز مش فاضية وماينفعش نفترض emptiness ولا نمسح.
 *
 * الـ owner هو اللي بيعمل الكتابة، فترiggers الـ email-hold (0017) مش بتأثر: هي بتتحقق `current_user`
 * والـ owner مش من أدوار الـ runtime.
 *
 * @param owner عميل الـ owner
 * @returns العيارتين A و B
 */
export const seedTwoClinics = async (owner: Sql): Promise<[ClinicFixture, ClinicFixture]> => {
  const clinics: ClinicFixture[] = [];
  for (const letter of ["a", "b"] as const) {
    const clinicId = newTestId();
    const branchId = newTestId();
    const roleId = newTestId();
    const patientId = newTestId();
    const tokenHash = `b3a-${clinicId}`;
    await owner.begin(async (tx) => {
      await tx`INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language,
          timezone, status, expires_at, max_users, max_branches, created_at, updated_at)
        VALUES (${clinicId}, ${`b3a-${clinicId}`}, ${`عيادة ${letter}`}, ${`Clinic ${letter}`},
          'dermatology', 'ar', 'Asia/Kuwait', 'active', now() + interval '30 days', 10, 3, now(), now())`;
      await tx`INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
        VALUES (${clinicId}, ${branchId}, 'الفرع الرئيسي', 'Main', true, now(), now())`;
      await tx`INSERT INTO roles (clinic_id, id, system_key, name_ar, name_en, is_locked, is_active, created_at, updated_at)
        VALUES (${clinicId}, ${roleId}, 'doctor', 'طبيب', 'Doctor', false, true, now(), now())`;
      await tx`INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender,
          registration_branch_id, civil_id, status, created_at, updated_at)
        VALUES (${clinicId}, ${patientId}, '1', 'مراجع الاختبار', ${`+9655000${letter}`},
          '1990-01-01', 'female', ${branchId}, NULL, 'active', now(), now())`;
      await tx`INSERT INTO invitations (clinic_id, id, email, full_name, role_id, all_branches, status,
          expires_at, invited_by_user_id, token_hash, created_at, responded_at)
        VALUES (${clinicId}, ${newTestId()}, ${`invite-${clinicId}@example.com`}, 'مُدعى', ${roleId},
          true, 'pending', now() + interval '7 days', ${newTestId()}, ${tokenHash}, now(), NULL)`;
    });
    clinics.push({ clinicId, branchId, patientId, roleId, invitationTokenHash: tokenHash });
  }
  const [a, b] = clinics;
  if (a === undefined || b === undefined) throw new Error("two clinics were expected");
  return [a, b];
};

/**
 * اسم دور اختباري فريد: الـ database مش فاضية، والاختبار بيشتغل بالتوازي مع اللي فاتوه.
 * التسمية مبنية من UUID عشان متتصادمش، ومن غير أي مدخلات من برّه.
 *
 * @param prefix بادئة بتوصف الدور
 * @returns اسم دور صالح لـ PostgreSQL
 */
export const uniqueRoleName = (prefix: string): string =>
  `${prefix}_${newTestId().replaceAll("-", "")}`;

/**
 * ينفّذ جملة بتضمّن أسماء أدوار ( memberships / BYPASSRLS ). الأسماء دي مولّدة من
 * `uniqueRoleName` فمفيش مدخلات برّا تيجي فيها، والـ owner هو اللي تنفيذ — postgres.js
 * مابيدعمش bind لـ identifiers.
 *
 * @param owner عميل الـ owner
 * @param statement الجملة جاهزة
 * @returns عدد الصفوف اللي رجّعتها
 */
export const runAsOwner = async <T = unknown>(owner: Sql, statement: string): Promise<T[]> => {
  const rows = await owner.unsafe<T[]>(statement);
  return [...rows];
};

/**
 * أجزاء الرابط اللي ما ينفعش تطلع في أي رسالة خطأ: الرابط كله، وكلمة السر، والـ host والمنفذ.
 * بنقراها من الرابط نفسه (`new URL(url).password`)، فمفيش كلمة سر مكتوبة في الاختبار أصلاً.
 *
 * @param url رابط الاتصال
 * @param allowedPart جزء مسموح يبقى في الرسالة — اسم المستخدم مثلاً، لأنه هو الدور المتوقع
 * @returns الحروف اللي مفروض ما تظهرش
 */
export const secretsOf = (url: string, allowedPart?: string): string[] => {
  const parsed = new URL(url);
  const parts = [decodeURIComponent(parsed.password), parsed.host];
  // اسم المستخدم هو الدور المتوقع، والرسالة بتسمّيه عمداً (ADR-0002) — فلو هو المسموح، الرابط
  // كله كمان مش مسريب، لأنه بيحويه.
  if (allowedPart !== parsed.username) parts.push(url, parsed.username);
  return parts.filter((part) => part !== "");
};

/** اسم الدور اللي اللينك بياخد من `new URL(url).username` — ولا حاجة مكتوبة بإيدنا. */
export const roleOf = (url: string): string => new URL(url).username;
