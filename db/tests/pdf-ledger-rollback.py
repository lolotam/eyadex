"""Rollback-only isolation must not consume or lock live admission capacity."""
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location('proof', Path(__file__).with_name('pdf-ledger-proof.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def expanded(path):
    lines = []
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('\\ir '):
            lines.append(expanded(path.parent / line[4:]))
        else:
            lines.append(line)
    return '\n'.join(lines) + '\n'


def proof():
    # Keep A/B fixture ids unused while filling all committed global slots.
    p.seed(1001, 1103)
    p.run("""INSERT INTO invoice_pdf_jobs
      (clinic_id,id,invoice_id,invoice_version,render_revision,clinic_slot,created_at,updated_at)
      SELECT id,id,id,1,'v1:1:1:1',1,now(),now() FROM clinics
      WHERE slug LIKE 'pdf-proof-%' AND substring(slug from 11)::integer BETWEEN 1001 AND 1100""", 'eyadex_owner')
    assert p.count() == 100
    holder = subprocess.Popen(['docker','exec','-i',p.CONTAINER,'psql','-XqAt',
                               '-U','eyadex_owner','-d',p.DATABASE,'-v','ON_ERROR_STOP=1'],
                              stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                              text=True,encoding='utf-8')
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        holder.stdin.write("BEGIN; DO $$ BEGIN PERFORM 1 FROM invoice_pdf_capacity FOR UPDATE; END $$;\n\\echo lock-held\n")
        holder.stdin.flush()
        assert holder.stdout.readline().strip() == 'lock-held'
        pending = pool.submit(p.run, expanded(Path(__file__).with_name('rls-isolation.sql')), 'eyadex_owner')
        # A global-row write would block here; the rollback fixture must finish independently.
        result = pending.result(timeout=15)
        assert 'RLS isolation tests: all passed' in result.stdout, result.stdout
    finally:
        if holder.poll() is None:
            holder.stdin.write('ROLLBACK;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10)
        pool.shutdown(wait=True)
    assert p.count() == 100
    # Explicit deferral never permits committing over capacity.
    result = p.run(p.scoped(1101, 'BEGIN; SET CONSTRAINTS invoice_pdf_capacity_change DEFERRED; '
                             + p.insert(1101) + ' COMMIT;'), ok=False)
    assert 'invoice_pdf_capacity_admitted_check' in result.stderr, result.stderr
    assert p.count() == 100
    assert p.run(p.scoped(1101, 'SELECT count(*) FROM invoice_pdf_jobs')).stdout.strip().endswith('0')
    p.run("UPDATE invoice_pdf_jobs SET status='cancelled',clinic_slot=NULL WHERE status='queued'", 'eyadex_owner')
    assert p.count() == 0
    print('PASS: isolation rollback at full capacity does not acquire global lock; deferred over-capacity commit rejected')


try:
    proof()
finally:
    (p.OUT/'rollback.json').write_text(json.dumps(p.results,indent=2),encoding='utf-8')
