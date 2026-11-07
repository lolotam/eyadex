"""Deletion and upload-fence races against the isolated proof database."""
import concurrent.futures
import importlib.util
from pathlib import Path
import subprocess
import time
import uuid

spec = importlib.util.spec_from_file_location('proof', Path(__file__).with_name('pdf-ledger-proof.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def prepare():
    job, upload = str(uuid.uuid4()), str(uuid.uuid4())
    p.run(p.scoped(103, p.insert(103, job=job)))
    p.run(p.scoped(103, f"UPDATE invoice_pdf_jobs SET status='running',attempt=1,fence=1,lease_token=gen_random_uuid(),lease_until=now()+interval '30 seconds',deadline_at=now()+interval '60 seconds' WHERE id='{job}'"))
    sql = f"""INSERT INTO invoice_pdf_upload_attempts
      (clinic_id,id,job_id,attempt,fence,state,storage_key,upload_deadline_at,created_at,updated_at)
      VALUES ('{p.uid(103)}','{upload}','{job}',1,1,'allocated',
      'clinic/{p.uid(103)}/invoice-pdfs/{job}/{upload}',now()+interval '20 seconds',now(),now())"""
    return job, upload, sql


def deletion():
    job, upload, sql = prepare()
    p.run(p.scoped(103, sql))
    p.run(p.scoped(103, f"""INSERT INTO invoice_pdf_artifacts
      (clinic_id,id,job_id,upload_id,state,cipher_key_version,byte_length,published_at,expires_at)
      VALUES ('{p.uid(103)}','{upload}','{job}','{upload}','ready',1,1,now(),now()+interval '24 hours')"""))
    blocked = p.run(p.scoped(103, f"UPDATE invoice_pdf_upload_attempts SET state='deleting',writer_stopped_at=now() WHERE id='{upload}'"), ok=False)
    assert 'pdf_upload_live_artifact' in blocked.stderr, blocked.stderr
    for table, extra, live in [('invoice_pdf_artifacts', '', 'ready'),
                               ('invoice_pdf_upload_attempts', ',writer_stopped_at=now()', 'published')]:
        p.run(p.scoped(103, f"UPDATE {table} SET state='deleted',deleted_at=now()-interval '8 days'{extra} WHERE id='{upload}'"))
        assert p.run(p.scoped(103, f"SELECT deleted_at > now()-interval '1 minute' FROM {table} WHERE id='{upload}'")).stdout.strip().endswith('t')
        result = p.run(p.scoped(103, f"UPDATE {table} SET state='{live}' WHERE id='{upload}'"), ok=False)
        assert 'pdf_deleted_terminal' in result.stderr, result.stderr
        assert p.run(p.scoped(103, f"SELECT state FROM {table} WHERE id='{upload}'")).stdout.strip().endswith('deleted')
    p.run(p.scoped(103, f"UPDATE invoice_pdf_jobs SET status='cancelled',clinic_slot=NULL,lease_token=NULL,lease_until=NULL,deadline_at=NULL WHERE id='{job}'"))


def cancellation_race():
    job, upload, sql = prepare()
    holder = subprocess.Popen(['docker','exec','-i',p.CONTAINER,'psql','-XqAt',
                               '-U','eyadex_app','-d',p.DATABASE,'-v','ON_ERROR_STOP=1'],
                              stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                              text=True,encoding='utf-8')
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        holder.stdin.write(p.scoped(103, f"BEGIN; UPDATE invoice_pdf_jobs SET status='cancelled',clinic_slot=NULL,lease_token=NULL,lease_until=NULL,deadline_at=NULL WHERE id='{job}';") + "\n\\echo lock-held\n")
        holder.stdin.flush()
        assert holder.stdout.readline().strip() == 'lock-held'
        name = 'pdf-upload-race-' + str(uuid.uuid4())
        pending = pool.submit(p.run, "SET application_name='" + name + "';" + p.scoped(103,sql), 'eyadex_app', None)
        until = time.monotonic() + 10
        blocked = False
        while time.monotonic() < until and not pending.done():
            result = p.run("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + name + "' AND cardinality(pg_blocking_pids(pid))>0", 'eyadex_owner')
            if result.stdout.strip() == '1':
                blocked = True
                break
            time.sleep(0.02)
        assert blocked, 'upload must wait for the concurrent job transition'
        holder.stdin.write('COMMIT;\n\\q\n')
        holder.stdin.flush()
        holder.wait(timeout=10)
        result = pending.result(timeout=10)
        assert result.returncode != 0 and 'pdf_upload_fence' in result.stderr, result.stderr
        assert p.run(p.scoped(103, f"SELECT count(*) FROM invoice_pdf_upload_attempts WHERE id='{upload}'")).stdout.strip().endswith('0')
    finally:
        if holder.poll() is None:
            holder.stdin.write('ROLLBACK;\n\\q\n')
            holder.stdin.flush()
            holder.wait(timeout=10)
        pool.shutdown(wait=True)


def artifact_sql(job, upload):
    return f"""INSERT INTO invoice_pdf_artifacts
      (clinic_id,id,job_id,upload_id,state,cipher_key_version,byte_length,published_at,expires_at)
      VALUES ('{p.uid(103)}','{uuid.uuid4()}','{job}','{upload}','ready',1,1,now(),now()+interval '24 hours')"""


def artifact_after_cleanup():
    job, upload, sql = prepare()
    p.run(p.scoped(103, sql))
    holder = subprocess.Popen(['docker','exec','-i',p.CONTAINER,'psql','-XqAt',
                               '-U','eyadex_app','-d',p.DATABASE,'-v','ON_ERROR_STOP=1'],
                              stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                              text=True,encoding='utf-8')
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        holder.stdin.write(p.scoped(103, f"BEGIN; UPDATE invoice_pdf_upload_attempts SET state='deleting',writer_stopped_at=now() WHERE id='{upload}';") + "\n\\echo lock-held\n")
        holder.stdin.flush()
        assert holder.stdout.readline().strip() == 'lock-held'
        name = 'pdf-artifact-race-' + str(uuid.uuid4())
        pending = pool.submit(p.run, "SET application_name='" + name + "';" + p.scoped(103,artifact_sql(job,upload)), 'eyadex_app', None)
        until = time.monotonic() + 10
        blocked = False
        while time.monotonic() < until and not pending.done():
            result = p.run("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + name + "' AND cardinality(pg_blocking_pids(pid))>0", 'eyadex_owner')
            if result.stdout.strip() == '1':
                blocked = True
                break
            time.sleep(0.02)
        assert blocked, 'artifact insertion must wait for upload cleanup'
        holder.stdin.write('COMMIT;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10)
        result = pending.result(timeout=10)
        assert result.returncode != 0 and 'pdf_artifact_upload' in result.stderr, result.stderr
    finally:
        if holder.poll() is None:
            holder.stdin.write('ROLLBACK;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10)
        pool.shutdown(wait=True)
    p.run(p.scoped(103, f"UPDATE invoice_pdf_upload_attempts SET state='deleted',deleted_at=now() WHERE id='{upload}'"))
    result = p.run(p.scoped(103,artifact_sql(job,upload)),ok=False)
    assert 'pdf_artifact_upload' in result.stderr, result.stderr
    p.run(p.scoped(103, f"UPDATE invoice_pdf_jobs SET status='cancelled',clinic_slot=NULL,lease_token=NULL,lease_until=NULL,deadline_at=NULL WHERE id='{job}'"))


if __name__ == '__main__':
    try:
        deletion()
        cancellation_race()
        artifact_after_cleanup()
        print('PASS: terminal evidence, cancellation fencing, and artifact/cleanup serialization')
    finally:
        (p.OUT/'transitions.json').write_text(__import__('json').dumps(p.results,indent=2),encoding='utf-8')
