"""Monotonic cleanup, server artifact lifetime and post-lock deadlines."""
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import uuid

spec = importlib.util.spec_from_file_location('transitions', Path(__file__).with_name('pdf-ledger-transitions.py'))
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)
p = t.p


def reject(sql, code):
    result = p.run(p.scoped(103, sql), ok=False)
    assert code in result.stderr, result.stderr


def release(job):
    p.run(p.scoped(103, f"UPDATE invoice_pdf_jobs SET status='cancelled',clinic_slot=NULL,lease_token=NULL,lease_until=NULL,deadline_at=NULL WHERE id='{job}'"))


def lifecycle():
    job, upload, sql = t.prepare()
    p.run(p.scoped(103, sql))
    p.run(p.scoped(103, f"UPDATE invoice_pdf_upload_attempts SET state='deleting',writer_stopped_at=now() WHERE id='{upload}'"))
    for state in ['allocated','unknown','uploaded','published']:
        reject(f"UPDATE invoice_pdf_upload_attempts SET state='{state}' WHERE id='{upload}'", 'pdf_cleanup_terminal')
    p.run(p.scoped(103, f"UPDATE invoice_pdf_upload_attempts SET state='deleted' WHERE id='{upload}'"))
    release(job)
    for direction in ['-', '+']:
        job, upload, sql = t.prepare()
        p.run(p.scoped(103, sql))
        sql = t.artifact_sql(job, upload).replace("'ready',1,1,now(),now()+interval '24 hours'",
            f"'ready',1,1,now(){direction}interval '30 days',now(){direction}interval '30 days'+interval '24 hours'")
        sql += ' RETURNING id'
        artifact = p.run(p.scoped(103, sql)).stdout.splitlines()[-2]
        check = f"SELECT published_at BETWEEN now()-interval '1 minute' AND now()+interval '1 second' AND expires_at=published_at+interval '24 hours' FROM invoice_pdf_artifacts WHERE id='{artifact}'"
        assert p.run(p.scoped(103, check)).stdout.strip().endswith('t')
        p.run(p.scoped(103, f"UPDATE invoice_pdf_artifacts SET state='expired' WHERE id='{artifact}'"))
        reject(f"UPDATE invoice_pdf_artifacts SET state='ready' WHERE id='{artifact}'", 'pdf_artifact_terminal')
        p.run(p.scoped(103, f"UPDATE invoice_pdf_artifacts SET state='deleting' WHERE id='{artifact}'"))
        reject(f"UPDATE invoice_pdf_artifacts SET state='ready' WHERE id='{artifact}'", 'pdf_cleanup_terminal')
        p.run(p.scoped(103, f"UPDATE invoice_pdf_artifacts SET state='deleted' WHERE id='{artifact}'"))
        release(job)


def expired_claims():
    job = str(uuid.uuid4())
    p.run(p.scoped(103, p.insert(103,job=job)))
    claim = f"UPDATE invoice_pdf_jobs SET status='running',attempt=1,fence=1,lease_token=gen_random_uuid(),lease_until={{lease}},deadline_at={{deadline}} WHERE id='{job}'"
    for lease, deadline in [("now()-interval '2 seconds'", "now()-interval '1 second'"),
                             ("now()-interval '1 second'", "now()+interval '30 seconds'")]:
        reject(claim.format(lease=lease,deadline=deadline), 'pdf_deadline')
    release(job)
    job, upload, sql = t.prepare()
    reject(sql.replace("now()+interval '20 seconds'", "now()-interval '1 second'"), 'pdf_upload_fence')
    release(job)


def expired_after_lock():
    job, upload, sql = t.prepare()
    p.run(p.scoped(103,f"UPDATE invoice_pdf_jobs SET lease_until=now()+interval '3 seconds' WHERE id='{job}'"))
    sql = sql.replace("now()+interval '20 seconds'", f"(SELECT lease_until FROM invoice_pdf_jobs WHERE id='{job}')")
    holder = subprocess.Popen(['docker','exec','-i',p.CONTAINER,'psql','-XqAt',
                               '-U','eyadex_app','-d',p.DATABASE,'-v','ON_ERROR_STOP=1'],
                              stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                              text=True,encoding='utf-8')
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        holder.stdin.write(p.scoped(103, f"BEGIN; DO $$ BEGIN PERFORM 1 FROM invoice_pdf_jobs WHERE id='{job}' FOR UPDATE; END $$;") + "\n\\echo lock-held\n")
        holder.stdin.flush()
        assert holder.stdout.readline().strip() == 'lock-held'
        name = 'pdf-expiry-race-' + str(uuid.uuid4())
        pending = pool.submit(p.run, "SET application_name='"+name+"';"+p.scoped(103,sql), 'eyadex_app', None)
        until = time.monotonic()+10
        blocked = False
        while time.monotonic()<until and not pending.done():
            if p.run("SELECT count(*) FROM pg_stat_activity WHERE application_name='"+name+"' AND cardinality(pg_blocking_pids(pid))>0", 'eyadex_owner').stdout.strip()=='1':
                blocked = True
                break
            time.sleep(0.02)
        assert blocked, 'allocation must first wait behind the unchanged job lock'
        p.run('SELECT pg_sleep(3.1)', 'eyadex_owner')
        holder.stdin.write('COMMIT;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10)
        result = pending.result(timeout=10)
        assert result.returncode!=0 and 'pdf_upload_fence' in result.stderr, result.stderr
    finally:
        if holder.poll() is None:
            holder.stdin.write('ROLLBACK;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10)
        pool.shutdown(wait=True)
    reject(f"UPDATE invoice_pdf_jobs SET lease_until=now()+interval '3 seconds' WHERE id='{job}'", 'pdf_lease_expired')
    release(job)


try:
    lifecycle()
    expired_claims()
    expired_after_lock()
    print('PASS: no lifecycle resurrection, fixed 24h lifetime, expired claims/uploads and post-lock expiry rejected')
finally:
    (p.OUT/'lifecycle.json').write_text(json.dumps(p.results,indent=2),encoding='utf-8')
