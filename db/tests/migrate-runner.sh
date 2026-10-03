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
db3="eyadex_migrate_test_${suffix}_c"
db4="eyadex_migrate_test_${suffix}_d"
work=$(mktemp -d)
. "$t_dir/migrate-kit.sh"

cleanup() {
  PGDATABASE="$admin_db" psql -X -q -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$db1\";" \
    -c "DROP DATABASE IF EXISTS \"$db2\";" \
    -c "DROP DATABASE IF EXISTS \"$db3\";" \
    -c "DROP DATABASE IF EXISTS \"$db4\";" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM


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
  -c "CREATE DATABASE \"$db1\";" \
  -c "CREATE DATABASE \"$db2\";" \
  -c "CREATE DATABASE \"$db3\";" \
  -c "CREATE DATABASE \"$db4\";" >/dev/null \
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
# The probe takes the next free number, so a real migration can never collide with it
# (a collision would fail on the duplicate prefix and never reach the SQL).
last=$(ls "$work" | sed -n 's/^\([0-9]\{4\}\)_.*/\1/p' | sort | tail -1 | sed 's/^0*//')
probe=$(printf '%04d_fail_probe.sql' $((${last:-0} + 1)))
printf '%s\n' \
  'CREATE TABLE migrate_probe_partial (id integer PRIMARY KEY);' \
  'THIS IS NOT VALID SQL;' >"$work/$probe"
if out=$(PGDATABASE="$db1" MIGRATE_SQL_DIR="$work" sh "$migrate" 2>&1); then
  fail "apply accepted a failing file"
fi
printf '%s' "$out" | grep -q 'syntax error' || fail "failing file was refused before its SQL ran"
[ -z "$(ledger_hash "$db1" "$probe")" ] \
  || fail "failing file left a ledger row"
[ "$(table_exists "$db1" migrate_probe_partial)" = "f" ] \
  || fail "failing file left partial objects"
[ "$(ledger_count "$db1")" = "$expected" ] || fail "ledger changed by failing file"
rm "$work/$probe"
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

# 7. Applied file removed from disk is reported MISSING.
work3="$work/missing"
mkdir -p "$work3"
cp "$repo_sql"/*.sql "$work3"/
out=$(PGDATABASE="$db3" MIGRATE_SQL_DIR="$work3" sh "$migrate" 2>&1) \
  || fail "fresh apply failed on scratch database: $out"
[ "$(ledger_count "$db3")" = "$expected" ] \
  || fail "ledger has $(ledger_count "$db3") rows, expected $expected"

missing_file="0001_clinics.sql"
rm "$work3/$missing_file"

if PGDATABASE="$db3" MIGRATE_SQL_DIR="$work3" sh "$migrate" >/dev/null 2>&1; then
  fail "apply accepted a missing applied file"
fi
if PGDATABASE="$db3" MIGRATE_SQL_DIR="$work3" sh "$migrate" --dry-run >/dev/null 2>&1; then
  fail "dry-run accepted a missing applied file"
fi
if PGDATABASE="$db3" MIGRATE_SQL_DIR="$work3" sh "$migrate" --status >/dev/null 2>&1; then
  fail "status accepted a missing applied file"
fi

status_out=$(PGDATABASE="$db3" MIGRATE_SQL_DIR="$work3" sh "$migrate" --status 2>&1 || true)
case "$status_out" in
  *"MISSING $missing_file"*) ;;
  *) fail "--status output did not contain 'MISSING $missing_file': $status_out" ;;
esac

[ "$(ledger_count "$db3")" = "$expected" ] \
  || fail "ledger row count changed after missing file checks"
pass "applied file removed from disk is reported MISSING"

# 8. --status and --dry-run on a fresh database leave to_regclass(public.schema_migrations) NULL.
out_status=$(PGDATABASE="$db4" MIGRATE_SQL_DIR="$work" sh "$migrate" --status 2>&1) \
  || fail "status failed on fresh database: $out_status"
case "$out_status" in
  *"pending 0001_clinics.sql"*) ;;
  *) fail "status on fresh db did not report pending 0001_clinics.sql: $out_status" ;;
esac
regclass=$(PGDATABASE="$db4" psql -X -q -tA -v ON_ERROR_STOP=1 \
  -c "SELECT to_regclass('public.schema_migrations');")
[ -z "$regclass" ] || fail "status created schema_migrations on fresh database"

out_dry=$(PGDATABASE="$db4" MIGRATE_SQL_DIR="$work" sh "$migrate" --dry-run 2>&1) \
  || fail "dry-run failed on fresh database: $out_dry"
case "$out_dry" in
  *"would apply 0001_clinics.sql"*) ;;
  *) fail "dry-run on fresh db did not report would apply 0001_clinics.sql: $out_dry" ;;
esac
regclass=$(PGDATABASE="$db4" psql -X -q -tA -v ON_ERROR_STOP=1 \
  -c "SELECT to_regclass('public.schema_migrations');")
[ -z "$regclass" ] || fail "dry-run created schema_migrations on fresh database"
pass "status and dry-run on fresh database leave schema_migrations NULL"

# 9. A duplicate prefix is refused.
work_dup="$work/dup"
mkdir -p "$work_dup"
cp "$repo_sql"/*.sql "$work_dup"/
cp "$work_dup/0001_clinics.sql" "$work_dup/0001_clinics_dup.sql"

if PGDATABASE="$db4" MIGRATE_SQL_DIR="$work_dup" sh "$migrate" >/dev/null 2>&1; then
  fail "apply accepted a duplicate prefix"
fi
if PGDATABASE="$db4" MIGRATE_SQL_DIR="$work_dup" sh "$migrate" --dry-run >/dev/null 2>&1; then
  fail "dry-run accepted a duplicate prefix"
fi
if PGDATABASE="$db4" MIGRATE_SQL_DIR="$work_dup" sh "$migrate" --status >/dev/null 2>&1; then
  fail "status accepted a duplicate prefix"
fi
dup_out=$(PGDATABASE="$db4" MIGRATE_SQL_DIR="$work_dup" sh "$migrate" 2>&1 || true)
case "$dup_out" in
  *"duplicate"*) ;;
  *) fail "expected duplicate prefix error message: $dup_out" ;;
esac
pass "duplicate prefix is refused"

# 10. After a full apply, a new file numbered below the highest applied number
# is refused by apply/dry-run/status and nothing is recorded.
out_apply=$(PGDATABASE="$db4" MIGRATE_SQL_DIR="$work" sh "$migrate" 2>&1) \
  || fail "apply failed on db4: $out_apply"
[ "$(ledger_count "$db4")" = "$expected" ] \
  || fail "db4 ledger has $(ledger_count "$db4") rows, expected $expected"
count_before=$(ledger_count "$db4")
highest_num=$(PGDATABASE="$db4" psql -X -q -tA -v ON_ERROR_STOP=1 \
  -c "SELECT substr(filename, 1, 4) FROM public.schema_migrations ORDER BY filename DESC LIMIT 1;")
[ -n "$highest_num" ] || fail "could not determine highest applied migration number"

work_order="$work/order"
mkdir -p "$work_order"
cp "$work"/*.sql "$work_order"/
printf '%s\n' 'CREATE TABLE migrate_order_probe (id integer PRIMARY KEY);' \
  >"$work_order/0000_order_probe.sql"

if PGDATABASE="$db4" MIGRATE_SQL_DIR="$work_order" sh "$migrate" >/dev/null 2>&1; then
  fail "apply accepted an out-of-order file"
fi
apply_order_out=$(PGDATABASE="$db4" MIGRATE_SQL_DIR="$work_order" sh "$migrate" 2>&1 || true)
case "$apply_order_out" in
  *"OUT OF ORDER 0000_order_probe.sql (highest applied $highest_num)"*) ;;
  *) fail "apply did not print expected OUT OF ORDER message: $apply_order_out" ;;
esac

if PGDATABASE="$db4" MIGRATE_SQL_DIR="$work_order" sh "$migrate" --dry-run >/dev/null 2>&1; then
  fail "dry-run accepted an out-of-order file"
fi
dry_order_out=$(PGDATABASE="$db4" MIGRATE_SQL_DIR="$work_order" sh "$migrate" --dry-run 2>&1 || true)
case "$dry_order_out" in
  *"OUT OF ORDER 0000_order_probe.sql (highest applied $highest_num)"*) ;;
  *) fail "dry-run did not print expected OUT OF ORDER message: $dry_order_out" ;;
esac

if PGDATABASE="$db4" MIGRATE_SQL_DIR="$work_order" sh "$migrate" --status >/dev/null 2>&1; then
  fail "status accepted an out-of-order file"
fi
status_order_out=$(PGDATABASE="$db4" MIGRATE_SQL_DIR="$work_order" sh "$migrate" --status 2>&1 || true)
case "$status_order_out" in
  *"OUT OF ORDER 0000_order_probe.sql"*) ;;
  *) fail "status did not print expected OUT OF ORDER message: $status_order_out" ;;
esac

[ "$(ledger_count "$db4")" = "$count_before" ] \
  || fail "out-of-order file changed the ledger row count"
[ -z "$(ledger_hash "$db4" 0000_order_probe.sql)" ] \
  || fail "out-of-order file was recorded in the ledger"
[ "$(table_exists "$db4" migrate_order_probe)" = "f" ] \
  || fail "out-of-order file executed DDL"
pass "out-of-order file refused by apply, dry-run, and status without recording"

# 11. A database that cannot be queried fails status and dry-run (never "all pending").
if PGDATABASE="eyadex_migrate_no_such_db_${suffix}" sh "$migrate" --status >/dev/null 2>&1; then
  fail "status succeeded against an unreachable database"
fi
if PGDATABASE="eyadex_migrate_no_such_db_${suffix}" sh "$migrate" --dry-run >/dev/null 2>&1; then
  fail "dry-run succeeded against an unreachable database"
fi
pass "status and dry-run fail when the database cannot be queried"

echo "migrate-runner: all passed"
