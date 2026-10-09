#!/bin/sh
# 0037 backfill (ADR-0020): platform users made by hand before the team table become active members
# AND hold their email as a 'platform' reservation; a live clinic hold on such an email fails the file.
# 0039 then backfills that first account's platform_account.bootstrapped audit row (ADR-0021).
# Builds scratch databases up to 0036, seeds them, then applies 0037 with db/migrate.sh. Drops them.
# Usage: sh db/tests/platform-backfill.sh   (libpq env vars; PGDATABASE = the admin database)
set -eu

t_dir=$(dirname "$0")
migrate="$t_dir/../migrate.sh"
repo_sql="$t_dir/../sql"
admin_db="${PGDATABASE:-postgres}"
suffix="$$_$(date +%s)"
ok_db="eyadex_backfill_${suffix}_ok"
bad_db="eyadex_backfill_${suffix}_bad"
work=$(mktemp -d)
. "$t_dir/migrate-kit.sh"

cleanup() {
  PGDATABASE="$admin_db" psql -X -q -c "DROP DATABASE IF EXISTS \"$ok_db\";" \
    -c "DROP DATABASE IF EXISTS \"$bad_db\";" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

mkdir -p "$work/upto36" "$work/all"
for f in "$repo_sql"/*.sql; do
  cp "$f" "$work/all/"
  case "$(basename "$f")" in 003[7-9]_* | 00[4-9]*) ;; *) cp "$f" "$work/upto36/" ;; esac
done
# 0037 (team rows, email holds) and 0039 (the bootstrap audit backfill) matter here; every later file
# is applied too, so the test follows the real order.

# One platform user made by hand, and a clinic whose admin is a clinic member.
seed() {
  PGDATABASE="$1" psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO clinics VALUES ('00000000-0000-7000-8000-0000000012a1','bf-a','أ','A','general','ar',
  'Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO auth_users (id, name, email, email_verified, image, two_factor_enabled, created_at,
    updated_at, area)
  VALUES ('00000000-0000-7000-8000-0000000012b1','Owner','owner@example.test',true,NULL,true,now(),
    now(),'platform');
SQL
}

for db in "$ok_db" "$bad_db"; do
  PGDATABASE="$admin_db" psql -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\";"
  PGDATABASE="$db" MIGRATE_SQL_DIR="$work/upto36" sh "$migrate" >/dev/null
  seed "$db"
done

# 1. No conflicting hold: the account is active and its email is held for the platform.
PGDATABASE="$ok_db" MIGRATE_SQL_DIR="$work/all" sh "$migrate" || fail "0037 refused a clean backfill"
got=$(PGDATABASE="$ok_db" psql -X -q -tA -v ON_ERROR_STOP=1 -c "
  SELECT (SELECT status FROM platform_accounts WHERE email = 'owner@example.test')
    || '/' || (SELECT kind FROM email_reservations WHERE email = 'owner@example.test');")
[ "$got" = "active/platform" ] || fail "backfill gave '$got', want active/platform"
pass "a hand-made platform user is an active member holding a platform reservation"
got=$(PGDATABASE="$ok_db" psql -X -q -tA -v ON_ERROR_STOP=1 -c "
  SELECT count(*) || '/' || bool_and((details ->> 'backfilled')::boolean)
    || '/' || bool_and(details = jsonb_build_object('accountId', actor_user_id::text,
         'after', jsonb_build_object('status', 'active'), 'backfilled', true))
  FROM platform_audit_log
  WHERE action = 'platform_account.bootstrapped'
    AND actor_user_id = '00000000-0000-7000-8000-0000000012b1';")
[ "$got" = "1/true/true" ] || fail "0039 bootstrap backfill gave '$got', want one backfilled row (1/true/true)"
pass "0039 backfills one platform_account.bootstrapped row, no typed text, for a first account made before it"

# 2. A clinic membership already holds that email: 0037 fails and writes nothing.
PGDATABASE="$bad_db" psql -X -q -v ON_ERROR_STOP=1 -c "
  INSERT INTO email_reservations (email, kind, clinic_id, invitation_id, expires_at, reserved_at)
  VALUES ('owner@example.test', 'membership', '00000000-0000-7000-8000-0000000012a1', NULL, NULL, now());"
if PGDATABASE="$bad_db" MIGRATE_SQL_DIR="$work/all" sh "$migrate" >/dev/null 2>&1; then
  fail "0037 applied over a clinic hold on a platform email"
fi
[ "$(table_exists "$bad_db" platform_accounts)" = "f" ] || fail "a failed 0037 left platform_accounts behind"
pass "a clinic hold on a platform email fails 0037 and rolls it back"

echo "platform-backfill: all passed"
