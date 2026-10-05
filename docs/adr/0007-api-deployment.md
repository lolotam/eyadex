# ADR-0007 — Deploying the API

- Status: accepted
- Date: 2026-10-05

## Context

ADR-0004 makes every browser call same-origin: `https://app.eyadex.com/api/*` and
`https://platform.eyadex.com/api/*` must reach the API with `/api` stripped and the original host known.
Production runs on Dokploy (Docker Swarm + Traefik) next to the web app, PostgreSQL 18 and Redis 8.

## Decision

- **Image.** `apps/api/Dockerfile`, built from the repository root. `pnpm deploy --prod` with injected
  workspace packages gives a self-contained bundle (no sources, no devDependencies); it runs as the
  non-root user `eyadex`, health check `GET /v1/health`. CI builds it on every push (`api-image` job).
- **Routing.** A separate Dokploy application. Its domains are `app.eyadex.com` and `platform.eyadex.com`
  with path `/api` and _strip path_, so Traefik's longer rule wins over the web app's host-only rule and
  the API receives `/auth/*` and `/v1/*`.
- **Proxy trust.** Exactly one reverse proxy (Traefik) sits in front: `TRUST_PROXY_HOPS=1`. The area comes
  from the `X-Forwarded-Host` Traefik sets, and the client IP from the last `X-Forwarded-For` entry it
  appends (ADR-0004/0005).
- **Configuration.** Non-secret values (`APP_URL`, `PLATFORM_URL`, `TRUST_PROXY_HOPS`, `HOST`, `PORT`)
  and secrets (`DATABASE_URL` as `eyadex_app`, `AUTH_DATABASE_URL` as `eyadex_auth`,
  `BETTER_AUTH_SECRET`, `REDIS_URL`) live only in the Dokploy application's environment (CLAUDE.md §8).
  The API never connects as the owner role; migrations stay a separate, manual step (CLAUDE.md §5.1).
- **Better Auth's console logger is off** (`createAuth`): it wrote outside the sanitising logger.

## Consequences

- `api.eyadex.com` (PRD §4.15) is not used by browsers; it may later serve machine clients only.
- The image still carries web-only optional peers of better-auth (rolldown, react-dom, jsdom…, ~70 MB)
  that pnpm auto-installs; trimming them is a follow-up.
