"""Synthetic local-only proof. Every runtime statement uses a real login connection."""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import uuid
import os

CONTAINER = 'eyadex-pdf-ledger-5e3991ef'
OUT = Path('F:/Dev/Temp/eyadex-pdf-ledger-5e3991ef')
DATABASE = os.environ.get('PDF_PROOF_DATABASE', 'eyadex_verified')
results = []


def run(sql, role='eyadex_app', ok=True):
    p = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-XAt',
                        '-U', role, '-d', DATABASE, '-v', 'ON_ERROR_STOP=1'],
                       input=sql, text=True, capture_output=True, timeout=90)
    results.append(dict(role=role, sql=sql, exit=p.returncode, stdout=p.stdout, stderr=p.stderr))
    if ok is not None:
        assert (p.returncode == 0) == ok, results[-1]
    return p


def uid(n):
    return f'00000000-0000-7000-8000-{n:012x}'


def scoped(n, sql):
    return f"SET app.clinic_id='{uid(n)}'; {sql}"


def insert(n, slot=1, job=None, invoice=None):
    job = job or str(uuid.uuid4())
    invoice = invoice or uid(n)
    return f"""INSERT INTO invoice_pdf_jobs
      (clinic_id,id,invoice_id,invoice_version,render_revision,clinic_slot,created_at,updated_at)
      VALUES ('{uid(n)}','{job}','{invoice}',1,'v1:1:1:1',{slot},now(),now());"""


def seed():
    run("""INSERT INTO clinics
      (id,slug,name_ar,name_en,specialty,default_language,timezone,status,expires_at,max_users,max_branches,created_at,updated_at)
      SELECT ('00000000-0000-7000-8000-'||lpad(to_hex(n),12,'0'))::uuid,'pdf-proof-'||n,
      'synthetic','synthetic','general','en','UTC','active',now()+interval '1 day',10,10,now(),now()
      FROM generate_series(1,103) n;
      INSERT INTO branches (clinic_id,id,name_ar,name_en,is_active,created_at,updated_at)
      SELECT id,id,'synthetic','synthetic',true,now(),now() FROM clinics WHERE slug LIKE 'pdf-proof-%';
      INSERT INTO patients (clinic_id,id,file_number,full_name,phone,birth_date,gender,registration_branch_id,status,created_at,updated_at)
      SELECT id,id,'1','synthetic','+96500000000','2000-01-01','male',id,'active',now(),now()
      FROM clinics WHERE slug LIKE 'pdf-proof-%';
      INSERT INTO invoices (clinic_id,id,branch_id,patient_id,year,number_seq,number,status,source,issued_at,
        currency,currency_exponent,subtotal_minor,discount_minor,tax_rate_bp,tax_minor,total_minor,created_by,created_at,updated_at)
      SELECT id,id,id,id,2026,1,'PROOF-1','issued','manual',now(),'KWD',3,0,0,0,0,0,id,now(),now()
      FROM clinics WHERE slug LIKE 'pdf-proof-%';""", 'eyadex_owner')


def count():
    p = run("SELECT admitted,(SELECT count(*) FROM invoice_pdf_jobs WHERE status IN ('queued','running','retry_wait')) FROM invoice_pdf_capacity", 'eyadex_owner')
    a, b = map(int, p.stdout.strip().split('|'))
    assert a == b
    return a


def proof():
    seed()
    assert run('SELECT current_user').stdout.strip() == 'eyadex_app'
    assert run('SELECT count(*) FROM invoice_pdf_jobs').stdout.strip() == '0'
    run(insert(1), ok=False)
    for role in ['eyadex_app', 'eyadex_platform', 'eyadex_auth', 'eyadex_dispatcher']:
        for statement in ['SELECT * FROM invoice_pdf_capacity', 'UPDATE invoice_pdf_capacity SET admitted=0',
                          'SELECT invoice_pdf_capacity_change()', 'ALTER TABLE invoice_pdf_jobs DISABLE TRIGGER ALL']:
            run(scoped(1, statement), role, False)
    for role in ['eyadex_platform', 'eyadex_auth', 'eyadex_dispatcher']:
        for table in ['invoice_pdf_jobs', 'invoice_pdf_upload_attempts', 'invoice_pdf_artifacts']:
            run(scoped(1, f'SELECT * FROM {table}'), role, False)
    run(scoped(1, insert(1, invoice=uid(2))), ok=False)
    run(scoped(1, insert(2)), ok=False)
    with concurrent.futures.ThreadPoolExecutor(max_workers=101) as pool:
        admissions = list(pool.map(lambda n: run(scoped(n, insert(n)), ok=None), range(1,102)))
    assert sum(p.returncode == 0 for p in admissions) == 100
    assert count() == 100
    run(scoped(102, insert(102)), ok=False)
    # Release once; repeated terminal transition must not decrement again.
    admitted = int(run('SELECT min(clinic_id::text) FROM invoice_pdf_jobs', 'eyadex_owner').stdout.strip()[-12:],16)
    release = "UPDATE invoice_pdf_jobs SET status='cancelled',clinic_slot=NULL"
    run(scoped(admitted, 'BEGIN; '+release+'; ROLLBACK;'))
    assert count() == 100
    run(scoped(admitted, release))
    run(scoped(admitted, release))
    assert count() == 99
    run(scoped(102, 'BEGIN; '+insert(102)+' ROLLBACK;'))
    assert count() == 99
    run(scoped(102, insert(102)))
    assert count() == 100
    for n in range(1,104):
        run(scoped(n, release))
    assert count() == 0
    # Same clinic: distinct invoice versions avoid dedup while racing for ten slots.
    with concurrent.futures.ThreadPoolExecutor(max_workers=11) as pool:
        admissions = list(pool.map(lambda n: run(scoped(103, insert(103, (n-1)%10+1).replace("'v1:1:1:1'", f"'v{n}:1:1:1'")), ok=None), range(1,12)))
    assert sum(p.returncode == 0 for p in admissions) == 10
    assert count() == 10
    assert run(scoped(1, 'SELECT count(*) FROM invoice_pdf_jobs WHERE clinic_id=\''+uid(103)+'\'')).stdout.strip().endswith('0')
    run(scoped(103, 'DELETE FROM invoice_pdf_jobs'), ok=False)
    run(scoped(103, 'UPDATE invoice_pdf_jobs SET invoice_version=2'), ok=False)
    run(scoped(103, "UPDATE invoice_pdf_jobs SET status='running'"), ok=False)
    run(scoped(103, 'UPDATE invoice_pdf_jobs SET clinic_slot=NULL'), ok=False)
    run(scoped(103, "UPDATE invoice_pdf_jobs SET render_revision='v2:1:1:1'"), ok=False)
    run(scoped(103, "INSERT INTO invoice_pdf_jobs SELECT * FROM invoice_pdf_jobs ON CONFLICT DO NOTHING"))
    assert count() == 10
    run(scoped(103, "UPDATE invoice_pdf_jobs SET status='running',attempt=attempt+1,fence=fence+1,lease_token=gen_random_uuid(),lease_until=now()+interval '20 seconds',deadline_at=now()+interval '60 seconds'"))
    assert count() == 10
    run(scoped(103, 'UPDATE invoice_pdf_jobs SET fence=0'), ok=False)
    run(scoped(103, "UPDATE invoice_pdf_jobs SET status='retry_wait',retry_count=1,next_attempt_at=now()+interval '30 seconds',lease_token=NULL,lease_until=NULL,deadline_at=NULL"))
    assert count() == 10
    run(scoped(103, release), ok=False)
    # Failed transition preserves both row and capacity, including the retry timestamp constraint.
    assert count() == 10
    run(scoped(103, release+',next_attempt_at=NULL'))
    assert count() == 0
    # Display changes increment; unrelated changes do not; callers cannot forge revisions.
    for table, column, predicate in [('clinics','name_en',f"id='{uid(103)}'"),
                                     ('branches','name_en',f"clinic_id='{uid(103)}'"),
                                     ('patients','full_name',f"clinic_id='{uid(103)}'")]:
        run(scoped(103, f"UPDATE {table} SET {column}='changed' WHERE {predicate}"))
        assert run(scoped(103, f'SELECT pdf_display_revision FROM {table} WHERE {predicate}')).stdout.strip().endswith('2')
        run(scoped(103, f'UPDATE {table} SET updated_at=now() WHERE {predicate}'))
        assert run(scoped(103, f'SELECT pdf_display_revision FROM {table} WHERE {predicate}')).stdout.strip().endswith('2')
        run(scoped(103, f'UPDATE {table} SET pdf_display_revision=999 WHERE {predicate}'), ok=False)


if __name__ == '__main__':
    try:
        proof()
        print('PASS: isolated roles, 101 global, 11 clinic, rollback, release, revisions')
    finally:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT/'proof.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
