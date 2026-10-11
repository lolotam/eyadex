#!/bin/sh
# 0050 (P2 release, R1-16, R2-3, R2-5): an existing clinic's system roles gain the medical keys by
# system_key, a custom role and the clinic's module flag do not change, the new-clinic default turns on,
# and db/maintenance/medical-release-catch-up.sql is exactly 0050's role statement. Builds a scratch
# database up to the file before 0050, seeds a clinic, applies the rest with db/migrate.sh, checks, drops it.
# Usage: sh db/tests/medical-release-backfill.sh   (libpq env vars; PGDATABASE = the admin database)
set -eu

t_dir=$(dirname "$0")
migrate="$t_dir/../migrate.sh"
repo_sql="$t_dir/../sql"
catch_up="$t_dir/../maintenance/medical-release-catch-up.sql"
admin_db="${PGDATABASE:-postgres}"
db="eyadex_medrelease_$$_$(date +%s)"
work=$(mktemp -d)
. "$t_dir/migrate-kit.sh"

cleanup() {
  PGDATABASE="$admin_db" psql -X -q -c "DROP DATABASE IF EXISTS \"$db\";" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

# The role statement: from its INSERT to its ON CONFLICT line, comments dropped.
statement() {
  sed -n '/^INSERT INTO role_permissions/,/^ON CONFLICT/p' "$1"
}
[ -n "$(statement "$repo_sql/0050_medical_release.sql")" ] || fail "0050 has no role statement"
statement "$repo_sql/0050_medical_release.sql" >"$work/migration.sql"
statement "$catch_up" >"$work/catch-up.sql"
cmp -s "$work/migration.sql" "$work/catch-up.sql" || fail "the catch-up differs from 0050's statement"
pass "the catch-up is 0050's role statement"

mkdir -p "$work/before" "$work/all"
for f in "$repo_sql"/*.sql; do
  cp "$f" "$work/all/"
  case "$(basename "$f")" in 00[5-9][0-9]_*) ;; *) cp "$f" "$work/before/" ;; esac
done

PGDATABASE="$admin_db" psql -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\";"
PGDATABASE="$db" MIGRATE_SQL_DIR="$work/before" sh "$migrate" >/dev/null
PGDATABASE="$db" psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO clinics VALUES ('00000000-0000-7000-8000-0000000050e1','mr-a','أ','A','general','ar',
  'Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO roles VALUES
  ('00000000-0000-7000-8000-0000000050e1','00000000-0000-7000-8000-0000000050f1','clinic_admin',
   'مدير','Admin',true,true,now(),now()),
  ('00000000-0000-7000-8000-0000000050e1','00000000-0000-7000-8000-0000000050f2','doctor',
   'طبيب','Doctor',false,true,now(),now()),
  ('00000000-0000-7000-8000-0000000050e1','00000000-0000-7000-8000-0000000050f3','receptionist',
   'استقبال','Front desk',false,true,now(),now()),
  ('00000000-0000-7000-8000-0000000050e1','00000000-0000-7000-8000-0000000050f4',NULL,
   'مخصص','Custom',false,true,now(),now());
INSERT INTO role_permissions SELECT '00000000-0000-7000-8000-0000000050e1', uuidv7(),
  '00000000-0000-7000-8000-0000000050f4', id, now() FROM permissions WHERE key = 'view:appointments:own';
INSERT INTO clinic_features VALUES ('00000000-0000-7000-8000-0000000050e1',
  '00000000-0000-7000-8000-0000000050f5','medical',false,now());
SQL
PGDATABASE="$db" MIGRATE_SQL_DIR="$work/all" sh "$migrate" >/dev/null || fail "0050 refused to apply"

query() {
  PGDATABASE="$db" psql -X -q -tA -v ON_ERROR_STOP=1 -c "$1"
}
keys() {
  query "SELECT coalesce(string_agg(p.key, ',' ORDER BY p.key COLLATE \"C\"), '')
         FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = '$1' AND p.module = '${2:-medical}';"
}
got=$(keys 00000000-0000-7000-8000-0000000050f1)
[ "$got" = "update:medicines:clinic,view:medicines:clinic,view:visits:clinic" ] ||
  fail "the admin role holds '$got'"
pass "the locked admin gains the visits and medicines keys, never a medical one"
got=$(keys 00000000-0000-7000-8000-0000000050f2)
[ "$got" = "create:visits:own,update:medical:own,view:medical:own,view:medicines:clinic,view:visits:own" ] ||
  fail "the doctor role holds '$got'"
got=$(keys 00000000-0000-7000-8000-0000000050f3)
[ "$got" = "view:visits:branch" ] || fail "the receptionist role holds '$got'"
pass "the doctor and the receptionist gain their keys"
got=$(keys 00000000-0000-7000-8000-0000000050f4)
[ "$got" = "" ] || fail "the custom role gained '$got'"
got=$(keys 00000000-0000-7000-8000-0000000050f4 appointments)
[ "$got" = "view:appointments:own" ] || fail "the custom role holds '$got'"
pass "a custom role does not change"
got=$(query "SELECT enabled FROM clinic_features WHERE module = 'medical';")
[ "$got" = "f" ] || fail "the clinic's medical module is '$got'"
got=$(query "SELECT default_module_medical FROM platform_settings;")
[ "$got" = "t" ] || fail "the new-clinic default for medical is '$got'"
pass "the clinic's module stays off and new clinics default to on"
echo "medical-release-backfill: all passed"
