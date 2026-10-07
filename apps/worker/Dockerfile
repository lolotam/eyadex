# Eyadex worker (NestJS on Fastify, the outbox dispatcher) — production image. Build from the repository root:
#   docker build -f apps/worker/Dockerfile .
# Same store-first layering as apps/api/Dockerfile: `pnpm fetch` reads pnpm-lock.yaml alone, so a new
# workspace package never needs another COPY line here. The runtime stage receives a `pnpm deploy` bundle:
# apps/worker's production dependencies (nodemailer included) plus the built workspace packages it imports —
# no sources, no devDependencies, no other app.
# Stop grace period: the orchestrator's must exceed SHUTDOWN_WATCHDOG_MS = 45000 ms (apps/worker/src/worker.ts),
# e.g. 60 s, or it kills the process before the clean exit 0 (ADR-0015).

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
# apps/worker and every workspace package it depends on (they are consumed from dist/).
RUN pnpm --filter "@eyadex/worker..." build
# A self-contained copy of apps/worker with its production dependencies; workspace packages are copied in
# (injected), not symlinked to sources that the runtime stage does not have.
RUN pnpm --filter @eyadex/worker deploy --prod --config.inject-workspace-packages=true /out

# ---- runtime ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    WORKER_HOST=0.0.0.0 \
    WORKER_PORT=3002
RUN addgroup -S eyadex && adduser -S eyadex -G eyadex
COPY --from=build --chown=eyadex:eyadex /out ./
USER eyadex
EXPOSE 3002
# Liveness only: /health/ready pings the pools, and a database blip must not restart the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/health >/dev/null || exit 1
# `eyadex-runtime`: workspace packages resolve to their built dist/. No --env-file: the environment comes
# from the orchestrator only.
CMD ["node", "--conditions=eyadex-runtime", "dist/main.js"]
