import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
};

export const urls = () => ({
  owner: need("EYADEX_TEST_OWNER_URL"),
  app: need("EYADEX_TEST_APP_URL"),
});
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function owner(query: string): string {
  return execFileSync("psql", [urls().owner, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", query], {
    encoding: "utf8",
  }).trim();
}

function ownerJson<T>(query: string): T {
  return JSON.parse(owner(`SELECT coalesce(json_agg(r), '[]') FROM (${query}) r`) || "[]") as T;
}

export interface World {
  readonly clinicId: string;
  readonly otherClinicId: string;
  readonly invoiceId: string;
  readonly otherInvoiceId: string;
}

function seedClinic(): { clinicId: string; invoiceId: string } {
  const clinicId = randomUUID();
  const invoiceId = randomUUID();
  const slug = `p4a-${clinicId.slice(0, 8)}`;
  owner(`INSERT INTO clinics (id,slug,name_ar,name_en,specialty,default_language,timezone,
      status,expires_at,max_users,max_branches,created_at,updated_at)
    VALUES (${q(clinicId)},${q(slug)},'synthetic','synthetic','general','en','UTC','active',
      clock_timestamp()+interval '1 day',10,10,clock_timestamp(),clock_timestamp());
    INSERT INTO branches (clinic_id,id,name_ar,name_en,is_active,created_at,updated_at)
    VALUES (${q(clinicId)},${q(clinicId)},'synthetic','synthetic',true,clock_timestamp(),clock_timestamp());
    INSERT INTO patients (clinic_id,id,file_number,full_name,phone,birth_date,gender,
      registration_branch_id,status,created_at,updated_at)
    VALUES (${q(clinicId)},${q(clinicId)},'1','synthetic','+96500000000','2000-01-01','male',
      ${q(clinicId)},'active',clock_timestamp(),clock_timestamp());
    INSERT INTO invoices (clinic_id,id,branch_id,patient_id,year,number_seq,number,status,source,
      issued_at,currency,currency_exponent,subtotal_minor,discount_minor,tax_rate_bp,tax_minor,total_minor,
      created_by,created_at,updated_at)
    VALUES (${q(clinicId)},${q(invoiceId)},${q(clinicId)},${q(clinicId)},2026,1,'SYN-1','issued','manual',
      clock_timestamp(),'KWD',3,0,0,0,0,0,${q(clinicId)},clock_timestamp(),clock_timestamp())`);
  return { clinicId, invoiceId };
}

export function seedWorld(): World {
  const first = seedClinic();
  const second = seedClinic();
  return {
    clinicId: first.clinicId,
    otherClinicId: second.clinicId,
    invoiceId: first.invoiceId,
    otherInvoiceId: second.invoiceId,
  };
}

let version = 0;
let slot = 0;

export function insertJob(
  world: World,
  options: { otherClinic?: boolean; createdSecondsAgo?: number } = {},
): string {
  const jobId = randomUUID();
  const clinicId = options.otherClinic === true ? world.otherClinicId : world.clinicId;
  const invoiceId = options.otherClinic === true ? world.otherInvoiceId : world.invoiceId;
  version += 1;
  slot = (slot % 10) + 1;
  const age = options.createdSecondsAgo ?? 0;
  owner(`INSERT INTO invoice_pdf_jobs (clinic_id,id,invoice_id,invoice_version,render_revision,status,
      attempt,retry_count,fence,clinic_slot,created_at,updated_at)
    VALUES (${q(clinicId)},${q(jobId)},${q(invoiceId)},${version},'typst:1:1:1','queued',0,0,0,
      ${slot},clock_timestamp()-(${age}*interval '1 second'),clock_timestamp())`);
  return jobId;
}

function rewriteGuarded(clinicId: string, jobId: string, update: string): void {
  owner(`BEGIN;
    ALTER TABLE invoice_pdf_jobs DISABLE TRIGGER invoice_pdf_job_guard;
    UPDATE invoice_pdf_jobs SET ${update} WHERE clinic_id=${q(clinicId)} AND id=${q(jobId)};
    ALTER TABLE invoice_pdf_jobs ENABLE TRIGGER invoice_pdf_job_guard;
    COMMIT`);
}

export function expireJob(
  clinicId: string,
  jobId: string,
  attempt: number,
  retryCount: number,
): void {
  rewriteGuarded(
    clinicId,
    jobId,
    `status='running',attempt=${attempt},retry_count=${retryCount},fence=${attempt},
      lease_token=${q(randomUUID())}::uuid,lease_until=clock_timestamp()-interval '1 second',
      deadline_at=clock_timestamp()-interval '1 second',next_attempt_at=NULL,error_code=NULL,
      cleanup_due_at=NULL,updated_at=clock_timestamp()`,
  );
}

export function setLeaseWindow(
  clinicId: string,
  jobId: string,
  leaseSeconds: number,
  deadlineSeconds: number,
): void {
  rewriteGuarded(
    clinicId,
    jobId,
    `lease_until=clock_timestamp()+(${leaseSeconds}*interval '1 second'),
      deadline_at=clock_timestamp()+(${deadlineSeconds}*interval '1 second')`,
  );
}

export function setRetryDelay(clinicId: string, jobId: string, seconds: number): void {
  rewriteGuarded(clinicId, jobId, `next_attempt_at=updated_at+(${seconds}*interval '1 second')`);
}

export function retryWaitJob(
  clinicId: string,
  jobId: string,
  options: { attempt?: number; retryCount?: number; inSeconds?: number } = {},
): void {
  const attempt = options.attempt ?? 1;
  const retries = options.retryCount ?? 1;
  const due = options.inSeconds ?? 3600;
  rewriteGuarded(
    clinicId,
    jobId,
    `status='retry_wait',attempt=${attempt},retry_count=${retries},fence=${attempt},
      lease_token=NULL,lease_until=NULL,deadline_at=NULL,
      next_attempt_at=clock_timestamp()+(${due}*interval '1 second'),error_code='lease_expired',
      cleanup_due_at=NULL,updated_at=clock_timestamp()`,
  );
}

export interface JobRow {
  readonly status: string;
  readonly attempt: number;
  readonly retry_count: number;
  readonly fence: string;
  readonly lease_token: string | null;
  readonly lease_until: string | null;
  readonly deadline_at: string | null;
  readonly next_attempt_at: string | null;
  readonly clinic_slot: number | null;
  readonly cleanup_due_at: string | null;
  readonly error_code: string | null;
}

export function readJob(clinicId: string, jobId: string): JobRow {
  return ownerJson<JobRow[]>(`SELECT status,attempt,retry_count,fence::text,lease_token::text,
    lease_until::text,deadline_at::text,next_attempt_at::text,clinic_slot,cleanup_due_at::text,error_code
    FROM invoice_pdf_jobs WHERE clinic_id=${q(clinicId)} AND id=${q(jobId)}`)[0]!;
}

export function secondsFromDbNow(iso: string): number {
  return Number(owner(`SELECT extract(epoch FROM (${q(iso)}::timestamptz-clock_timestamp()))`));
}

export interface LockHold {
  readonly ready: Promise<void>;
  readonly done: Promise<void>;
  stop(): void;
}

export function holdJobLock(clinicId: string, jobId: string, seconds = 10): LockHold {
  const marker = `p4a-${randomUUID().replace(/-/g, "")}`;
  const dir = mkdtempSync(join(tmpdir(), "eyadex-p4a-claim-"));
  const file = join(dir, "hold.sql");
  writeFileSync(
    file,
    `BEGIN;\nSELECT id FROM invoice_pdf_jobs WHERE clinic_id=${q(clinicId)} AND id=${q(jobId)} FOR UPDATE;\nSELECT pg_sleep(${seconds});\nCOMMIT;\n`,
    "ascii",
  );
  let exited: number | null = null;
  const child: ChildProcess = spawn("psql", [urls().owner, "-v", "ON_ERROR_STOP=1", "-f", file], {
    stdio: "ignore",
    env: { ...process.env, PGAPPNAME: marker },
  });
  const done = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      exited = code ?? 1;
      rmSync(dir, { recursive: true, force: true });
      if (code === 0) resolve();
      else reject(new Error(`psql lock holder exited ${code}`));
    });
  });
  const ready = (async () => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (exited !== null) throw new Error(`lock holder exited early (${exited})`);
      const held = owner(`SELECT count(*) FROM pg_stat_activity
        WHERE pid<>pg_backend_pid() AND application_name='${marker}' AND wait_event='PgSleep'`);
      if (held === "1") return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    child.kill();
    throw new Error("lock holder did not reach PgSleep");
  })();
  return { ready, done, stop: () => child.kill() };
}
