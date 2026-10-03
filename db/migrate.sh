#!/bin/sh
# Versioned runner for the db/sql PostgreSQL baseline (forward-only).
# Usage: sh db/migrate.sh [--status|--dry-run|--baseline UPTO]
# Connection comes from standard libpq env vars (PGHOST, PGPORT, PGUSER,
# PGDATABASE, PGPASSWORD). Never pass a password on the command line.
# Test hook: MIGRATE_SQL_DIR overrides the migrations directory (default: sql/ next
# to this script). Production is applied by the orchestrator over SSH, never by
# the app at startup.
set -eu

script_dir=$(dirname "$0")
sql_dir="${MIGRATE_SQL_DIR:-$script_dir/sql}"

if [ ! -d "$sql_dir" ]; then
  echo "migrate: no such directory: $sql_dir" >&2
  exit 1
fi

# The ledger records exactly which file bytes ran, so hand-applied databases can
# be adopted with --baseline and edited files are refused instead of half-applied.
ensure_ledger() {
  PGOPTIONS='-c client_min_messages=WARNING' psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename   text PRIMARY KEY,
  sha256     text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user
);
REVOKE ALL ON public.schema_migrations FROM PUBLIC;
DO $ledger$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_app') THEN
    REVOKE ALL ON public.schema_migrations FROM eyadex_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_auth') THEN
    REVOKE ALL ON public.schema_migrations FROM eyadex_auth;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_platform') THEN
    REVOKE ALL ON public.schema_migrations FROM eyadex_platform;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_dispatcher') THEN
    REVOKE ALL ON public.schema_migrations FROM eyadex_dispatcher;
  END IF;
END $ledger$;
SQL
}

file_hash() {
  sha256sum "$1" | awk '{print $1}'
}

recorded_hash() {
  psql -X -q -tA -v ON_ERROR_STOP=1 -c \
    "SELECT sha256 FROM public.schema_migrations WHERE filename = '$1';"
}

record_applied() {
  psql -X -q -v ON_ERROR_STOP=1 -c \
    "INSERT INTO public.schema_migrations (filename, sha256) VALUES ('$1', '$2');"
}

# Applies one file AND its ledger row in a single transaction, so a failure
# leaves neither partial DDL nor a ledger row.
apply_file() {
  base=$1
  hash=$2
  psql -X -q -v ON_ERROR_STOP=1 --single-transaction \
    -f "$sql_dir/$base" \
    -c "INSERT INTO public.schema_migrations (filename, sha256) VALUES ('$base', '$hash');"
  echo "applied $base"
}

# Fails when a recorded file no longer matches its bytes on disk. Callers run
# this check before applying anything, so a CHANGED file blocks the whole run.
check_recorded() {
  base=$1
  hash=$2
  recorded=$(recorded_hash "$base")
  if [ -n "$recorded" ] && [ "$recorded" != "$hash" ]; then
    echo "CHANGED $base" >&2
    echo "  recorded: $recorded" >&2
    echo "  on disk:  $hash" >&2
    return 1
  fi
  return 0
}

# A migration file name is interpolated into SQL string literals, so only the
# strict NNNN_name.sql shape is accepted (NNNN = 4 digits, rest = lowercase
# alnum plus underscore). Anything else is refused before it can touch SQL.
valid_name() {
  case "$1" in
    [0-9][0-9][0-9][0-9]_*.sql) ;;
    *) return 1 ;;
  esac
  rest=${1#?????}
  case "$rest" in
    *.sql) ;;
    *) return 1 ;;
  esac
  stem=${rest%.sql}
  [ -n "$stem" ] || return 1
  case "$stem" in
    *[!a-z0-9_]*) return 1 ;;
  esac
  return 0
}

# Refuses every unexpected file name before anything is applied or recorded,
# in every mode.
check_names() {
  for f in "$sql_dir"/*.sql; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    if ! valid_name "$base"; then
      echo "migrate: refusing unexpected file name: $base" >&2
      echo "migrate: names must match NNNN_name.sql (4 digits, lowercase alnum/underscore)" >&2
      exit 1
    fi
  done
}

mode="apply"
upto=""
if [ "$#" -gt 0 ]; then
  case "$1" in
    --status) mode="status" ;;
    --dry-run) mode="dry-run" ;;
    --baseline)
      mode="baseline"
      upto="${2:-}"
      case "$upto" in
        [0-9][0-9][0-9][0-9]) ;;
        *)
          echo "migrate: --baseline needs exactly 4 digits, e.g. --baseline 0019" >&2
          exit 1
          ;;
      esac
      ;;
    *) echo "migrate: unknown argument: $1" >&2; exit 1 ;;
  esac
fi

check_names
ensure_ledger

case "$mode" in
  status)
    changed=0
    for f in "$sql_dir"/*.sql; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      hash=$(file_hash "$f")
      recorded=$(recorded_hash "$base")
      if [ -z "$recorded" ]; then
        echo "pending $base"
      elif [ "$recorded" = "$hash" ]; then
        echo "applied $base"
      else
        echo "CHANGED $base"
        echo "  recorded: $recorded"
        echo "  on disk:  $hash"
        changed=1
      fi
    done
    exit "$changed"
    ;;
  dry-run)
    for f in "$sql_dir"/*.sql; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      hash=$(file_hash "$f")
      if ! check_recorded "$base" "$hash"; then
        exit 1
      fi
    done
    for f in "$sql_dir"/*.sql; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      hash=$(file_hash "$f")
      recorded=$(recorded_hash "$base")
      if [ -z "$recorded" ]; then
        echo "would apply $base"
      else
        echo "skip $base"
      fi
    done
    ;;
  baseline)
    # Pre-check every included file first, so a hash mismatch records nothing.
    changed=0
    stop=0
    for f in "$sql_dir"/*.sql; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      case "$base" in
        "$upto"_*) is_last=1 ;;
        *) is_last=0 ;;
      esac
      hash=$(file_hash "$f")
      if ! check_recorded "$base" "$hash"; then
        changed=1
      fi
      if [ "$is_last" -eq 1 ]; then
        stop=1
        break
      fi
    done
    if [ "$stop" -eq 0 ]; then
      echo "migrate: no file matches prefix: $upto" >&2
      exit 1
    fi
    if [ "$changed" -eq 1 ]; then
      exit 1
    fi
    for f in "$sql_dir"/*.sql; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      case "$base" in
        "$upto"_*) is_last=1 ;;
        *) is_last=0 ;;
      esac
      hash=$(file_hash "$f")
      recorded=$(recorded_hash "$base")
      if [ -z "$recorded" ]; then
        record_applied "$base" "$hash"
        echo "baselined $base"
      else
        echo "skip $base"
      fi
      if [ "$is_last" -eq 1 ]; then
        break
      fi
    done
    ;;
  apply)
    for f in "$sql_dir"/*.sql; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      hash=$(file_hash "$f")
      if ! check_recorded "$base" "$hash"; then
        exit 1
      fi
    done
    for f in "$sql_dir"/*.sql; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      hash=$(file_hash "$f")
      recorded=$(recorded_hash "$base")
      if [ -n "$recorded" ]; then
        echo "skip $base"
      else
        apply_file "$base" "$hash"
      fi
    done
    ;;
esac
