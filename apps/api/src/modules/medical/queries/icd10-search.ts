import type { Icd10Result } from "@eyadex/contracts/icd10";
import type { Database } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

import { ICD10_RELEASE, icd10Terms } from "../domain/icd10.ts";

const LIMIT = 20;

// LIKE treats `%`, `_` and the escape character itself as patterns; a typed one is a plain character.
const likeEscaped = (text: string): string => text.replace(/[\\%_]/g, "\\$&");

/**
 * P2-F1: 20 billable ICD-10-CM codes for what the doctor typed (it came in a body, never a URL). A
 * code-like word matches code prefixes, dot or not; every word must appear in the English title (the
 * trigram index serves `LIKE '%word%'`). Codes by prefix come first, then titles that start with the
 * first word, then by code. Reference data, so the search is not audited and nothing of it is logged.
 *
 * @param db the clinic pool
 * @param clinicId the caller's clinic (the transaction's context; the table itself has no RLS)
 * @param q the query after `icd10QuerySchema`
 * @returns the codes and the release they come from
 */
export async function searchIcd10(db: Database, clinicId: string, q: string): Promise<Icd10Result> {
  const { codePrefix, words } = icd10Terms(q);
  const byCode: SQL =
    codePrefix === null
      ? sql`false`
      : sql`replace(code, '.', '') LIKE ${`${likeEscaped(codePrefix)}%`}`;
  const byTitle = sql.join(
    words.map((word) => sql`lower(title_en) LIKE ${`%${likeEscaped(word)}%`}`),
    sql` AND `,
  );
  const startsWith = `${likeEscaped(words[0] ?? "")}%`;
  // PostgreSQL refuses a bare constant in ORDER BY, so the prefix rank exists only with a prefix.
  const prefixFirst = codePrefix === null ? sql`` : sql`${byCode} DESC, `;
  const rows = await db.withTenant(clinicId, (tx) =>
    tx.execute<{ code: string; title_en: string }>(
      sql`SELECT code, title_en FROM icd10_codes
          WHERE billable AND (${byCode} OR (${byTitle}))
          ORDER BY ${prefixFirst}lower(title_en) LIKE ${startsWith} DESC, code
          LIMIT ${LIMIT}`,
    ),
  );
  return {
    items: rows.map((r) => ({ code: r.code, title: r.title_en })),
    release: `ICD-10-CM ${ICD10_RELEASE}`,
  };
}
