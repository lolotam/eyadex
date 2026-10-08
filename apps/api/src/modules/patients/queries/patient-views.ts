import type { PatientDetail, PatientListItem } from "@eyadex/contracts/patients";
import type { PatientListResponse, PatientSearchRequest } from "@eyadex/contracts/patients-api";
import type { Database, Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import {
  recordActions,
  searchTerms,
  type PatientScope,
  type PatientScopes,
} from "../domain/patient-rules.ts";
import { PATIENT_COLUMNS, toRecord } from "../persistence/pg-patient-store.ts";

// The cursor is the last file number seen, base64url-encoded so the client treats it as opaque.
const FILE_NUMBER = /^[1-9][0-9]{0,17}$/;
const encodeCursor = (fileNumber: number) => Buffer.from(String(fileNumber)).toString("base64url");

function decodeCursor(cursor: string | null): string | null {
  if (cursor === null) return null;
  const value = Buffer.from(cursor, "base64url").toString();
  if (!FILE_NUMBER.test(value)) {
    throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  }
  return value;
}

/** The scope as two bound parameters: "every branch", or a JSON array of branch ids. */
const scopeParams = (scope: PatientScope) => ({
  all: scope.all,
  ids: JSON.stringify(scope.all ? [] : scope.branchIds),
});

const inScopeSql = (scope: PatientScope) => {
  const { all, ids } = scopeParams(scope);
  return sql`(${all}::boolean OR p.registration_branch_id IN
    (SELECT value::uuid FROM jsonb_array_elements_text(${ids}::jsonb)))`;
};

interface ListRow {
  id: string;
  file_number: string;
  full_name: string;
  phone: string;
  registration_branch_id: string;
  branch_name_ar: string;
  branch_name_en: string;
  civil_id_last4: string | null;
  status: PatientListItem["status"];
}

/**
 * قايمة الملفات (story P1، نفس قواعد الـ mock): جوه نطاق العرض بس، أحدث رقم ملف الأول، بـ cursor.
 * البحث بالاسم، أو بأرقام الموبايل / رقم الملف بستة أرقام / الرقم المدني. الرقم المدني الكامل
 * عمره ما بيتقري هنا: الصف بياخد آخر 4 أرقام بس.
 *
 * @param db الـ pool على `eyadex_app`
 * @param clinicId عيادة السياق
 * @param scopes نطاقات الفاعل (`view` مش null: الـ guard عدّاه)
 * @param query الفلاتر والـ cursor
 * @returns الصفحة
 */
export async function searchPatients(
  db: Database,
  clinicId: string,
  scopes: PatientScopes & { view: PatientScope },
  query: PatientSearchRequest,
): Promise<PatientListResponse> {
  const after = decodeCursor(query.cursor);
  const { namePattern, digitsPattern } = searchTerms(query.q);
  const filters = sql`p.clinic_id = ${clinicId} AND ${inScopeSql(scopes.view)}
    AND (${query.branchId}::uuid IS NULL OR p.registration_branch_id = ${query.branchId}::uuid)
    AND (${query.status}::text IS NULL OR p.status = ${query.status}::text)
    AND (${namePattern}::text IS NULL OR p.full_name ILIKE ${namePattern}::text
      OR (${digitsPattern}::text IS NOT NULL AND (
        regexp_replace(p.phone, '[^0-9]', '', 'g') LIKE ${digitsPattern}::text
        OR repeat('0', greatest(0, 6 - length(p.file_number))) || p.file_number
          LIKE ${digitsPattern}::text
        OR coalesce(p.civil_id, '') LIKE ${digitsPattern}::text)))`;
  const { rows, total } = await db.withTenant(clinicId, async (tx) => ({
    rows: await tx.execute<ListRow>(
      sql`SELECT p.id, p.file_number, p.full_name, p.phone, p.registration_branch_id,
            b.name_ar AS branch_name_ar, b.name_en AS branch_name_en,
            right(p.civil_id, 4) AS civil_id_last4, p.status
          FROM patients p
          JOIN branches b ON b.clinic_id = p.clinic_id AND b.id = p.registration_branch_id
          WHERE ${filters}
            AND (${after}::bigint IS NULL OR p.file_number::bigint < ${after}::bigint)
          ORDER BY p.file_number::bigint DESC
          LIMIT ${query.limit + 1}`,
    ),
    total: await tx.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM patients p WHERE ${filters}`,
    ),
  }));
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      fileNumber: Number(row.file_number),
      fullName: row.full_name,
      phone: row.phone,
      registrationBranchId: row.registration_branch_id,
      branchNameAr: row.branch_name_ar,
      branchNameEn: row.branch_name_en,
      civilIdLast4: row.civil_id_last4,
      status: row.status,
      actions: recordActions(scopes, row.registration_branch_id),
    })),
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeCursor(Number(last.file_number))
        : null,
    total: Number(total[0]?.total ?? 0),
  };
}

/**
 * ملف كامل بشكل الرد (فيه الرقم المدني الكامل)، جوه transaction المنادي. المنادي هو اللي بيقرر إن
 * الفاعل يقدر يشوفه.
 *
 * @param tx الـ transaction جوه `withTenant`
 * @param clinicId العيادة
 * @param id الملف
 * @param scopes نطاقات الفاعل (لأزرار السجل)
 * @returns الملف، أو `null`
 */
export async function readPatientDetail(
  tx: Tx,
  clinicId: string,
  id: string,
  scopes: PatientScopes,
): Promise<PatientDetail | null> {
  const rows = await tx.execute<
    Parameters<typeof toRecord>[0] & {
      created_at: Date | string;
      branch_name_ar: string;
      branch_name_en: string;
    }
  >(
    sql`SELECT ${PATIENT_COLUMNS}, p.created_at, b.name_ar AS branch_name_ar,
          b.name_en AS branch_name_en
        FROM patients p
        JOIN branches b ON b.clinic_id = p.clinic_id AND b.id = p.registration_branch_id
        WHERE p.clinic_id = ${clinicId} AND p.id = ${id}`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  const record = toRecord(row);
  return {
    id: record.id,
    fileNumber: record.fileNumber,
    fullName: record.fullName,
    phone: record.phone,
    birthDate: record.birthDate,
    gender: record.gender,
    registrationBranchId: record.registrationBranchId,
    civilId: record.civilId,
    status: record.status,
    createdAt: new Date(row.created_at).toISOString(),
    branchNameAr: row.branch_name_ar,
    branchNameEn: row.branch_name_en,
    actions: recordActions(scopes, record.registrationBranchId),
  };
}
