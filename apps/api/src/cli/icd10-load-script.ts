import { ICD10_RELEASE, type Icd10Row } from "../modules/medical/index.ts";

const BATCH = 1000;

// A standard-conforming literal: CDC titles are plain ASCII, and doubling the quote is the whole escape.
const literal = (text: string): string => `'${text.replaceAll("'", "''")}'`;

/**
 * The SQL that loads the parsed order file: one transaction of `INSERT … ON CONFLICT (code) DO UPDATE`
 * batches, so a rerun (or a later release) updates every code in place and never duplicates one. First,
 * every code of another release is made non-billable: a code the new file drops is retired, so search and
 * diagnosis validation (billable only) never offer it again, while its row stays and a diagnosis already
 * written keeps its code. A code the new file still carries gets its flag back from the upsert.
 *
 * @returns the script, for psql as the owner role (the runtime role only reads `icd10_codes`)
 */
export function icd10LoadScript(rows: readonly Icd10Row[], release = ICD10_RELEASE): string {
  const statements: string[] = [
    `UPDATE icd10_codes SET billable = false WHERE release <> ${literal(release)};`,
  ];
  for (let start = 0; start < rows.length; start += BATCH) {
    const values = rows
      .slice(start, start + BATCH)
      .map(
        (row) =>
          `(${literal(row.code)}, ${literal(row.titleEn)}, ${row.billable}, ${literal(release)})`,
      );
    statements.push(
      `INSERT INTO icd10_codes (code, title_en, billable, release) VALUES\n${values.join(",\n")}\n` +
        "ON CONFLICT (code) DO UPDATE SET title_en = EXCLUDED.title_en, " +
        "billable = EXCLUDED.billable, release = EXCLUDED.release;",
    );
  }
  return ["SET standard_conforming_strings = on;", "BEGIN;", ...statements, "COMMIT;", ""].join(
    "\n",
  );
}
