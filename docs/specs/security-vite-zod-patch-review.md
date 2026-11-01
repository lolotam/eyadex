# Vite 8.1.6 and Zod 4.6.6 patch review

Research time: 2026-10-26T07:31:24Z, corrected the same day after review. This note records one compatible increment. It does not clear the audit, and the sections below keep that increment's evidence. They are not the current graph.

Later status, stage 2 implementer, not a manager clearance: the four direct Zod pins (`apps/api`, `apps/worker`, `apps/web`, `packages/contracts`) are now exact `4.6.6`. `packages/auth` was already `4.6.6`. The Vite `8.1.6` pin, the three TanStack parent selectors, `rolldown@1.2.1`, and `launch-editor@2.14.2` are unchanged. Current worker evidence is in `docs/specs/security-zod-v4-migration.md`. Manager review of the exact head, CI, staging, and Socket have not passed.

## Decision

Direct pins, plus parent selectors for the three TanStack Zod edges and one `launch-editor` version selector. `minimumReleaseAge: 1440` is unchanged. The ignored root `package.json` `overrides.rolldown` and the workspace `overrides.rolldown: 1.2.1` stay. No `minimumReleaseAgeExclude` or `allowBuilds` change. No new direct runtime dependency, and no new registry, git, or tarball dependency.

| Package                           | Before    | After     | Why this pin                                                      |
| --------------------------------- | --------- | --------- | ----------------------------------------------------------------- |
| `apps/web` `vite`                 | `8.1.5`   | `8.1.6`   | Same-line patch for GHSA-587h-7wmj-h5pm on the 8.0.0–8.1.5 range. |
| `packages/auth` `zod`             | `4.6.5`   | `4.6.6`   | Same-line patch for the v4 copy used by Better Auth.              |
| api, worker, web, contracts `zod` | `3.25.76` | `3.25.76` | Left on purpose. Advisory range includes it. Not patched here.    |
| TanStack parent `>zod`            | `4.6.5`   | `4.6.6`   | Three parent selectors only. Does not rewrite other peer ranges.  |
| override `launch-editor@2.14.1`   | `2.14.1`  | `2.14.2`  | Same Vite advisory's `launch-editor` package. Does not add a dep. |

The Vite pin alone moved every `vite@8.1.5` peer onto `8.1.6`. The auth pin moved Better Auth and `better-call` onto `zod@4.6.6`, but a resolved `4.6.5` still reached `packages/auth` through `better-auth` → optional `@tanstack/react-start` → `@tanstack/router-plugin@1.168.42`, `@tanstack/router-generator@1.167.40`, and `@tanstack/start-plugin-core@1.171.49`. Those parents were not upgraded. Registry metadata says each declares `zod: ^4.5.4`, which accepts `4.6.6`. A bare `zod@4.6.5` selector also rewrote unrelated lockfile peer ranges (`@hookform/resolvers` and `better-call`). pnpm's documented parent form (`qar@1>zoo`, https://pnpm.io/settings/dependency-resolution#overrides) is what this slice uses instead.

## Advisory evidence

### GHSA-587h-7wmj-h5pm (CVE-2026-112942)

- Source: https://github.com/advisories/GHSA-587h-7wmj-h5pm (fetched 2026-10-26 from the GitHub advisory API).
- Published 2026-10-20T19:48:25Z. Severity high. CWE-77.
- `vite` `>= 8.0.0, <= 8.1.5`, first patched `8.1.6`. Also lists `launch-editor` `<= 2.14.1`, first patched `2.14.2`.
- Advisory text: only apps that run on Windows are affected. The bypass is a crafted path ending in `\\..:line:column` against `fs.existsSync`, combined with `%` escaping, when an attacker controls the file argument. This note does not claim a confirmed Linux production exploit.
- npm `vite@8.1.6` time `2026-10-06T04:51:51.393Z`. Integrity `sha512-aRAHIxx5SW5zc1sMqFwJU/t5qaFfXb5Hj0J7W0VXihu/X99+346tz6080tO1T1xVIJORX/b3zVTXGFqUXh35uw==`. Age at research time is about 20 days, above the 1440-minute guard. Registry metadata includes an npm signature and a SLSA provenance attestation URL (`https://registry.npmjs.org/-/npm/v1/attestations/vite@8.1.6`). The signature chain was not re-verified beyond that document and the matching integrity.
- Release: https://github.com/vitejs/vite/releases/tag/v8.1.6 (`published_at` 2026-10-06T04:48:45Z). Changelog: https://github.com/vitejs/vite/blob/v8.1.6/packages/vite/CHANGELOG.md — `fix(deps): update launch-editor to v2.14.2` (#23654, `e46fc9c`). Compare https://github.com/vitejs/vite/compare/v8.1.5...v8.1.6 changes `launch-editor-middleware` from `^2.14.1` to `^2.14.2`. That dependency is a build dependency of the Vite package and is bundled; the published `dependencies` list does not name it.
- Reachable surface in Vite 8.1.5 source, tag `v8.1.5`, `packages/vite/src/node/server/index.ts`: import at line 14, and `middlewares.use('/__open-in-editor', launchEditorMiddleware())` at line 984. This repo does not call that helper. `apps/web/vite.config.ts:1-14` only passes `tanstackStart.server.entry`. The wrapper `@lovable.dev/vite-tanstack-config` is unchanged. Production images run Nitro `node-server`, not the Vite dev server. The dev-server route is the Vite surface, and only on Windows per the advisory.
- The same advisory names `launch-editor` `<= 2.14.1`. The lock had `2.14.1` under `@tanstack/devtools-bundler-core@0.1.3` (now `pnpm-lock.yaml` snapshot `launch-editor: 2.14.2` at the bundler-core dependencies). Registry metadata for that parent says `launch-editor: ^2.14.1`, so `2.14.2` is inside the range. npm time `2026-10-06T03:12:21.311Z`. Integrity `sha512-NHJEb30MGBCkmZXLZwz25t37QR4aY03ZzPYUJXOJaOa92uWwExI9SBQUuIznBYc1xkD7cJNGX7oc3Nl3sq2kQQ==`. Age is above 1440 minutes. Published `scripts` is only `test`; no install, preinstall, or postinstall script. Registry metadata includes a signature and an attestations URL. That is a metadata check, not a signature verification; none was performed. The parent is a devtools bundler helper used from the Vite dev config, not a production API or Nitro process. No editor process was launched to test it. This note does not claim a Linux production exploit.

### GHSA-mrhx-c7xc-m3w5 (CVE-2023-54404)

- Source: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5 (fetched 2026-10-26). Published 2026-10-01T18:32:46Z, GitHub-reviewed 2026-10-23T18:26:50Z. Severity high. CWE-770. CVSS 3.1 7.5 (`AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`).
- `zod` `< 4.6.6`, first patched `4.6.6`. That range includes installed `3.25.76` and the previous `4.6.5`. The version match alone does not prove a path is exploitable.
- npm `zod@4.6.6` time `2026-10-11T16:18:23.878Z`. Integrity `sha512-4UmzQUF5fxvfcYHlbjBmejU+w+hbDnWFx4aS8kBx7nPBHcO2SqPbpAG8snbdg+Xse4pRefR98hgjFgIMCI/UhA==`. Age at research time is about 14 days. Registry metadata includes a signature and `https://registry.npmjs.org/-/npm/v1/attestations/zod@4.6.6`. Not re-verified beyond that document.
- Upstream fix: https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd (#6652, 2026-10-09). The patch touches only `packages/zod/src/v4/**`. It adds a leading size check for array, set, and map before element parse. It does not edit `src/v3`. Installing `zod@4.6.6` therefore does not patch the separate `zod@3.25.76` package, and it does not prove the `zod/v3` compatibility entry of the v4 package is fixed.

## Graph after the compatible-patch install

This section is the compatible-patch graph. Stage 2 later removed `zod@3.25.76`. Do not treat the rows below as the current lockfile.

After the parent selectors, the lockfile has no package entry `vite@8.1.5`, no resolved `zod@4.6.5`, and no `launch-editor@2.14.1` package entry. `zod@3.25.76` remains. The `launch-editor@2.14.1: 2.14.2` key is a selector, not an installed copy.

Lockfile package entries:

- `vite@8.1.6` integrity matches the registry hash above. No `vite@8.1.5` key remains. Peer snapshots that used to say `vite@8.1.5(...)` now say `vite@8.1.6(...)`. That key rewrite is why the lockfile diff is larger than two version lines. No other direct dependency specifier changed.
- `better-call@1.4.0` peers `zod: ^4.0.0` (`pnpm-lock.yaml` package metadata). The snapshot is now `better-call@1.4.0(zod@4.6.6)` with `zod: 4.6.6`. Better Auth `1.7.7` was not upgraded; it follows that peer.
- `zod@3.25.76` remains, with the previous integrity. Direct specifiers unchanged: `apps/api/package.json:32`, `apps/worker/package.json:28`, `apps/web/package.json:75` (`^3.25.76`), `packages/contracts/package.json:21` (`^3.25.76`).
- Those TanStack packages still declare `zod: ^4.5.4`. Their snapshots now bind `zod: 4.6.6`, including the path `packages/auth` → `better-auth@1.7.7` → optional `@tanstack/react-start` → router/start plugins. Calling that path "not the auth graph" was wrong. Better Auth itself was not upgraded.
- `@hookform/resolvers@5.9.1` peer is again `zod: ^3.25.0 || ^4.0.0` (`pnpm-lock.yaml` package metadata). Its snapshot stays `zod: 3.25.76`. `better-call@1.4.0` peer is again `zod: ^4.0.0`, and the snapshot stays `better-call@1.4.0(zod@4.6.6)`. Neither consumer was forced from Zod 3 onto Zod 4.
- `launch-editor@2.14.2` is the only `launch-editor` package entry. Its snapshot still uses `shell-quote@1.11.0`, which satisfies `^1.10.0`. No new direct dependency was added.

`pnpm-lock.yaml` stays one document (`lockfileVersion: 9.0`). Engines stay Node `>=24` and pnpm `12.5.1`. Install used `F:\Dev\Runtimes\node24\node-v24.21.0-win-x64\pnpm.ps1` (pnpm 12.5.1).

## Regression

`packages/auth/src/__tests__/zod-array-bound.spec.ts` imports the real `zod` package. It exists because of GHSA-mrhx-c7xc-m3w5. It does not mock Zod, pin a version string, or open a network socket. The oversized case is 20 strings against `.max(2)`. The under-bound case is one invalid element, `[1]`, so the length is 1, strictly below 2. An earlier draft used `["ok", 1]`, which has length 2 and is not under the bound.

Failing before, on the frozen `4.6.5` install, 2026-10-26:

```text
FAIL  rejects an oversized bounded array before any element preprocessor runs
AssertionError: expected 20 to be +0
Test Files  1 failed (1)
Tests  1 failed | 2 passed (3)
exit code 1
```

The bound was already reported as `too_big`. The failure was the visit count: 4.6.5 walked every element before the cap. The at-bound case passed on 4.6.5. That 20-string walk is the patch signal. A separate manager check of 20 invalid numbers saw 20 visits and 21 issues on the old TanStack `4.6.5`, and 0 visits and 1 issue on patched auth `4.6.6`.

Passing after, on `4.6.6`:

```text
✓ src/__tests__/zod-array-bound.spec.ts (3 tests)
Test Files  1 passed (1)
Tests  3 passed (3)
```

Zero element visits on the oversized input, at-bound input still parsed, under-bound invalid values still rejected. No new runtime guard was added.

## What this does not close

`pnpm audit --prod --json` on this tree still exited 1. `metadata.vulnerabilities` was 5 low, 11 moderate, 1 high, 0 critical (17). The only high left in that JSON is GHSA-mrhx-c7xc-m3w5 on `zod`, because `zod@3.25.76` is still installed. GHSA-587h-7wmj-h5pm was not in that prod list. A manager-recorded historical audit on a separate F3 foundation checkout was 21 findings (6 low, 13 moderate, 2 high). That figure is not an owner-supplied baseline and not a paired capture of this worktree, so this note does not claim a precise causal reduction from 21 to 17. These v4 and Vite pins do not close the Zod advisory. No allowlist, no scanner install, no `audit fix`. Unresolved on this increment:

1. Historical, this increment only: `zod@3.25.76` was still in api, worker, web, and contracts. Stage 2 later moved those four declarations to exact `4.6.6`. Do not read this bullet as the current pin.
2. The other pre-existing prod findings in the 17 above. They are not this slice. After the later pin they were still present as 5 low and 11 moderate; this note does not list a clearance.

This is not a security clearance.

## Zod 3 assessment (not migrated)

Production `from "zod"` files, tests excluded: api 39, worker 7, web 22, contracts 47, auth 0. Auth production code calls Better Auth and does not import Zod. The new regression under `packages/auth/src/__tests__` does import Zod, so an auth-wide count is not zero.

Attacker JSON reaches `ZodValidationPipe.transform` (`apps/api/src/shared/zod-validation.pipe.ts:18-27`): `safeParse`, then either `report_range_too_long` when an issue message is exactly `validation.rangeTooLong`, or `validation` with `{ path, code }` only. `EnvelopeExceptionFilter` (`apps/api/src/shared/exception.filter.ts:29-41`) maps a raw `ZodError` the same way, and maps a Fastify `statusCode` 400–499 (the comment names a body over the size limit) to `codeForStatus`. Rejected values are not copied into the envelope.

`apiAdapter` (`apps/api/src/app.ts:206-239`) does not set `bodyLimit` or `maxParamLength`. The Meta webhook reads its own bytes and rejects above `1024 * 1024` (`apps/api/src/modules/notifications/http/meta-raw-body.ts:7-8`, `:34`). That comment calls 1 MiB Fastify's default; this review did not read the installed Fastify default, so JSON routes are not proven to share that cap. Logo upload sets its own `bodyLimit`. Production proxy and ingress limits were not inspected. Absence of a repo setting is not proof of a cap, and a cap is not proof the Zod 3 walk is unreachable.

Representative body arrays, not a claim that every match is exploitable:

- Declared bound, not an early cap: `branchScheduleInputSchema` has `shifts.max(42)` (`packages/contracts/src/schedules.ts:42`). Zod 3.25.76 still walks elements before it enforces that max. #6652 does not apply to 3.25.76. Other request arrays with a `.max` exist (visits, invoice lines, prices, payment methods, permission keys) and have the same legacy order.
- Unbounded request arrays on a pipe: `branchIds: z.array(idSchema)` (`packages/contracts/src/users.ts:40`), used by `changeBranchesInputSchema` (`users.controller.ts:107`) and `inviteUserInputSchema`. No `.max` on that array. An attacker who can post a large JSON body reaches Zod 3 array parsing. Whether a platform body limit stops it first is unknown here.

`packages/auth` has no Zod schema. API env parsing in `auth-config.ts` is Zod 3 and is process config, not a request body.

### Why v4 does not prove v3 fixed

#6652 edits only `src/v4`. The installed contracts/api/worker/web dependency is the separate `zod@3.25.76` tarball, not `zod/v4` and not `zod/v3` inside 4.6.6. The migration guide (https://zod.dev/v4/changelog, source `packages/docs/content/v4/changelog.mdx` at tag `v4.6.6`) is a breaking-change list, not a backport. Hiding 3.25.76 behind a v4 package name would leave the old parser in place wherever `zod` resolves to 3.

### Next slice (do not do it in this increment)

Keep contract input, output, defaults, refinements, the error envelope, i18n keys, and form-resolver behavior. Characterization tests on the current Zod 3 package come first.

1. `invalid_type_error` is dropped in v4 (guide, "drops `invalid_type_error` and `required_error`"). Occurrences include `packages/contracts/src/finance.ts:23` and `:39`, plus clinics, money, services, platform, and `apps/web/src/shared/api/new-clinic-finance.ts`. The replacement `error` callback must return the same i18n key. The API envelope stores `issue.code`, not the message, except the `validation.rangeTooLong` check. Forms use `zodResolver` (`@hookform/resolvers` `^5.9.1`, peer `zod: ^3.25.0 || ^4.0.0`) and display `issue.message`, so the key must survive.
2. `z.ZodType<string>` at `finance.ts:29` is one type argument. v4 `ZodType<Output, Input>` defaults `Input` to `unknown` (guide, "updates generics"). Preserve both sides with `z.ZodType<string, string>` or the concrete schema type. Do not widen the discount input.
3. `z.ZodTypeAny` at `packages/contracts/src/audit-http.ts:83` should become `z.ZodType`. The guide says `ZodTypeAny` is no longer needed.
4. `apps/web/src/visits/use-list-flush.ts:26` uses `z.ZodType<{ items: T[] }, z.ZodTypeDef, unknown>`. That third generic does not exist in v4. This is a UI type change. Lovable owns frontend source; a contracts major bump cannot typecheck the web app until that annotation, and any other `ZodTypeDef` or `invalid_type_error` in `apps/web`, is updated. Do not land the migration by editing those screens in a dependency-only slice.
5. `z.record(effectiveClinicStatusSchema, ...)` at `packages/contracts/src/platform.ts:112`, with `effectiveClinicStatusSchema` an enum at `packages/contracts/src/clinics.ts:30`. The guide ("improves enum support") says v3 infers partial keys and v4 requires every enum key at parse time. Old semantics are `z.partialRecord(enum, value)`, not a bare `z.record`. Lock the current parse of a partial `counts` object with a fixture before switching. Do not assume production always sends all four statuses.
6. `.default()` inside optional fields now applies in v4 (guide, "defaults applied within optional fields"). Query `limit` defaults and `reportGroupBySchema.default(...)` need before/after fixtures. `.strict()` still works. `z.string().uuid()` and `.datetime()` get stricter or move; do not change them blindly.
7. `.refine` / `.superRefine` that read `ctx.path` break (guide, "drops `ctx.path`"). Search those before the bump. The pipe's special message must stay `validation.rangeTooLong`.
8. After contracts, point api and worker at the same patched v4 and re-run the envelope tests. The three parent selectors already moved those TanStack v4 copies. Do not replace them with a bare `zod@` selector, and do not select `3.25.76`.

UI type compatibility changes are required for a real 3-to-4 migration. Lovable implements the frontend source later. This increment changes no contract, no pipe, and no screen.
