import type { PatientDetail, PatientListItem } from "@eyadex/contracts/patients";
import type { PatientListResponse, PatientSearchRequest } from "@eyadex/contracts/patients-api";
import type { Database, Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import {
  recordActions,
  searchTerms,
  type PatientScope,
  type PatientScopes,
} from "../domain/patient-rules.ts";
import type { CivilIdCodec } from "../persistence/civil-id-codec.ts";
import { PATIENT_COLUMNS, toRecord } from "../persistence/pg-patient-store.ts";
import type { BranchNames, PatientBranchReader } from "../ports/patient-branch-reader.ts";
import { ownPatientSql } from "./own-patients.ts";

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

/**
 * "Every branch" or a JSON array of branch ids, both as bound parameters (never SQL text); under `own`
 * the files with a live appointment with the caller, in any branch (D-4, ADR-0026 A3).
 */
const inScopeSql = (scope: PatientScope) => {
  if ("own" in scope) return ownPatientSql(scope.own);
  const ids = JSON.stringify(scope.all ? [] : scope.branchIds);
  return sql`(${scope.all}::boolean OR p.registration_branch_id IN
    (SELECT value::uuid FROM jsonb_array_elements_text(${ids}::jsonb)))`;
};

/** A full civil ID matches its blind index; any other digits never match a civil ID (P2-F5). */
const civilIdMatch = (clinicId: string, civilIds: CivilIdCodec, digits: string | null): SQL =>
  digits === null ? sql`false` : sql`p.civil_id_hmac = ${civilIds.index(clinicId, digits)}`;

/** The WHERE clause shared by the page and its total: clinic, view scope, filters, search. */
function listFilters(
  clinicId: string,
  civilIds: CivilIdCodec,
  view: PatientScope,
  query: PatientSearchRequest,
): SQL {
  const { namePattern, digitsPattern, civilId } = searchTerms(query.q);
  return sql`p.clinic_id = ${clinicId} AND ${inScopeSql(view)}
    AND (${query.branchId}::uuid IS NULL OR p.registration_branch_id = ${query.branchId}::uuid)
    AND (${query.status}::text IS NULL OR p.status = ${query.status}::text)
    AND (${namePattern}::text IS NULL OR p.full_name ILIKE ${namePattern}::text
      OR (${digitsPattern}::text IS NOT NULL AND (
        regexp_replace(p.phone, '[^0-9]', '', 'g') LIKE ${digitsPattern}::text
        OR repeat('0', greatest(0, 6 - length(p.file_number))) || p.file_number
          LIKE ${digitsPattern}::text))
      OR ${civilIdMatch(clinicId, civilIds, civilId)})`;
}
/**
 * A read inside the patients transaction, with tenancy's branch names behind the patients port and the
 * civil ID codec (ADR-0028).
 */
export interface PatientReads {
  readonly tx: Tx;
  readonly branches: PatientBranchReader;
  readonly civilIds: CivilIdCodec;
}

/** Who reads: the clinic and the caller's per-action scopes (a `PatientActor` fits). */
export interface PatientReader {
  readonly clinicId: string;
  readonly scopes: PatientScopes;
}

// The branches FK makes a missing name impossible; the dash is the mock's placeholder all the same.
const NO_NAMES: BranchNames = { nameAr: "—", nameEn: "—" };

const branchNamesOf = (names: ReadonlyMap<string, BranchNames>, branchId: string) => {
  const found = names.get(branchId) ?? NO_NAMES;
  return { branchNameAr: found.nameAr, branchNameEn: found.nameEn };
};

interface ListRow {
  id: string;
  file_number: string;
  full_name: string;
  phone: string;
  registration_branch_id: string;
  civil_id_last4: string | null;
  status: PatientListItem["status"];
}

const toListItem = (
  row: ListRow,
  names: ReadonlyMap<string, BranchNames>,
  scopes: PatientScopes,
): PatientListItem => ({
  id: row.id,
  fileNumber: Number(row.file_number),
  fullName: row.full_name,
  phone: row.phone,
  registrationBranchId: row.registration_branch_id,
  ...branchNamesOf(names, row.registration_branch_id),
  civilIdLast4: row.civil_id_last4,
  status: row.status,
  actions: recordActions(scopes, row.registration_branch_id),
});

/**
 * قايمة الملفات (story P1، نفس قواعد الـ mock): جوه نطاق العرض بس (وتحت `own` ملفات الفاعل بس، في أي
 * فرع، والإجمالي بنفس الشرط)، أحدث رقم ملف الأول، بـ cursor.
 * البحث بالاسم، أو بأرقام الموبايل / رقم الملف بستة أرقام، أو بالرقم المدني كامل بس (فهرسه، P2-F5).
 * الرقم المدني الكامل عمره ما بيتقري هنا: الصف بياخد آخر 4 أرقام بس. أسماء الفروع من port الفروع في
 * نداء واحد للصفحة.
 *
 * @param db الـ pool على `eyadex_app`
 * @param reads port أسماء الفروع (بتنفّذه tenancy) والـ codec بتاع الرقم المدني
 * @param reader العيادة ونطاقات الفاعل (`view` مش null: الـ guard عدّاه)
 * @param query الفلاتر والـ cursor
 * @returns الصفحة
 */
export async function searchPatients(
  db: Database,
  reads: Omit<PatientReads, "tx">,
  reader: PatientReader & { scopes: { view: PatientScope } },
  query: PatientSearchRequest,
): Promise<PatientListResponse> {
  const { clinicId, scopes } = reader;
  const { branches, civilIds } = reads;
  const after = decodeCursor(query.cursor);
  const filters = listFilters(clinicId, civilIds, scopes.view, query);
  const { rows, total, names } = await db.withTenant(clinicId, async (tx) => {
    const page = await tx.execute<ListRow>(
      sql`SELECT p.id, p.file_number, p.full_name, p.phone, p.registration_branch_id,
            p.civil_id_last4, p.status
          FROM patients p
          WHERE ${filters}
            AND (${after}::bigint IS NULL OR p.file_number::bigint < ${after}::bigint)
          ORDER BY p.file_number::bigint DESC
          LIMIT ${query.limit + 1}`,
    );
    return {
      rows: page,
      total: await tx.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM patients p WHERE ${filters}`,
      ),
      names: await branches.namesOf(
        tx,
        clinicId,
        page.map((row) => row.registration_branch_id),
      ),
    };
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const more = rows.length > query.limit && last !== undefined;
  return {
    items: page.map((row) => toListItem(row, names, scopes)),
    nextCursor: more ? encodeCursor(Number(last.file_number)) : null,
    total: Number(total[0]?.total ?? 0),
  };
}

/**
 * ملف كامل بشكل الرد (فيه الرقم المدني الكامل)، جوه transaction المنادي. المنادي هو اللي بيقرر إن
 * الفاعل يقدر يشوفه.
 *
 * @param reads الـ transaction جوه `withTenant` و port أسماء الفروع
 * @param reader العيادة ونطاقات الفاعل (لأزرار السجل)
 * @param id الملف
 * @returns الملف، أو `null`
 */
export async function readPatientDetail(
  reads: PatientReads,
  reader: PatientReader,
  id: string,
): Promise<PatientDetail | null> {
  const { tx, branches, civilIds } = reads;
  const rows = await tx.execute<Parameters<typeof toRecord>[0] & { created_at: Date | string }>(
    sql`SELECT ${PATIENT_COLUMNS}, p.created_at FROM patients p
        WHERE p.clinic_id = ${reader.clinicId} AND p.id = ${id}`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  const record = toRecord(row, reader.clinicId, civilIds);
  const names = await branches.namesOf(tx, reader.clinicId, [record.registrationBranchId]);
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
    ...branchNamesOf(names, record.registrationBranchId),
    actions: recordActions(reader.scopes, record.registrationBranchId),
  };
}
