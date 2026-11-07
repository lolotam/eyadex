"""Explicitly opted-in, isolated-cluster role reuse negatives; never a production probe."""
import importlib.util
import json
import os
from pathlib import Path

if os.environ.get('PDF_PROOF_ROLE_PREFLIGHT') != '1':
    raise SystemExit('PDF_PROOF_ROLE_PREFLIGHT=1 requires an isolated disposable cluster')
if not os.environ.get('PDF_PROOF_CONTAINER') or not os.environ.get('PDF_PROOF_DATABASE'):
    raise SystemExit('explicit proof container and database are required')
spec = importlib.util.spec_from_file_location('proof', Path(__file__).with_name('pdf-ledger-proof.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
original_db = p.DATABASE
base_db = 'eyadex_pdf_role_preflight'
sql_dir = Path(__file__).resolve().parents[1] / 'sql'
p.DATABASE = 'eyadex'
p.run('CREATE DATABASE ' + base_db, 'eyadex_owner')
p.DATABASE = base_db
safe = 'NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION'


def role_cases(role, migration):
    source = (sql_dir / migration).read_text(encoding='utf-8')
    cases = [(f'ALTER ROLE {role} {flag}', f'ALTER ROLE {role} {safe}')
             for flag in ['LOGIN','SUPERUSER','BYPASSRLS','CREATEDB','CREATEROLE','REPLICATION']]
    cases += [(f'GRANT {role} TO eyadex_app', f'REVOKE {role} FROM eyadex_app'),
              (f'GRANT eyadex_app TO {role}', f'REVOKE eyadex_app FROM {role}')]
    for setup, restore in cases:
        p.run(setup, 'eyadex_owner')
        try:
            result = p.run('BEGIN;\n' + source + '\nROLLBACK;', 'eyadex_owner', False)
            assert 'pdf_private_role_unsafe: ' + role in result.stderr, result.stderr
        finally:
            p.run(restore, 'eyadex_owner')
    # Safe pre-existing roles must remain usable by the real migration.
    p.run(source, 'eyadex_owner')


try:
    for migration in sorted(sql_dir.glob('*.sql')):
        if int(migration.name[:4]) < 77:
            p.run(migration.read_text(encoding='utf-8'), 'eyadex_owner')
    role_cases('eyadex_pdf_capacity', '0077_invoice_pdf_ledger.sql')
    role_cases('eyadex_pdf_retention', '0078_invoice_pdf_retention_clock.sql')
    print('PASS: 16 unsafe role configurations rejected; safe existing roles accepted')
finally:
    p.DATABASE = original_db
    (p.OUT/'role-preflight.json').write_text(json.dumps(p.results,indent=2),encoding='utf-8')
