#!/bin/sh
# Applies the versioned SQL baseline through db/migrate.sh. Runs once, on an empty
# data volume, right after 01-roles.sh. Existing databases are migrated by the
# orchestrator over SSH instead (apply for new files, --baseline for hand-applied ones).
set -eu

export PGUSER="${POSTGRES_USER:?}" PGDATABASE="${POSTGRES_DB:?}"
sh /db/migrate.sh
