#!/bin/sh
# 0063 (finance F1 release, R2-4): db/maintenance/finance-release-catch-up.sql is exactly 0063's role
# statement, so running it after the deploy grants what the migration granted and nothing else.
# It is also 0067's statement (finance F2, spec §4.5): the catch-up is reused as is and grants the five
# F2 clinic-scope keys too, so the two releases never drift apart.
# db/tests/finance-release.sql checks what the statement does; this checks the two never drift apart.
# Usage: sh db/tests/finance-release-catch-up.sh
set -eu

t_dir=$(dirname "$0")
work=$(mktemp -d)
. "$t_dir/migrate-kit.sh"
trap 'rm -rf "$work"' EXIT INT TERM

# The role statement: from its INSERT to its ON CONFLICT line, comments dropped.
statement() {
  sed -n '/^INSERT INTO role_permissions/,/^ON CONFLICT/p' "$1"
}
statement "$t_dir/../sql/0063_finance_release.sql" >"$work/migration.sql"
[ -s "$work/migration.sql" ] || fail "0063 has no role statement"
statement "$t_dir/../maintenance/finance-release-catch-up.sql" >"$work/catch-up.sql"
cmp -s "$work/migration.sql" "$work/catch-up.sql" || fail "the catch-up differs from 0063's statement"
pass "the catch-up is 0063's role statement"
statement "$t_dir/../sql/0067_finance_payments_release.sql" >"$work/migration-0067.sql"
[ -s "$work/migration-0067.sql" ] || fail "0067 has no role statement"
cmp -s "$work/migration-0067.sql" "$work/catch-up.sql" || fail "the catch-up differs from 0067's statement"
pass "the catch-up is 0067's role statement"
