#!/bin/sh
# Creates the runtime database roles from PRD §4.5. Runs once, on an empty data volume.
# The owner role (POSTGRES_USER) is only for migrations. No role gets BYPASSRLS.
# Table grants come later with the Drizzle migrations (Phase B), including:
# the platform role gets NO grant on patients or patient audit events.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE eyadex_app        LOGIN NOBYPASSRLS PASSWORD '${APP_DB_PASSWORD}';
CREATE ROLE eyadex_auth       LOGIN NOBYPASSRLS PASSWORD '${AUTH_DB_PASSWORD}';
CREATE ROLE eyadex_platform   LOGIN NOBYPASSRLS PASSWORD '${PLATFORM_DB_PASSWORD}';
CREATE ROLE eyadex_dispatcher LOGIN NOBYPASSRLS PASSWORD '${DISPATCHER_DB_PASSWORD}';

REVOKE ALL ON DATABASE "${POSTGRES_DB}" FROM PUBLIC;
GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO eyadex_app, eyadex_auth, eyadex_platform, eyadex_dispatcher;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO eyadex_app, eyadex_auth, eyadex_platform, eyadex_dispatcher;
SQL
