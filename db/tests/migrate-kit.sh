#!/bin/sh
# Helpers for db/tests/migrate-runner.sh (sourced, never run on its own).

fail() {
  echo "migrate-runner: FAIL: $1" >&2
  exit 1
}

pass() {
  echo "migrate-runner: ok: $1"
}

ledger_count() {
  PGDATABASE="$1" psql -X -q -tA -v ON_ERROR_STOP=1 \
    -c "SELECT count(*) FROM public.schema_migrations;"
}

ledger_hash() {
  PGDATABASE="$1" psql -X -q -tA -v ON_ERROR_STOP=1 \
    -c "SELECT sha256 FROM public.schema_migrations WHERE filename = '$2';"
}

table_exists() {
  PGDATABASE="$1" psql -X -q -tA -v ON_ERROR_STOP=1 \
    -c "SELECT to_regclass('public.$2') IS NOT NULL;"
}

file_count() {
  n=0
  for f in "$1"/*.sql; do
    [ -e "$f" ] || continue
    n=$((n + 1))
  done
  echo "$n"
}
