import { parseIcd10OrderFile } from "../modules/medical/index.ts";
import { icd10LoadScript } from "./icd10-load-script.ts";

// P2-F1, R2-8: turns the CDC/NCHS order file into the SQL that loads `icd10_codes`. The runtime role may
// only read that table, so this command never connects to the database: it reads the file on stdin and
// writes one transaction on stdout, which the orchestrator applies as the owner, like a migration
// (after 0047, staging first):
//   docker exec -i <api container> node --conditions=eyadex-runtime dist/cli/load-icd10.js \
//     < icd10cm-order-2027.txt > icd10-fy2027.sql
//   psql -v ON_ERROR_STOP=1 -f icd10-fy2027.sql            (as eyadex_owner)
// Rerunning it updates every code in place. The summary goes to stderr, so stdout stays pure SQL.

const fail = (message: string): never => {
  process.stderr.write(`load-icd10: ${message}\n`);
  process.exit(1);
};

if (process.stdin.isTTY) fail("pipe the CDC order file on stdin");

try {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  const rows = parseIcd10OrderFile(Buffer.concat(chunks).toString("utf8"));
  if (rows.length === 0) fail("the file holds no rows");
  process.stdout.write(icd10LoadScript(rows));
  const billable = rows.filter((row) => row.billable).length;
  process.stderr.write(`load-icd10: ${rows.length} codes (${billable} billable)\n`);
} catch (error) {
  fail(error instanceof RangeError ? error.message : `failed (${(error as Error).name})`);
}
