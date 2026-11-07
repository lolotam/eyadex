"""Independent login negative tests against the synthetic fixtures from pdf-ledger-proof.py."""
import importlib.util
import json
from pathlib import Path
import uuid

spec = importlib.util.spec_from_file_location('proof', Path(__file__).with_name('pdf-ledger-proof.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def proof():
    tables = ['invoice_pdf_jobs','invoice_pdf_upload_attempts','invoice_pdf_artifacts']
    assert p.run("SELECT count(*) FROM pg_class WHERE relname IN ('invoice_pdf_jobs','invoice_pdf_upload_attempts','invoice_pdf_artifacts') AND relrowsecurity AND relforcerowsecurity", 'eyadex_owner').stdout.strip() == '3'
    assert p.run("SELECT count(*) FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=i.indkey[0] WHERE t.relname IN ('invoice_pdf_jobs','invoice_pdf_upload_attempts','invoice_pdf_artifacts') AND a.attname<>'clinic_id'", 'eyadex_owner').stdout.strip() == '0'
    assert p.run("SELECT count(*) FROM pg_roles WHERE rolname IN ('eyadex_pdf_capacity','eyadex_pdf_retention') AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper", 'eyadex_owner').stdout.strip() == '2'
    for table in tables:
        assert p.run(f'SELECT count(*) FROM {table}').stdout.strip() == '0'
        for role in ['eyadex_platform','eyadex_auth','eyadex_dispatcher']:
            for sql in [f'INSERT INTO {table} DEFAULT VALUES', f'UPDATE {table} SET id=id', f'DELETE FROM {table}']:
                p.run(p.scoped(103,sql), role, False)
    job, upload = str(uuid.uuid4()), str(uuid.uuid4())
    p.run(p.scoped(103, p.insert(103, job=job)))
    p.run(p.scoped(103, f"UPDATE invoice_pdf_jobs SET status='running',attempt=1,fence=1,lease_token=gen_random_uuid(),lease_until=now()+interval '30 seconds',deadline_at=now()+interval '60 seconds' WHERE id='{job}'"))
    allocate = f"""INSERT INTO invoice_pdf_upload_attempts
      (clinic_id,id,job_id,attempt,fence,state,storage_key,upload_deadline_at,created_at,updated_at)
      VALUES ('{p.uid(103)}','{upload}','{job}',1,1,'allocated',
      'clinic/{p.uid(103)}/invoice-pdfs/{job}/{upload}',now()+interval '20 seconds',now(),now())"""
    p.run(p.scoped(102,allocate),ok=False)
    p.run(p.scoped(103,allocate.replace(",1,1,'allocated'",",1,2,'allocated'")),ok=False)
    beyond_lease = allocate.replace("interval '20 seconds'", "interval '40 seconds'")
    result = p.run(p.scoped(103,beyond_lease),ok=False)
    assert 'pdf_upload_fence' in result.stderr, result.stderr
    p.run(p.scoped(103,allocate))
    p.run(p.scoped(103,f"UPDATE invoice_pdf_upload_attempts SET fence=2 WHERE id='{upload}'"),ok=False)
    p.run(p.scoped(103,f"UPDATE invoice_pdf_upload_attempts SET state='deleted',deleted_at=now() WHERE id='{upload}'"),ok=False)
    p.run(p.scoped(103,f"UPDATE invoice_pdf_upload_attempts SET state='unknown',terminal_at=now()-interval '8 days' WHERE id='{upload}'"))
    assert p.run(p.scoped(103,f"SELECT terminal_at > now()-interval '1 minute' FROM invoice_pdf_upload_attempts WHERE id='{upload}'")).stdout.strip().endswith('t')
    for role in ['eyadex_app','eyadex_platform','eyadex_auth']:
        result = p.run(p.scoped(103,'SELECT purge_invoice_pdf_evidence()'),role,False)
        assert 'permission denied' in result.stderr, result.stderr
    p.run(p.scoped(103,'SELECT purge_invoice_pdf_evidence()'),'eyadex_dispatcher')
    assert p.run(p.scoped(103,f"SELECT count(*) FROM invoice_pdf_upload_attempts WHERE id='{upload}'")).stdout.strip().endswith('1')
    p.run(p.scoped(102,f"""INSERT INTO invoice_pdf_artifacts
      (clinic_id,id,job_id,upload_id,state,cipher_key_version,byte_length,published_at,expires_at)
      VALUES ('{p.uid(102)}','{uuid.uuid4()}','{job}','{upload}','ready',1,1,now(),now()+interval '24 hours')"""),ok=False)
    p.run(p.scoped(103,f"UPDATE invoice_pdf_jobs SET status='cancelled',clinic_slot=NULL,lease_token=NULL,lease_until=NULL,deadline_at=NULL WHERE id='{job}'"))
    # Retained evidence of a previous generation does not block a new authorized request.
    p.run(p.scoped(103,p.insert(103)))
    p.run(p.scoped(103,"UPDATE invoice_pdf_jobs SET status='cancelled',clinic_slot=NULL WHERE status='queued'"))
    assert p.count() == 0
    recent = str(uuid.uuid4())
    p.run(p.scoped(103,p.insert(103,job=recent)))
    p.run(p.scoped(103,f"UPDATE invoice_pdf_jobs SET status='cancelled',clinic_slot=NULL,updated_at=now()-interval '8 days' WHERE id='{recent}'"))
    p.run(p.scoped(103,'SELECT purge_invoice_pdf_evidence()'),'eyadex_dispatcher')
    assert p.run(p.scoped(103,f"SELECT count(*) FROM invoice_pdf_jobs WHERE id='{recent}'")).stdout.strip().endswith('1')
    assert p.run(p.scoped(103,f"SELECT updated_at > now()-interval '1 minute' FROM invoice_pdf_jobs WHERE id='{recent}'")).stdout.strip().endswith('t')
    print('PASS: all-role write denials, upload fence, cross-clinic artifact FK, unknown retention, regeneration')


try:
    proof()
finally:
    (p.OUT/'integrity.json').write_text(json.dumps(p.results,indent=2),encoding='utf-8')
