"""Clocks and retention predicates must be evaluated after serialization."""
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import uuid

spec = importlib.util.spec_from_file_location('lifecycle', Path(__file__).with_name('pdf-ledger-transitions.py'))
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)
p = t.p


def locked(sql):
    process = subprocess.Popen(['docker','exec','-i',p.CONTAINER,'psql','-XqAt',
        '-U','eyadex_app','-d',p.DATABASE,'-v','ON_ERROR_STOP=1'],
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
    process.stdin.write(p.scoped(103,'BEGIN; '+sql)+'\n\\echo lock-held\n')
    process.stdin.flush()
    assert process.stdout.readline().strip()=='lock-held'
    return process


def finish(process, command):
    process.stdin.write(command+';\n\\q\n');process.stdin.flush();process.wait(timeout=10)


def wait_blocked(pending, name):
    until=time.monotonic()+10
    while time.monotonic()<until and not pending.done():
        result=p.run("SELECT count(*) FROM pg_stat_activity WHERE application_name='"+name+"' AND cardinality(pg_blocking_pids(pid))>0",'eyadex_owner')
        if result.stdout.strip()=='1':
            return
        time.sleep(0.02)
    raise AssertionError('expected row-lock wait')


def publication_clock():
    job,upload,sql=t.prepare()
    p.run(p.scoped(103,sql))
    holder=locked(f"DO $$ BEGIN PERFORM 1 FROM invoice_pdf_upload_attempts WHERE id='{upload}' FOR UPDATE; END $$;")
    pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        name='pdf-publish-clock-'+str(uuid.uuid4())
        pending=pool.submit(p.run,"SET application_name='"+name+"';"+p.scoped(103,t.artifact_sql(job,upload)), 'eyadex_app', None)
        wait_blocked(pending,name)
        p.run('SELECT pg_sleep(1.1)','eyadex_owner')
        threshold=p.run('SELECT clock_timestamp()','eyadex_owner').stdout.strip()
        finish(holder,'ROLLBACK')
        result=pending.result(timeout=10)
        assert result.returncode==0,result.stderr
        check=f"SELECT published_at >= '{threshold}'::timestamptz AND expires_at=published_at+interval '24 hours' FROM invoice_pdf_artifacts WHERE job_id='{job}'"
        assert p.run(p.scoped(103,check)).stdout.strip().endswith('t')
    finally:
        if holder.poll() is None:finish(holder,'ROLLBACK')
        pool.shutdown(wait=True)
    p.run(p.scoped(103,f"UPDATE invoice_pdf_jobs SET status='cancelled',clinic_slot=NULL,lease_token=NULL,lease_until=NULL,deadline_at=NULL WHERE id='{job}'"))


def refreshed_retention():
    job=str(uuid.uuid4())
    p.run(p.scoped(103,p.insert(103,job=job)))
    p.run(p.scoped(103,f"UPDATE invoice_pdf_jobs SET status='cancelled',clinic_slot=NULL WHERE id='{job}'"))
    # Only this synthetic owner fixture bypasses its clock to model seven elapsed days.
    p.run(f"BEGIN; SET LOCAL session_replication_role=replica; UPDATE invoice_pdf_jobs SET updated_at=now()-interval '8 days' WHERE clinic_id='{p.uid(103)}' AND id='{job}'; COMMIT;",'eyadex_owner')
    holder=locked(f"UPDATE invoice_pdf_jobs SET updated_at=now() WHERE id='{job}';")
    pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        name='pdf-retention-clock-'+str(uuid.uuid4())
        pending=pool.submit(p.run,"SET application_name='"+name+"';"+p.scoped(103,'SELECT purge_invoice_pdf_evidence()'), 'eyadex_dispatcher', None)
        wait_blocked(pending,name)
        finish(holder,'COMMIT')
        result=pending.result(timeout=10)
        assert result.returncode==0,result.stderr
        assert p.run(p.scoped(103,f"SELECT count(*) FROM invoice_pdf_jobs WHERE id='{job}'")).stdout.strip().endswith('1')
    finally:
        if holder.poll() is None:finish(holder,'ROLLBACK')
        pool.shutdown(wait=True)


try:
    publication_clock()
    refreshed_retention()
    print('PASS: publication clock starts after lock; purge preserves concurrently refreshed evidence')
finally:
    (p.OUT/'clock-races.json').write_text(json.dumps(p.results,indent=2),encoding='utf-8')
