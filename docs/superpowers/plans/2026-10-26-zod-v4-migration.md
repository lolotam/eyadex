# Zod 4.6.6 security migration Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. This plan does not authorize a commit, a push, a reset, or a dependency install. Do not dispatch another agent from it.

**Goal:** Close GHSA-mrhx-c7xc-m3w5 on api, worker, web, and contracts by running the real `zod@4.6.6` parser, without changing accepted ids, emails, UTC or offset datetimes, partial overview counts, i18n keys, or the public envelope codes.

**Progress:** Manager accepted the Zod 3.25.76 baseline, including the three extension files (contracts 25/523, API 75/775, worker 25/452, typecheck and lint 15/15 cached, targeted Prettier and `git diff --check` exit 0). Frontend stage 1 is Lovable's and was not edited here. Stage 2 is implemented: four direct pins are exact `4.6.6`, and the worker gates in Task 3 passed on this worktree. Manager review of the exact head, CI, staging, Socket, and Codex review have not passed. This plan does not claim those gates or a security clearance.

**Architecture:** Stage 0 freezes Zod 3.25.76 behavior. Lovable prepares the two web type sites. Grok then switches the four direct pins to 4.6.6 and applies only the verified predicate and envelope fixes. Rollback is reverting that reviewed code. No SQL.

**Tech Stack:** TypeScript, Zod 3.25.76 now and Zod 4.6.6 later, NestJS on Fastify, vitest, pnpm 12.5.1, Node 24.21.0.

**Spec:** `docs/specs/security-zod-v4-migration.md`. Guide: https://zod.dev/v4/changelog at tag `v4.6.6`.

---

### Task 1: Stage 0 characterization (this slice)

**Files:**

- Create: `packages/contracts/src/__tests__/zod-migration-identifiers.spec.ts`
- Create: `packages/contracts/src/__tests__/zod-migration-money-defaults.spec.ts`
- Create: `packages/contracts/src/__tests__/zod-migration-records-ranges.spec.ts`
- Create: `apps/api/src/shared/__tests__/zod-migration-errors.spec.ts`
- Create: `packages/contracts/src/__tests__/zod-migration-datetimes.spec.ts`
- Create: `apps/worker/src/shared/__tests__/zod-migration-events.spec.ts`
- Create: `apps/api/src/modules/notifications/__tests__/zod-migration-webhook.spec.ts`
- Create: `docs/specs/security-zod-v4-migration.md`
- Create: this plan

- [x] **Step 1: Run the frozen suite on Zod 3.25.76**

Run, in order, from the repo root:

```text
pnpm --filter @eyadex/contracts test
pnpm --filter @eyadex/api test
pnpm --filter @eyadex/worker test
pnpm typecheck
pnpm lint
pnpm exec prettier --check "packages/contracts/src/__tests__/zod-migration-*.spec.ts" "apps/worker/src/**/zod-migration-*.spec.ts" apps/api/src/modules/notifications/__tests__/zod-migration-webhook.spec.ts docs/specs/security-zod-v4-migration.md docs/superpowers/plans/2026-10-26-zod-v4-migration.md
git diff --check
```

Expected: all exit 0 on installed `zod@3.25.76`. The manager reran these seven commands on the correct worktree and accepted them. Do not edit `apps/api/src/shared/__tests__/errors.spec.ts`. Do not commit.

### Task 2: Stage 1 — Lovable, web types only

**Files:**

- Modify: `apps/web/src/visits/use-list-flush.ts:26`
- Modify: `apps/web/src/shared/api/new-clinic-finance.ts:23`
- Do not modify: the `ZodTypeAny` aliases under `apps/web/src/shared/api/`

- [x] **Step 1: Replace the three-generic annotation**

`z.ZodType<{ items: T[] }, z.ZodTypeDef, unknown>` does not exist on Zod 4. A type-only parameter that needs `safeParse` is enough. Do not import `zod/v3`. Do not remove `ZodTypeAny`: `zod@4.6.6` `v4/classic/compat.d.ts:39` still exports it.

- [x] **Step 2: Keep `validation.number` and `Required`**

The owner rejected a message fallback that changed a missing value away from `Required`. `apps/web/src/shared/api/new-clinic-finance.ts` line 23 must keep both answers: a wrong type is exactly `validation.number`, and a missing value is exactly `Required`. An inline `z.number({ invalid_type_error, error })` does not compile on both majors: excess property checks reject the foreign key. Export a params variable and pass that. The callback types only the field it reads:

```ts
export const taxRateNumberParams = {
  invalid_type_error: "validation.number",
  error: (issue: { input?: unknown }) =>
    issue.input === undefined ? "Required" : "validation.number",
};

z.number(taxRateNumberParams);
```

`undefined` is `Required`. Any other input, including a wrong type, is `validation.number`. Do not install a process-wide error map. This slice does not edit `apps/web`.

- [x] **Step 3: Typecheck the web app**

Run: `pnpm --filter @eyadex/web typecheck`

Expected: pass on the still-installed Zod 3.25.76, so the annotation is valid for both parsers.

### Task 3: Stage 2 — predicates, then the pin

**Files:**

- Modify: `packages/contracts/src/common.ts` `idSchema`
- Modify: `packages/contracts/src/users.ts:59` `z.string().uuid("validation.required")`
- Modify: `packages/contracts/src/invitation-acceptance.ts:38`
- Modify: `packages/contracts/src/onboarding.ts:166` and `:169`
- Modify: `packages/contracts/src/platform-clinics.ts:27`
- Modify: `packages/contracts/src/appointments.ts:54`
- Modify: `packages/contracts/src/schedules.ts:91-92`
- Modify: `packages/contracts/src/onboarding.ts:121`
- Modify: `packages/contracts/src/platform.ts:112` `platformOverviewSchema.counts` only
- Modify: `packages/contracts/src/finance.ts:29` `discountInput`
- Modify: `packages/contracts/src/money.ts` `invalid_type_error` sites
- Modify: `packages/contracts/src/clinics.ts`, `services.ts`, `platform.ts`, `finance.ts` number `invalid_type_error` sites
- Modify: `apps/api/src/shared/zod-validation.pipe.ts`
- Modify: `apps/api/src/shared/exception.filter.ts`
- Modify: the six worker `z.string().uuid()` parsers and `apps/api/src/modules/notifications/domain/evolution-webhook.ts:47`
- Modify: every contract `.datetime(` call, not only the five offset sites (70 calls on 68 lines)
- Modify later, same pin: only `apps/api/package.json`, `apps/worker/package.json`, `apps/web/package.json`, `packages/contracts/package.json` `zod` specifiers, and the lockfile

- [x] **Step 1: Keep the loose uuid**

Replace `z.string().uuid()` with `z.string().guid()`, including the `"validation.required"` message on the invite role id, the six worker parsers, and `evolution-webhook.ts` line 47. `z.guid()` accepted variant nibbles `0`, `1`, and `c` on 4.6.6. `z.string().uuid()` did not. Do not lowercase uppercase ids. Trailing newline ids fail installed 3.25.76 `uuid()`; do not let `guid()` start accepting them.

- [x] **Step 2: Keep Zod 3 datetime strings, UTC and offset**

Installed 4.6.6 `v4/core/regexes.js` lines 103-105 require seconds on every qualified datetime, so minute-only `2026-10-26T00:00Z` fails. Lines 101-102 allow only `±HH:MM` in a clock range, so `+0300`, `+24:00`, and `+03:60` fail. Installed 3.25.76 accepts those and returns the original string. A source count is 70 contract calls on 68 lines (5 offset, 65 UTC) plus four worker parsers: offset in `branch-event.ts` and `invitation-event.ts`, UTC in `reminder-rules.ts` and `team-invite.ts`. Zod 4's stricter RFC 3339 policy is not an approved business change.

Use one shared pure string-predicate pair copied from installed 3.25.76 `datetimeRegex`, one UTC and one offset. Do not use `Date.parse`, coercion, colon insertion, or the native 4.6.6 datetime. Failure on the contract sites must be `invalid_format` so the envelope map still yields `invalid_string`. Re-run `zod-migration-datetimes.spec.ts`, `zod-migration-events.spec.ts`, and the identifier datetime fixtures before calling this done.

- [x] **Step 3: Partial overview counts**

```ts
counts: z.partialRecord(effectiveClinicStatusSchema, z.number().int().nonnegative()),
```

Do not edit `platformOverviewResponseSchema`. It already requires all four keys, and an unknown top-level key stays `unrecognized_keys`. `partialRecord` changes the raw unknown-count assertion from `invalid_enum_value` at `["mystery"]` to `unrecognized_keys` at `[]`. That is the controlled update in Step 8. It is not an HTTP envelope change.

- [x] **Step 4: Keep discount input a string**

`discountInput` must be `z.ZodType<string, string>` or `typeof minorAmountSchema`. The stage 0 assertion `MinorStaysString` fails if `Input` widens to `unknown`.

- [x] **Step 5: Replace `invalid_type_error` per field**

Guide: the parameter is dropped. For each money and clinic number schema, the `error` callback returns the existing i18n key when `issue.input !== undefined`, and `"Required"` when it is `undefined`. Missing amount and missing `maxUsers` are `Required` today. Do not use one global map.

- [x] **Step 6: Map envelope codes in both copy sites**

Add one shared function and call it from `ZodValidationPipe.transform` and `EnvelopeExceptionFilter`'s `ZodError` branch. Copy `{ path, code }` only. Do not build a fake Zod 3 issue inside the v4 parser. Normalize `invalid_format` to `invalid_string`; `invalid_union` with the public `discriminator` to `invalid_union_discriminator`; `invalid_value` with one value to `invalid_literal` and with more than one to `invalid_enum_value`. Every other code stays.

```ts
function envelopeIssueCode(issue: {
  code: string;
  discriminator?: unknown;
  values?: readonly unknown[];
}): string {
  if (issue.code === "invalid_format") return "invalid_string";
  if (issue.code === "invalid_union" && issue.discriminator !== undefined) {
    return "invalid_union_discriminator";
  }
  if (issue.code === "invalid_value") {
    return issue.values?.length === 1 ? "invalid_literal" : "invalid_enum_value";
  }
  return issue.code;
}
```

Measured on 4.6.6: uuid/email/regex are `invalid_format`; a discriminator failure sets `discriminator`; a regular union does not; literal `values` has one entry and enum `values` has more. No contract enum has one option. The subscription HTTP case (`status: "synthetic-marker"`, options `trial` / `active` / `suspended`) is the `values.length > 1` branch and must stay `invalid_enum_value`. `errors.spec.ts` line 125 must still see `invalid_string` without an edit. This function does not change a raw `safeParse` result.

- [x] **Step 7: Pin the real parser**

Set only the four direct `zod` specifiers to `4.6.6`, and update the lockfile. Do not use a bare `zod@` override. Do not select `3.25.76`. Do not import `zod/v3`. Leave `packages/auth` on `4.6.6`. Leave the three TanStack parent selectors on `4.6.6`. Leave the Vite `8.1.6`, `rolldown@1.2.1`, and `launch-editor@2.14.2` pins. Install with pnpm 12.5.1 already on `PATH`. `pnpm why zod` at the root does not prove the parser. Require all three:

```text
pnpm -r why zod
pnpm --filter @eyadex/auth test
```

And print the installed version from each direct package's resolved `zod/package.json`. Expected: every resolved copy is `4.6.6`, the graph has no `zod@3.25.76` and no `zod@4.6.5`, and the auth oversized-array case visits zero elements. That walk is the parser proof. A version string without the walk is not.

- [x] **Step 8: Re-run stage 0 plus the auth array bound**

```text
pnpm --filter @eyadex/contracts test
pnpm --filter @eyadex/api test
pnpm --filter @eyadex/worker test
pnpm --filter @eyadex/auth test
pnpm --filter @eyadex/web typecheck
pnpm typecheck
pnpm lint
```

HTTP envelopes stay as written: `invalid_string`, `invalid_enum_value`, `invalid_literal`, `invalid_union_discriminator`, and `report_range_too_long`. Do not edit `zod-migration-errors.spec.ts` or `errors.spec.ts` for native Zod 4 codes.

Raw contract assertions are version evidence. At this pin switch, and only then, change these and nothing else:

- In `zod-migration-identifiers.spec.ts`, replace raw `invalid_string` with `invalid_format` where the code is asserted: rejected ids; clinic, platform-invite, and mail emails (keep `validation.email`); stored user and platform emails; the create-clinic request email; the invite email and role id (keep `validation.email` and `validation.required`); `createdAt` failures; the non-leap offset expiry. Do not change accepted values or outputs.
- In `zod-migration-records-ranges.spec.ts`, change the unknown count from `{ path: ["mystery"], code: "invalid_enum_value" }` to `{ path: [], code: "unrecognized_keys" }`. A manager check of patched 4.6.6 `partialRecord` confirmed that path and code.

Do not accept both codes in one assertion. Do not drop an assertion. Do not relax an input, an output, an i18n message, or an HTTP envelope. Do not invent a Zod 4 raw issue that still says `invalid_string`. Do not edit `zod-migration-datetimes.spec.ts`, `zod-migration-events.spec.ts`, or `zod-migration-webhook.spec.ts` to accept a stricter datetime or a strict uuid. A remaining fixture failure is a predicate bug, not a reason to edit the expected answer.

Integer compatibility is a later gate, not a raw-code family. Zod 4 `.int()` is a safe integer and stops after a fraction, and `z.number()` rejects `Infinity` before that check. A raw JSON `1e999` is `Infinity`. Production numbers use `legacyNumber` (`packages/contracts/src/number-compat.ts`) plus `legacyInteger`, with public `z.gte` / `z.lte` bounds. An unconfigured missing number says `"Required"`; a configured error callback still wins. `Number(Symbol)` still throws and is not caught. Config, the Meta error code, and the worker intervals use the same pair. Web `new-clinic-finance.ts` still has native `.int()`; Lovable owns that follow-up.

Two later test ports are not that family and do not change answers: `finance-reports-fields.spec.ts` types `rowShape` from the concrete `ROWS` schemas and calls `safeParse` on the field itself, and `finance-contracts.spec.ts` reads `createClinicRequestSchema.shape.currency`. There is no `innerType` shim and no runtime parser adapter.

### Task 4: Integration and rollback

- [x] **Step 1: No SQL**

This migration has no `db/sql` file. Do not apply a migration. Do not touch production, storage, or Dokploy.

- [ ] **Step 2: Rollback**

Revert the reviewed stage 1 and stage 2 commits. Do not revert unrelated dirty files. The Vite 8.1.6 pin, the auth Zod 4.6.6 pin, the TanStack parent selectors, `rolldown@1.2.1`, and `launch-editor@2.14.2` stay.

### Task 5: Manager gates

- [ ] **Step 1: Hold the merge**

Leave this box unchecked. The implementer ran `NITRO_PRESET=node-server pnpm build:all` (9/9, Nitro `node-server`) and both Dockerfiles (exit 0). Those runs are worker evidence, not manager acceptance of the exact head. Staging, CI, Socket, and Codex review have not passed. The compatible-patch prod audit was 17 (5 low, 11 moderate, 1 high). After the pin, implementer `pnpm audit --prod` exited 1 with 16 findings (5 low, 11 moderate, 0 high, 0 critical). GHSA-mrhx-c7xc-m3w5 was absent. That is not a paired 21-to-17 claim and not a clearance. Residual advisories were not fixed.
