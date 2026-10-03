# Eyadex

Eyadex is an Arabic-first management application for clinics of every specialty and branch. This repository currently contains the frontend demo and its typed, browser-persisted mock API.

Product domain: [eyadex.com](https://eyadex.com). Production hosting is configured from the root `Dockerfile` on Dokploy.

## Repository layout

This is a pnpm + Turborepo workspace:

```
apps/web/            @eyadex/web — the TanStack Start application
packages/contracts/  @eyadex/contracts — Zod schemas (the single source of types)
packages/config/     @eyadex/config — shared TypeScript presets and ESLint base
db/ docker/ docs/    SQL baseline, compose init scripts, PRD and ADRs
```

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js 24 and pnpm — install pnpm with [corepack](https://nodejs.org/api/corepack.html) (`corepack enable`), or use npm to install pnpm globally.

All commands run from the repository root:

```sh
git clone <this-repository-url>
cd <repository-name>
pnpm install
pnpm dev          # start the app in apps/web
pnpm typecheck    # tsc across every package
pnpm lint         # eslint
pnpm test         # vitest
pnpm format       # prettier --write .
```

To build the production bundle exactly as Dokploy does:

```sh
NITRO_PRESET=node-server pnpm build
docker compose up -d --build
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
- pnpm workspaces + Turborepo
