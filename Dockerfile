# Eyadex web (TanStack Start SSR) — production image.
# pnpm workspace: the build context is the repo root, so the manifests of every
# workspace package are copied first to let the pnpm store layer be reused.
# Builds with Nitro's node-server preset (the Lovable default targets Cloudflare).

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate
ENV NITRO_PRESET=node-server
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
# No NODE_ENV yet: the build needs the devDependencies (vite, nitro), so pnpm must not be told to
# skip them. Production mode is set for the build step alone.
RUN pnpm install --frozen-lockfile
COPY . .
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
