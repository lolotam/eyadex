import { createDatabase, type Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import {
  backfillClinicCivilIds,
  CivilIdCodec,
  verifyClinicCivilIds,
} from "../modules/patients/index.ts";
import { PgClinicNames } from "../modules/tenancy/index.ts";
import { readCivilIdIndexKey, readFieldCipher } from "../shared/field-encryption.module.ts";

// ADR-0028, R1-5/R1-6: converts the civil IDs stored before SQL 0045 to the encrypted columns, then proves
// the result. Run inside the API container (it holds DATABASE_URL, PLATFORM_DATABASE_URL and the medical
// keys), after the release carrying 0045 is deployed there:
//   node --conditions=eyadex-runtime dist/cli/backfill-civil-id.js --dry-run
//   node --conditions=eyadex-runtime dist/cli/backfill-civil-id.js
//   node --conditions=eyadex-runtime dist/cli/backfill-civil-id.js --verify
// Clinics are listed on the eyadex_platform pool (it sees every clinic, never a patient) and converted on
// eyadex_app inside withTenant: @eyadex/db refuses any role that bypasses RLS, the owner included. Output is
// counts and clinic ids only, never a number, an envelope, an index or a key. Exit 1 on a collision, a
// mismatch, a plain number left at --verify, or any failure; exit 2 on a usage error.

type Mode = "convert" | "dry-run" | "verify";

const out = (line: string) => process.stdout.write(`backfill-civil-id: ${line}\n`);
const fail = (message: string, code = 1): never => {
  process.stderr.write(`backfill-civil-id: ${message}\n`);
  process.exit(code);
};

function modeOf(args: readonly string[]): Mode {
  if (args.length === 0) return "convert";
  if (args.length === 1 && args[0] === "--dry-run") return "dry-run";
  if (args.length === 1 && args[0] === "--verify") return "verify";
  return fail("usage: backfill-civil-id.js [--dry-run | --verify]", 2);
}

function urlOf(name: "DATABASE_URL" | "PLATFORM_DATABASE_URL"): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new TypeError(`${name} is not set`);
  return value;
}

async function clinicIds(platform: Database): Promise<string[]> {
  const clinics = await platform.withNoTenant((tx) => new PgClinicNames().listOptions(tx));
  return clinics.map((clinic) => clinic.id).sort();
}

async function run(mode: Mode, app: Database, platform: Database): Promise<boolean> {
  const deps = {
    db: app,
    civilIds: new CivilIdCodec(readFieldCipher(process.env), readCivilIdIndexKey(process.env)),
  };
  const ids = await clinicIds(platform);
  let sound = true;
  if (mode === "verify") {
    const total = { plain: 0, encrypted: 0, mismatched: 0 };
    for (const clinicId of ids) {
      const counts = await verifyClinicCivilIds(deps, clinicId);
      total.plain += counts.plain;
      total.encrypted += counts.encrypted;
      total.mismatched += counts.mismatched;
      if (counts.plain > 0 || counts.mismatched > 0) {
        sound = false;
        out(`clinic ${clinicId}: ${counts.plain} plain, ${counts.mismatched} mismatched`);
      }
    }
    out(
      `verify: ${ids.length} clinics, ${total.encrypted} encrypted, ${total.plain} plain, ` +
        `${total.mismatched} mismatched`,
    );
    return sound;
  }
  const total = { converted: 0, collisions: 0 };
  for (const clinicId of ids) {
    const counts = await backfillClinicCivilIds(deps, clinicId, mode === "dry-run");
    total.converted += counts.converted;
    total.collisions += counts.collisions;
    if (counts.collisions > 0) {
      sound = false;
      out(`clinic ${clinicId}: ${counts.collisions} collisions (left as they are)`);
    }
  }
  const verb = mode === "dry-run" ? "would convert" : "converted";
  out(`${mode}: ${ids.length} clinics, ${verb} ${total.converted}, ${total.collisions} collisions`);
  return sound;
}

const mode = modeOf(process.argv.slice(2));
let app: Database | undefined;
let platform: Database | undefined;
try {
  const ids = systemUuidV7();
  app = createDatabase({ url: urlOf("DATABASE_URL"), role: "eyadex_app", ids });
  platform = createDatabase({ url: urlOf("PLATFORM_DATABASE_URL"), role: "eyadex_platform", ids });
  const sound = await run(mode, app, platform);
  await Promise.all([app.close(), platform.close()]);
  if (!sound) fail("not clean; see the counts above");
} catch (error) {
  await Promise.allSettled([app?.close(), platform?.close()]);
  // Our own configuration errors name variables only. Anything else may carry a connection string or a
  // value, so only its class and code are printed (as dist/bootstrap-platform-account.js does).
  const message = (error as Error).message ?? "";
  const ours = error instanceof TypeError || /^Invalid API configuration: /.test(message);
  const code = (error as { code?: unknown }).code;
  fail(
    ours && !/:\/\/|@/.test(message)
      ? message
      : `failed (${(error as Error).name ?? "Error"}${typeof code === "string" ? ` ${code}` : ""})`,
  );
}
