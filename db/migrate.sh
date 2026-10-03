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

. "$script_dir/migrate-lib.sh"

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
check_unique_prefixes

has_ledger=0
case "$mode" in
  apply|baseline)
    ensure_ledger
    has_ledger=1
    check_missing || exit 1
    ;;
  status|dry-run)
    if ledger_exists; then
      has_ledger=1
      check_missing || exit 1
    fi
    ;;
esac

case "$mode" in
  status)
    if [ "$has_ledger" -eq 0 ]; then
      for f in "$sql_dir"/*.sql; do
        [ -e "$f" ] || continue
        base=$(basename "$f")
        echo "pending $base"
      done
      exit 0
    fi
    highest=$(highest_recorded_number)
    err=0
    for f in "$sql_dir"/*.sql; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      hash=$(file_hash "$f")
      recorded=$(recorded_hash "$base")
      if [ -z "$recorded" ]; then
        prefix=${base%%_*}
        if is_out_of_order "$prefix" "$highest"; then
          echo "OUT OF ORDER $base"
          err=1
        else
          echo "pending $base"
        fi
      elif [ "$recorded" = "$hash" ]; then
        echo "applied $base"
      else
        echo "CHANGED $base"
        echo "  recorded: $recorded"
        echo "  on disk:  $hash"
        err=1
      fi
    done
    exit "$err"
    ;;
  dry-run)
    if [ "$has_ledger" -eq 0 ]; then
      for f in "$sql_dir"/*.sql; do
        [ -e "$f" ] || continue
        base=$(basename "$f")
        echo "would apply $base"
      done
      exit 0
    fi
    for f in "$sql_dir"/*.sql; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      hash=$(file_hash "$f")
      if ! check_recorded "$base" "$hash"; then
        exit 1
      fi
    done
    check_forward_only
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
    check_forward_only
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
    check_forward_only
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
