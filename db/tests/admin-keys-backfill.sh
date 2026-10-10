#!/bin/sh
# 0042 backfill (ADR-0026 §6): every existing locked clinic_admin role gains the appointments module's
# clinic-scope keys, and no other role changes. Builds a scratch database up to 0041, seeds a clinic
# with an admin and a doctor role, applies the rest with db/migrate.sh, checks, drops it.
# Usage: sh db/tests/admin-keys-backfill.sh   (libpq env vars; PGDATABASE = the admin database)
set -eu

t_dir=$(dirname "$0")
migrate="$t_dir/../migrate.sh"
repo_sql="$t_dir/../sql"
admin_db="${PGDATABASE:-postgres}"
db="eyadex_adminkeys_$$_$(date +%s)"
work=$(mktemp -d)
. "$t_dir/migrate-kit.sh"

cleanup() {
  PGDATABASE="$admin_db" psql -X -q -c "DROP DATABASE IF EXISTS \"$db\";" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

mkdir -p "$work/before" "$work/all"
for f in "$repo_sql"/*.sql; do
  cp "$f" "$work/all/"
  case "$(basename "$f")" in 004[2-9]_* | 00[5-9]*) ;; *) cp "$f" "$work/before/" ;; esac
done

PGDATABASE="$admin_db" psql -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\";"
PGDATABASE="$db" MIGRATE_SQL_DIR="$work/before" sh "$migrate" >/dev/null
PGDATABASE="$db" psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO clinics VALUES ('00000000-0000-7000-8000-0000000042a1','ak-a','أ','A','general','ar',
  'Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO roles VALUES
  ('00000000-0000-7000-8000-0000000042a1','00000000-0000-7000-8000-0000000042b1','clinic_admin',
   'مدير','Admin',true,true,now(),now()),
  ('00000000-0000-7000-8000-0000000042a1','00000000-0000-7000-8000-0000000042b2','doctor',
   'طبيب','Doctor',false,true,now(),now());
INSERT INTO role_permissions SELECT '00000000-0000-7000-8000-0000000042a1', uuidv7(),
  '00000000-0000-7000-8000-0000000042b1', id, now() FROM permissions WHERE key = 'view:branches:clinic';
SQL
PGDATABASE="$db" MIGRATE_SQL_DIR="$work/all" sh "$migrate" >/dev/null || fail "0042 refused the backfill"

keys() {
  PGDATABASE="$db" psql -X -q -tA -v ON_ERROR_STOP=1 -c "
    SELECT coalesce(string_agg(p.key, ',' ORDER BY p.key COLLATE \"C\"), '')
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = '$1' AND p.module = 'appointments';"
}
want="create:appointments:clinic,create:services:clinic,deactivate:services:clinic,overbook:appointments:clinic,update:appointments:clinic,update:schedules:clinic,update:services:clinic,view:appointments:clinic,view:schedules:clinic,view:services:clinic"
got=$(keys 00000000-0000-7000-8000-0000000042b1)
[ "$got" = "$want" ] || fail "the admin role holds '$got'"
pass "a locked clinic admin holds every clinic-scope key of the appointments module"
got=$(keys 00000000-0000-7000-8000-0000000042b2)
[ "$got" = "" ] || fail "the doctor role gained '$got'"
pass "no other role changes"
echo "admin-keys-backfill: all passed"
