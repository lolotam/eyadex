#!/usr/bin/env bash
# Called only inside the disposable CI PostgreSQL service.
set -euo pipefail
: "${PDF_PROOF_CONTAINER:?}"
: "${PDF_PROOF_DATABASE:?}"
: "${PDF_PROOF_OUTPUT:?}"
mkdir -p "$PDF_PROOF_OUTPUT"
PDF_PROOF_ROLE_PREFLIGHT=1 python3 db/tests/pdf-ledger-role-preflight.py
docker exec "$PDF_PROOF_CONTAINER" createdb -U eyadex_owner -T eyadex "$PDF_PROOF_DATABASE"
docker exec -i "$PDF_PROOF_CONTAINER" psql -U eyadex_owner -d "$PDF_PROOF_DATABASE" -v ON_ERROR_STOP=1 < db/sql/0022_revoke_temporary.sql
python3 db/tests/pdf-ledger-proof.py
python3 db/tests/pdf-ledger-integrity.py
python3 db/tests/pdf-ledger-transitions.py
docker exec "$PDF_PROOF_CONTAINER" createdb -U eyadex_owner -T eyadex eyadex_pdf_rollback
docker exec -i "$PDF_PROOF_CONTAINER" psql -U eyadex_owner -d eyadex_pdf_rollback -v ON_ERROR_STOP=1 < db/sql/0022_revoke_temporary.sql
PDF_PROOF_DATABASE=eyadex_pdf_rollback python3 db/tests/pdf-ledger-rollback.py
