# ADR-0015 — Deploying the worker

- Status: accepted
- Date: 2026-10-07

## Context

The worker (ADR-0013, ADR-0014) dispatches the outbox: invitation email through Resend, the platform SMTP
fallback, clinic mail providers, provider tests and branch auto-cancel. Production runs on Dokploy (Docker
Swarm + Traefik) next to the API (ADR-0007), PostgreSQL 18 and Redis 8.

## Decision

- **Image.** `apps/worker/Dockerfile`, built from the repository root, the same shape as the API image:
  `pnpm deploy --prod` with injected workspace packages gives a self-contained bundle (nodemailer included,
  no sources, no devDependencies). It runs as the non-root user `eyadex` on port 3002. CI builds and
  boot-checks it on every push (`worker-image` job).
- **No domain.** The worker is internal only: no Traefik route, no public port. Only Dokploy's health check
  and the operator reach it, on `dokploy-network`.
- **Liveness vs readiness.** The image's `HEALTHCHECK` is `GET /health`, which touches no dependency, so a
  database blip never restarts the container. `GET /health/ready` pings both pools and answers 503 when
  either is down; it is for operators and monitoring, not for restarts.
- **Stop grace period.** SIGTERM stops polling, lets the event in flight record its outcome, then closes
  the pools (`worker.ts`); a shutdown that never finishes is killed by a watchdog at
  `SHUTDOWN_WATCHDOG_MS` = 45 000 ms. The Dokploy stop grace period must exceed it (60 s), or the
  orchestrator kills the process before its clean exit 0.
- **Configuration**, only in the Dokploy application's environment (CLAUDE.md §8):
  - secrets: `DATABASE_URL` (as `eyadex_app`), `DISPATCHER_DATABASE_URL` (as `eyadex_dispatcher`),
    `OUTBOX_SEAL_KEY`, `MAIL_PROVIDER_SEAL_KEY`, `RESEND_API_KEY`, optional `SMTP_PASSWORD`;
  - non-secret: `APP_URL`, `MAIL_FROM`, optional `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` (all four SMTP
    keys or none), `OUTBOX_POLL_INTERVAL_MS`, `LOG_LEVEL`.
  - `OUTBOX_SEAL_KEY` and `MAIL_PROVIDER_SEAL_KEY` must equal the API's: the API seals, the worker opens.
- **Order.** Migrations 0029 and 0030 must be applied (CLAUDE.md §5.1, by hand) before the worker starts.
- **Replicas.** One is enough. More are safe — claims use `FOR UPDATE SKIP LOCKED` — but not needed.

## Consequences

- A worker outage delays mail and auto-cancel but loses nothing: events wait in the outbox.
- A seal key that differs from the API's makes every invitation fail `seal_unreadable`; rotating either
  key is a coordinated change to both services.
