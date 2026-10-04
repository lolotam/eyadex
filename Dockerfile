# Eyadex web (TanStack Start SSR) — production image.
# pnpm workspace: the store layer is filled from the lockfile ALONE, before any source is copied, so adding
# a workspace package never means another `COPY <pkg>/package.json` line here — `pnpm fetch` reads
# pnpm-lock.yaml alone and resolves every workspace package's dependencies from it. The offline install then
# links them. apps/api and apps/worker are installed too (their sources are not, until the COPY below); the
# runtime stage copies only apps/web/.output, so nothing of them reaches the image that Dokploy runs.
# Builds with Nitro's node-server preset (the Lovable default targets Cloudflare).

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate
ENV NITRO_PRESET=node-server
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# pnpm 12's fetch takes no --frozen-lockfile: it reads the lockfile and nothing else by construction.
RUN pnpm fetch
COPY . .
# Still no NODE_ENV: the build needs the devDependencies (vite, nitro), so pnpm must not skip them.
RUN pnpm install --offline --frozen-lockfile
# Production mode is set for the build step alone.
ENV NODE_ENV=production
RUN pnpm --filter @eyadex/web build

# ---- runtime ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
RUN addgroup -S eyadex && adduser -S eyadex -G eyadex
COPY --from=build --chown=eyadex:eyadex /app/apps/web/.output ./.output
USER eyadex
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/robots.txt >/dev/null || exit 1
CMD ["node", ".output/server/index.mjs"]
