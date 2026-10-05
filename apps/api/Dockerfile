# Eyadex API (NestJS on Fastify) — production image. Build from the repository root:
#   docker build -f apps/api/Dockerfile .
# Same store-first layering as the root (web) Dockerfile: `pnpm fetch` reads pnpm-lock.yaml alone, so a new
# workspace package never needs another COPY line here. The runtime stage receives a `pnpm deploy` bundle:
# apps/api's production dependencies plus the built workspace packages it imports — no sources, no
# devDependencies, no other app.

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
# apps/api and every workspace package it depends on (they are consumed from dist/).
RUN pnpm --filter "@eyadex/api..." build
# A self-contained copy of apps/api with its production dependencies; workspace packages are copied in
# (injected), not symlinked to sources that the runtime stage does not have.
RUN pnpm --filter @eyadex/api deploy --prod --config.inject-workspace-packages=true /out

# ---- runtime ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
RUN addgroup -S eyadex && adduser -S eyadex -G eyadex
COPY --from=build --chown=eyadex:eyadex /out ./
USER eyadex
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/v1/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]
