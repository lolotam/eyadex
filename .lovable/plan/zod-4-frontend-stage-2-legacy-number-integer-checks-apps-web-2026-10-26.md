# Zod 4 frontend stage 2: legacy number + integer checks (apps/web only)

## Prerequisites (blocking, not mine to supply)

Implementation starts only after a human go-ahead AND all of these are on the connected branch:

1. Real `zod` 4.6.6 installed in every direct workspace consumer (`apps/web`, `packages/contracts`, and the other direct consumers), in the manifests and the lockfile.
2. `@eyadex/contracts/number-compat` exports `legacyNumber(error?)` as specified.
3. `@eyadex/contracts/integer-compat` exports `legacyInteger(message?)` as specified.

At the current checkout, web and contracts are still on `zod ^3.25.76` and neither helper exists, so this change cannot compile. I will not add a temporary helper, copy backend code into web, install or pin Zod, or work around a missing import. If anything is missing at go-ahead, I stop and report blocked. I make no compile or pass claims before then.

## Change 1: `apps/web/src/shared/api/new-clinic-finance.ts`

- Import `legacyNumber` (number-compat) and `legacyInteger` (integer-compat).
- Standalone `newClinicFinanceSchema.taxRateBp`:
  `legacyNumber().check(legacyInteger()).check(z.gte(0)).check(z.lte(10000)).optional()`
- Form `createClinicFormSchema.taxRateBp`:
  `legacyNumber(taxRateNumberParams.error).check(legacyInteger("validation.number")).check(z.gte(0, "validation.outOfRange")).check(z.lte(10000, "validation.outOfRange"))`
- These stay the same: the exported `taxRateNumberParams` and its callback (undefined → `Required`, any other wrong type → `validation.number`), `currencyCodeSchema`, `DEFAULT_NEW_CLINIC_FINANCE`, optionality, and the inferred `number` types and outputs.
- The doc comment changes only where it would otherwise be untrue after 4.6.6, for example the part that says Zod 4 reads `error` on `z.number`.
- No casts, no private API, no clamping or rounding, no special rejection of non-finite numbers. No other source file changes.

## Change 2: `apps/web/src/shared/api/new-clinic-finance.test.ts`

- Keep all 21 existing cases, their exact expectations, and the complete `VALID_BASE`.
- Stand-in block (this settles the open question): point it at the real production field `createClinicFormSchema.shape.taxRateBp`, remove the unused `zod/v4` import, and rename the captions to say they run on the installed 4.6.6. No hand-built alternative schema, no mock, cast or skip.
- New data-driven form cases on `VALID_BASE`. Each asserts the ordered `{code, path: ["taxRateBp"], message}` list:
  - `-0.5`: `invalid_type`/`validation.number`, then `too_small`/`validation.outOfRange`
  - `10000.5`: `invalid_type`/`validation.number`, then `too_big`/`validation.outOfRange`
  - `9007199254740992` and `1e20`: only `too_big`/`validation.outOfRange`
  - `JSON.parse('{"taxRateBp":1e999}')`: `invalid_type`/`validation.number`, then `too_big`
  - `JSON.parse('{"taxRateBp":-1e999}')`: `invalid_type`/`validation.number`, then `too_small`
  - `0` and `10000`: success, with exactly the same parsed data as today
  - the existing undefined, wrong-type and NaN cases stay as they are
- New standalone `newClinicFinanceSchema` cases:
  - omitted and `undefined` are accepted, and the output is unchanged
  - fractions and ±overflow give the integer issue first, then the range issue, in order
  - the integer message is exactly `Expected integer, received float`
  - the default English for range and wrong-type messages follows 4.6.6 as documented on the backend. The tests assert codes and order and do not invent legacy wording.
- Revert proof: put back native `z.number().int()` (form and standalone), check that the new fraction, overflow and Infinity cases fail, then restore.
- The file stays at 300 lines or fewer.

## Gates (only after the prerequisites exist)

These are reported with each exact command and its own exit code (pipefail):

- the targeted vitest file
- the full web vitest suite
- web typecheck
- web lint
- Prettier on the two touched files
- the Nitro node-server build

If pnpm refuses the sandbox's Node version, I will say so plainly and name the underlying script I ran instead. Sol reruns the whole workspace, API, worker, Docker and delivery gates.

## Scope and limits

- Only the two files above change. Nothing in manifests, the lockfile, contracts, the API, the worker or `db`, and no UI, i18n or behaviour changes.
- No commit, push, sync, CI run, staging or deployment authority is implied.
- Sol's 3,828 comparisons are local backend evidence. I do not treat them as CI, merge or security clearance, and I do not claim full parity.
