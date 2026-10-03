#!/bin/sh
# Self-test for db/migrate.sh. Runs against scratch databases it creates and
# drops, so it never touches the current database's schema or ledger.
# Usage: sh db/tests/migrate-runner.sh
# Connection comes from standard libpq env vars (PGHOST, PGPORT, PGUSER,
# PGPASSWORD); PGDATABASE selects the admin database used to CREATE/DROP the
# scratch databases (the CI `eyadex` database).
set -eu

t_dir=$(dirname "$0")
migrate="$t_dir/../migrate.sh"
repo_sql="$t_dir/../sql"
admin_db="${PGDATABASE:-postgres}"
suffix="$$_$(date +%s)"
db1="eyadex_migrate_test_${suffix}_a"
db2="eyadex_migrate_test_${suffix}_b"
work=$(mktemp -d)

fail() {
  echo "migrate-runner: FAIL: $1" >&2
  exit 1
}

pass() {
  echo "migrate-runner: ok: $1"
}

cleanup() {
  PGDATABASE="$admin_db" psql -X -q -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$db1\";" \
    -c "DROP DATABASE IF EXISTS \"$db2\";" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

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

[ -d "$repo_sql" ] || fail "no such directory: $repo_sql"

# Runtime roles are grant targets of the baseline; create them cluster-wide when
# missing (no login, no password: they only need to exist for GRANT/REVOKE).
PGDATABASE="$admin_db" psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $roles$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_app') THEN
    CREATE ROLE eyadex_app NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_auth') THEN
    CREATE ROLE eyadex_auth NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_platform') THEN
    CREATE ROLE eyadex_platform NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_dispatcher') THEN
    CREATE ROLE eyadex_dispatcher NOBYPASSRLS;
  END IF;
END $roles$;
SQL

PGDATABASE="$admin_db" psql -X -q -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"$db1\";" -c "CREATE DATABASE \"$db2\";" >/dev/null \
  || fail "cannot create scratch databases"

# Work on copies, so editing an applied file never touches the real baseline.
cp "$repo_sql"/*.sql "$work"/
expected=$(file_count "$work")
[ "$expected" -ge 19 ] || fail "expected 19+ migration files, found $expected"

# 1. A fresh apply records one ledger row per file.
out=$(PGDATABASE="$db1" MIGRATE_SQL_DIR="$work" sh "$migrate" 2>&1) \
  || fail "fresh apply failed: $out"
[ "$(ledger_count "$db1")" = "$expected" ] \
  || fail "ledger has $(ledger_count "$db1") rows, expected $expected"
[ "$(table_exists "$db1" clinics)" = "t" ] || fail "clinics missing after apply"
pass "fresh apply records $expected rows"

# 2. A second run applies nothing.
out=$(PGDATABASE="$db1" MIGRATE_SQL_DIR="$work" sh "$migrate" 2>&1) \
  || fail "second run failed: $out"
case "$out" in
  *applied\ *) fail "second run applied something: $out" ;;
esac
[ "$(ledger_count "$db1")" = "$expected" ] || fail "ledger changed on second run"
pass "second run applies nothing"

# --status is clean right after an apply.
PGDATABASE="$db1" MIGRATE_SQL_DIR="$work" sh "$migrate" --status >/dev/null \
  || fail "status is not clean after apply"
pass "status clean after apply"

# 3. Editing an applied file makes apply and status fail.
echo "-- migrate-runner probe edit" >>"$work/0001_clinics.sql"
if PGDATABASE="$db1" MIGRATE_SQL_DIR="$work" sh "$migrate" >/dev/null 2>&1; then
  fail "apply accepted an edited file"
fi
if PGDATABASE="$db1" MIGRATE_SQL_DIR="$work" sh "$migrate" --status >/dev/null 2>&1; then
  fail "status accepted an edited file"
fi
cp "$repo_sql/0001_clinics.sql" "$work/0001_clinics.sql"
pass "edited file fails apply and status"
PGDATABASE="$db1" MIGRATE_SQL_DIR="$work" sh "$migrate" --status >/dev/null \
  || fail "status not clean after restoring the file"

# 4. A failing new file leaves no ledger row and no partial objects.
printf '%s\n' \
  'CREATE TABLE migrate_probe_partial (id integer PRIMARY KEY);' \
  'THIS IS NOT VALID SQL;' >"$work/0021_fail_probe.sql"
if PGDATABASE="$db1" MIGRATE_SQL_DIR="$work" sh "$migrate" >/dev/null 2>&1; then
  fail "apply accepted a failing file"
fi
[ -z "$(ledger_hash "$db1" 0021_fail_probe.sql)" ] \
  || fail "failing file left a ledger row"
[ "$(table_exists "$db1" migrate_probe_partial)" = "f" ] \
  || fail "failing file left partial objects"
[ "$(ledger_count "$db1")" = "$expected" ] || fail "ledger changed by failing file"
rm "$work/0021_fail_probe.sql"
pass "failing file is fully rolled back"

# 5. Baseline mode records without executing.
out=$(PGDATABASE="$db2" MIGRATE_SQL_DIR="$work" sh "$migrate" --baseline 0019 2>&1) \
  || fail "baseline failed: $out"
baselined=0
for f in "$work"/00*.sql; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in
    0020*) break ;;
  esac
  baselined=$((baselined + 1))
done
[ "$(ledger_count "$db2")" = "$baselined" ] \
  || fail "ledger has $(ledger_count "$db2") rows, expected $baselined"
[ "$(table_exists "$db2" clinics)" = "f" ] \
  || fail "baseline executed files instead of only recording them"
if PGDATABASE="$db2" MIGRATE_SQL_DIR="$work" sh "$migrate" --status >/dev/null 2>&1; then
  : # pending files are fine, CHANGED files are not; status exits 0 here
else
  fail "status failed after baseline without any CHANGED file"
fi
# Baseline refuses files whose bytes changed after recording.
echo "-- migrate-runner probe edit" >>"$work/0002_clinic_features.sql"
if PGDATABASE="$db2" MIGRATE_SQL_DIR="$work" sh "$migrate" --baseline 0019 >/dev/null 2>&1; then
  fail "baseline accepted an edited file"
fi
cp "$repo_sql/0002_clinic_features.sql" "$work/0002_clinic_features.sql"
pass "baseline records without executing and refuses edited files"

# 6. Baseline refuses a prefix that is not exactly 4 digits.
if PGDATABASE="$db2" MIGRATE_SQL_DIR="$work" sh "$migrate" --baseline 001 >/dev/null 2>&1; then
  fail "baseline accepted a 3-digit prefix"
fi
if PGDATABASE="$db2" MIGRATE_SQL_DIR="$work" sh "$migrate" --baseline 0010x >/dev/null 2>&1; then
  fail "baseline accepted a non-numeric prefix"
fi
pass "baseline refuses prefixes that are not exactly 4 digits"

echo "migrate-runner: all passed"
