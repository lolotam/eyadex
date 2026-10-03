#!/bin/sh
# Functions for db/migrate.sh (sourced, never run on its own). They read $sql_dir, $mode
# and $has_ledger from the caller.

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

# Checks whether the ledger table exists without modifying schema or grants.
ledger_exists() {
  res=$(psql -X -q -tA -v ON_ERROR_STOP=1 \
    -c 'SELECT to_regclass($$public.schema_migrations$$) IS NOT NULL;')
  [ "$res" = "t" ]
}

file_hash() {
  sha256sum "$1" | awk '{print $1}'
}

recorded_hash() {
  [ "$has_ledger" = "1" ] || return 0
  psql -X -q -tA -v ON_ERROR_STOP=1 -c \
    "SELECT sha256 FROM public.schema_migrations WHERE filename = '$1';"
}

highest_recorded_number() {
  [ "$has_ledger" = "1" ] || return 0
  psql -X -q -tA -v ON_ERROR_STOP=1 -c \
    'SELECT substr(filename, 1, 4) FROM public.schema_migrations ORDER BY filename DESC LIMIT 1;'
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

# Refuses if two files share the same 4-digit prefix.
check_unique_prefixes() {
  seen=""
  for f in "$sql_dir"/*.sql; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    prefix=${base%%_*}
    case " $seen " in
      *" $prefix "*)
        echo "migrate: duplicate migration prefix: $prefix" >&2
        exit 1
        ;;
    esac
    seen="$seen $prefix"
  done
}

# Returns 0 (true) if a pending file's 4-digit number is <= highest applied number.
is_out_of_order() {
  [ -n "$2" ] || return 1
  n=$1
  while [ "${n#0}" != "$n" ] && [ -n "${n#0}" ]; do
    n=${n#0}
  done
  h=$2
  while [ "${h#0}" != "$h" ] && [ -n "${h#0}" ]; do
    h=${h#0}
  done
  [ "$n" -le "$h" ]
}

# In apply, dry-run, and baseline: refuses any pending file whose 4-digit number
# is less than or equal to the highest number recorded in the ledger.
check_forward_only() {
  [ "$has_ledger" = "1" ] || return 0
  highest=$(highest_recorded_number)
  [ -n "$highest" ] || return 0
  out_of_order=0
  for f in "$sql_dir"/*.sql; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    recorded=$(recorded_hash "$base")
    if [ -z "$recorded" ]; then
      prefix=${base%%_*}
      if is_out_of_order "$prefix" "$highest"; then
        echo "OUT OF ORDER $base (highest applied $highest)" >&2
        out_of_order=1
      fi
    fi
  done
  if [ "$out_of_order" -eq 1 ]; then
    exit 1
  fi
}

# Refuses every ledger row with no matching file on disk, in every mode that
# reads the ledger. Prints MISSING lines to stderr (and to stdout for
# --status) and fails before applying or recording anything.
check_missing() {
  [ "$has_ledger" = "1" ] || return 0
  tmp=$(mktemp)
  # Called under `||`, where set -e is off: a failed ledger read must not look clean.
  if ! psql -X -q -tA -v ON_ERROR_STOP=1 \
    -c "SELECT filename FROM public.schema_migrations ORDER BY filename;" >"$tmp"; then
    rm -f "$tmp"
    echo "migrate: cannot read the ledger" >&2
    return 2
  fi
  missing=0
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    if [ ! -f "$sql_dir/$name" ]; then
      echo "MISSING $name" >&2
      if [ "$mode" = "status" ]; then
        echo "MISSING $name"
      fi
      missing=1
    fi
  done <"$tmp"
  rm -f "$tmp"
  return "$missing"
}
