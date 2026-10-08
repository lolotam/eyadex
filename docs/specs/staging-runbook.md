# Staging runbook (ADR-0021)

For the orchestrator, step by step. It creates the staging services on the production Dokploy host,
migrates the staging database, bootstraps the first platform account and checks the result. The owner
generates and pastes every secret; the orchestrator never types, reads or copies one (handoff §12).

## 0. Before you start

- The slice that added this runbook is merged, CI on that `main` SHA is green, and `docker/smoke-test.sh`
  exists at that SHA.
- The Dokploy connector points at musalam-2: `settings-getIp` must return `116.202.66.131`. Any other
  answer: stop.
- Find production's settings for the same service before creating each staging one (domain certificate
  setting, Postgres image tag, network). Copy the shape, never a value.
- The owner prepares, in a password manager, one fresh value for each secret in §10. Every password is
  `openssl rand -hex 32` (hex needs no URL escaping); each seal key is `openssl rand -base64 32`.
- Staging holds synthetic data only. Never a real patient, phone number, civil ID or clinic.

## 1. The `staging` branch

```sh
git fetch origin
git push origin <green main SHA>:refs/heads/staging   # first time: creates the branch
```

Promotion later is the same command with a newer SHA. Git refuses it unless it is a fast-forward, which
is the point: `staging` only ever holds commits that are already on `main`.

## 2. Where the services live

Project `Eyadex.com`. Put the staging services in a separate Dokploy environment named `staging` inside
that project, so environment-level variables can never leak between the two. If you keep them in the
`production` environment instead, the `-staging` suffix is the only separation, so check every variable
twice. Names:

| Service                   | Kind        | Source                                            |
| ------------------------- | ----------- | ------------------------------------------------- |
| `eyadex-postgres-staging` | Postgres    | PostgreSQL 18, the same image tag as prod         |
| `eyadex-redis-staging`    | Redis       | `redis:8-alpine`                                  |
| `eyadex-api-staging`      | Application | GitHub `lolotam/eyadex`, `apps/api/Dockerfile`    |
| `eyadex-worker-staging`   | Application | GitHub `lolotam/eyadex`, `apps/worker/Dockerfile` |
| `eyadex-web-staging`      | Application | GitHub `lolotam/eyadex`, `Dockerfile`             |

Write down the internal host name Dokploy gives each database service ("App Name"): the URLs below use
them as `<pg-staging>` and `<redis-staging>`.

## 3. `eyadex-postgres-staging`

1. Create the Postgres service: database `eyadex`, user `eyadex` (the owner, migrations only), password:
   the owner pastes **Postgres owner password**.
2. **No external port.** Internal on `dokploy-network` only.
3. Resources: memory limit 512 MB, reservation 256 MB. Restart policy: always.
4. Deploy, then wait for it to be healthy.
5. Backups: a daily backup to the same destination production uses, keeping 7.

### 3a. Runtime roles (no secret on the command line)

Create the four roles without a password, so none can log in yet. Run as the owner role inside the
container. This is `docker/postgres/init/01-roles.sh` without the passwords:

```sh
PG=$(docker ps --filter "name=<pg-staging>" --format '{{.Names}}' | head -1)
docker exec -i "$PG" psql -v ON_ERROR_STOP=1 -U eyadex -d eyadex <<'SQL'
CREATE ROLE eyadex_app        LOGIN NOBYPASSRLS;
CREATE ROLE eyadex_auth       LOGIN NOBYPASSRLS;
CREATE ROLE eyadex_platform   LOGIN NOBYPASSRLS;
CREATE ROLE eyadex_dispatcher LOGIN NOBYPASSRLS;
REVOKE ALL ON DATABASE eyadex FROM PUBLIC;
GRANT CONNECT ON DATABASE eyadex TO eyadex_app, eyadex_auth, eyadex_platform, eyadex_dispatcher;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO eyadex_app, eyadex_auth, eyadex_platform, eyadex_dispatcher;
SQL
```

The owner then sets the four passwords. `\password` prompts without echoing and sends only a SCRAM
hash, so no password reaches a log, a process list or the shell history:

```sh
docker exec -it "$PG" psql -U eyadex -d eyadex
# then, inside psql:  \password eyadex_app   \password eyadex_auth
#                     \password eyadex_platform   \password eyadex_dispatcher
```

### 3b. Migrations

Use the `db/` folder of the exact SHA `staging` points at, the way production is migrated
(handoff §3a). Export it with `git archive`, so the shell scripts keep LF line endings:

```sh
SHA=<staging SHA>
mkdir -p /root/eyadex-db-$SHA
git -C <a checkout of lolotam/eyadex> fetch origin && git -C <checkout> archive $SHA db | tar -x -C /root/eyadex-db-$SHA
docker cp /root/eyadex-db-$SHA/db "$PG":/tmp/eyadex-db-$SHA
docker exec "$PG" sh -c "cd /tmp/eyadex-db-$SHA && PGUSER=eyadex PGDATABASE=eyadex sh migrate.sh --status"
docker exec "$PG" sh -c "cd /tmp/eyadex-db-$SHA && PGUSER=eyadex PGDATABASE=eyadex sh migrate.sh --dry-run"
docker exec "$PG" sh -c "cd /tmp/eyadex-db-$SHA && PGOPTIONS='-c lock_timeout=5s' PGUSER=eyadex PGDATABASE=eyadex sh migrate.sh"
docker exec "$PG" sh -c "cd /tmp/eyadex-db-$SHA && PGUSER=eyadex PGDATABASE=eyadex sh migrate.sh --status"
docker exec "$PG" sh -c "cd /tmp/eyadex-db-$SHA && for f in tests/*.sql; do echo \$f; PGUSER=eyadex PGDATABASE=eyadex psql -v ON_ERROR_STOP=1 -q -f \$f >/dev/null || exit 1; done"
```

On a fresh database every file is pending; afterwards `--status` shows none pending and every
`tests/*.sql` passes (they roll back). On a later promotion, take `pg_dump -Fc` and
`pg_dumpall --roles-only` first, exactly like production.

### 3c. Check the roles

```sh
docker exec "$PG" psql -U eyadex -d eyadex -c "
  SELECT rolname, rolsuper, rolbypassrls, rolcanlogin,
         has_database_privilege(rolname, current_database(), 'TEMPORARY') AS temporary
  FROM pg_roles WHERE rolname IN ('eyadex_app','eyadex_auth','eyadex_platform','eyadex_dispatcher');"
```

Expected for all four: `rolsuper = f`, `rolbypassrls = f`, `rolcanlogin = t`, `temporary = f`
(migration 0022 revokes TEMPORARY). Anything else: stop.

## 4. `eyadex-redis-staging`

- Redis 8, password: the owner pastes **Redis password**. **No external port.**
- Memory limit 128 MB. If the service lets you set the command, add
  `--maxmemory 96mb --maxmemory-policy noeviction`: the rate-limit counters and the authorization cache
  must never be evicted silently.
- `REDIS_URL` for the api is `redis://default:<redis password>@<redis-staging>:6379/0`.

## 5. `eyadex-api-staging`

- Source: GitHub `lolotam/eyadex`, branch **`staging`**, auto-deploy on.
- Build type: Dockerfile. Dockerfile path `apps/api/Dockerfile`, context `.`.
- Domains (both with HTTPS, the same certificate setting as production's API domains):
  - `staging-app.eyadex.com`, path `/api`, **strip path on**, container port 3000;
  - `staging-platform.eyadex.com`, path `/api`, **strip path on**, container port 3000.
- Environment. Non-secret values, set by the orchestrator:

  ```
  APP_URL=https://staging-app.eyadex.com
  PLATFORM_URL=https://staging-platform.eyadex.com
  TRUST_PROXY_HOPS=1
  AUTH_COOKIE_PREFIX=eyadex-staging
  LOG_LEVEL=info
  ```

  Secrets, pasted by the owner: `DATABASE_URL`
  (`postgres://eyadex_app:<pw>@<pg-staging>:5432/eyadex`), `AUTH_DATABASE_URL` (`eyadex_auth`),
  `PLATFORM_DATABASE_URL` (`eyadex_platform`), `REDIS_URL`, `BETTER_AUTH_SECRET`, `OUTBOX_SEAL_KEY`,
  `MAIL_PROVIDER_SEAL_KEY`.

- Health check: the image's own (`GET /v1/health` every 30 s). Memory limit 512 MB, reservation 256 MB.
  Restart policy: on failure. One replica.
- Deploy only after §3 is done. Check: `https://staging-app.eyadex.com/api/v1/health` answers
  `{"status":"ok"}`.

## 6. `eyadex-worker-staging`

- Same source and branch. Dockerfile path `apps/worker/Dockerfile`, context `.`.
- **No domain.** Internal only.
- **Stop grace period: 60 s** (60000000000 ns). The worker's own watchdog fires at 45 s (ADR-0015).
- Environment. Non-secret, set by the orchestrator:

  ```
  APP_URL=https://staging-app.eyadex.com
  MAIL_FROM=Eyadex Staging <no-reply-staging@eyadex.com>
  LOG_LEVEL=info
  OUTBOX_POLL_INTERVAL_MS=2000
  ```

  Secrets, pasted by the owner: `DATABASE_URL` (`eyadex_app`), `DISPATCHER_DATABASE_URL`
  (`eyadex_dispatcher`), `OUTBOX_SEAL_KEY` and `MAIL_PROVIDER_SEAL_KEY` (the **same** values as the
  staging api's), `RESEND_API_KEY` (a staging key). Platform SMTP is optional: all four `SMTP_*` or none.

- `MAIL_FROM` must be on a domain verified in Resend; `eyadex.com` is the one in use. A staging subdomain
  sender would need its own DNS records in Resend first.
- Memory limit 384 MB. Restart policy: on failure. One replica.
- Check: `docker exec <worker> wget -qO- http://127.0.0.1:3002/health/ready` answers ready.

## 7. `eyadex-web-staging`

- Same source and branch. Dockerfile path `Dockerfile`, context `.`.
- Build arguments (build time, not runtime environment):

  ```
  VITE_API_MODE=http
  VITE_APP_HOST=staging-app.eyadex.com
  VITE_PLATFORM_HOST=staging-platform.eyadex.com
  ```

- Domains, HTTPS, path `/`, container port 3000: `staging-app.eyadex.com` and
  `staging-platform.eyadex.com`. The API's `/api` rule is longer, so it wins on `/api/*` (ADR-0007).
- No secrets. Memory limit 384 MB. Restart policy: on failure.

## 8. First platform account

Run by the **owner** on the host, once, after §5 is healthy. The password goes through stdin only:

```sh
API=$(docker ps --filter "name=<eyadex-api-staging app name>" --format '{{.Names}}' | head -1)
read -rs BOOTSTRAP_PASSWORD          # typed, not echoed, not in the history
export BOOTSTRAP_EMAIL='<platform staff email>' BOOTSTRAP_NAME='<full name>'
printf '%s\n' "$BOOTSTRAP_PASSWORD" | docker exec -i -e BOOTSTRAP_EMAIL -e BOOTSTRAP_NAME "$API" \
  node --conditions=eyadex-runtime dist/bootstrap-platform-account.js
unset BOOTSTRAP_PASSWORD
```

- `platform account created (user …)`: sign in on `https://staging-platform.eyadex.com/login` and enrol
  TOTP when asked (mandatory).
- `refused (platform_account_exists)`: the database already has one, and nothing was written.
- `refused (email_taken)`: the email has an account or a hold; nothing was written.
- The password must be 8–128 characters; use a fresh one from the password manager.

## 9. Smoke test, then the manual pass

From any machine with `curl`:

```sh
sh docker/smoke-test.sh staging-app.eyadex.com staging-platform.eyadex.com
```

It checks, with anonymous GETs only: both hosts serve the web (200), `/api/v1/health` is ok on both,
`/api/v1/me` and `/api/v1/platform/clinics` answer 401 without a session, a platform route on the clinic
host and a clinic route on the platform host answer 404, an unlisted auth route answers 404, and the
security headers are present on web and API answers. It exits non-zero on any failure.

Then, in a browser:

- [ ] Platform sign-in on `staging-platform.eyadex.com`, TOTP enrolment, the clinic list loads.
- [ ] The browser's cookies for the staging host are named `__Secure-eyadex-staging-platform.*`.
- [ ] `https://staging-app.eyadex.com/platform/clinics` shows the "wrong host" page linking to
      `staging-platform.eyadex.com`, not to a production host.
- [ ] Create a test clinic (synthetic name, a mailbox you own). The first-admin email arrives from
      `Eyadex Staging`, and its link opens `https://staging-app.eyadex.com/invite/…`.
- [ ] Accept, sign in on `staging-app.eyadex.com`; cookies are `__Secure-eyadex-staging-clinic.*`.
- [ ] Production still answers: `sh docker/smoke-test.sh app.eyadex.com platform.eyadex.com`
      (with `WEB_MODE=mock` while production's web is still the mock build).

## 10. Secrets the owner pastes (names only)

| Where                     | Secret                                                                     |
| ------------------------- | -------------------------------------------------------------------------- |
| `eyadex-postgres-staging` | Postgres owner password; the four role passwords via `\password` (§3a)     |
| `eyadex-redis-staging`    | Redis password                                                             |
| `eyadex-api-staging`      | `DATABASE_URL`, `AUTH_DATABASE_URL`, `PLATFORM_DATABASE_URL`, `REDIS_URL`, |
|                           | `BETTER_AUTH_SECRET`, `OUTBOX_SEAL_KEY`, `MAIL_PROVIDER_SEAL_KEY`          |
| `eyadex-worker-staging`   | `DATABASE_URL`, `DISPATCHER_DATABASE_URL`, `OUTBOX_SEAL_KEY`,              |
|                           | `MAIL_PROVIDER_SEAL_KEY`, `RESEND_API_KEY`, optional `SMTP_PASSWORD`       |
| bootstrap (§8, stdin)     | the first platform account's password                                      |

Every value is new for staging. None is copied from, or derived from, a production value.

## 11. Promotion, every time

1. Pick a `main` SHA with green CI.
2. If it brings new `db/sql` files: `pg_dump -Fc` the staging database, then §3b with that SHA.
3. `git push origin <sha>:refs/heads/staging`. Dokploy rebuilds the three applications.
4. `sh docker/smoke-test.sh staging-app.eyadex.com staging-platform.eyadex.com`.
5. Production gets the same migration only after staging has run it cleanly.

## 12. Rollback

- One service misbehaves: redeploy its previous deployment from the Dokploy deployment list.
- The whole release: `git push --force-with-lease origin <previous sha>:refs/heads/staging`, then
  redeploy. This is the only branch that may move backwards (ADR-0021); never `main` or `lovable`.
- Schema: forward-only. Fix a bad migration with a new file, or restore the dump from step 11.2
  (`pg_restore --clean`) when staging data is damaged; it is synthetic, so recreating it is also fine.
- Turning staging off: stop the three applications first, then Redis and Postgres. Nothing in
  production depends on them.
