# Zod 4 frontend stage 2: legacy integer check (apps/web only)

## Prerequisite (blocking, not mine to supply)
Run this only after the reviewed backend Zod 4.6.6 integration is on the branch. That means `zod` 4.6.6 is in the manifests and lockfile, and `@eyadex/contracts/integer-compat` exports `legacyInteger` exactly as specified. At head `7f4c37ca` the web is still on `zod ^3.25.76`, so `.check(...)` and the helper do not compile there. I will not add a temporary helper, change pins or the lockfile, or work around a missing import. If either piece is missing when the go-ahead comes, I stop and report it.

## Audit of native `.int()` in apps/web (rg over `apps/web/src`)
- `shared/api/new-clinic-finance.ts:15`: the standalone `newClinicFinanceSchema.taxRateBp`.
- `shared/api/new-clinic-finance.ts:36`: the form `createClinicFormSchema.taxRateBp`.
- `shared/api/new-clinic-finance.test.ts:62`: the `zod/v4` stand-in block rebuilds the form chain with native v4 `.int(...)`. After the switch this block would test the old v4 behaviour, not the production chain. It is drift in a test only (see Tests).
- There are no other native `.int()` calls in web source. Contract schemas are backend-owned and outside this plan.

## Change (1 source file)
`apps/web/src/shared/api/new-clinic-finance.ts`:
- Import `legacyInteger` from `@eyadex/contracts/integer-compat`.
- Line 15: `z.number().check(legacyInteger()).min(0).max(10000).optional()`. This keeps Zod 3's default int message and the default min/max messages, and stays optional.
- Line 36: `.check(legacyInteger("validation.number"))` in place of `.int("validation.number")`.
- Everything else stays the same:
  - `taxRateNumberParams` (undefined → `Required`, any other wrong type → `validation.number`);
  - the min/max bounds and the `validation.outOfRange` messages;
  - `currencyCodeSchema`, `DEFAULT_NEW_CLINIC_FINANCE`, and the inferred types and outputs.
- No casts, no type weakening, no private Zod API.

## Tests (existing `new-clinic-finance.test.ts` only)
- The current 21 tests stay unchanged and must still pass.
- New form-schema cases. Each asserts the exact issue list (code, path `["taxRateBp"]`, message, in order) on the complete valid base:
  - `-0.5` → `invalid_type`/`validation.number`, then `too_small`/`validation.outOfRange`;
  - `10000.5` → `invalid_type`/`validation.number`, then `too_big`/`validation.outOfRange`;
  - `9007199254740992` → only `too_big`/`validation.outOfRange`, with no safe-integer issue;
  - `1e20` → only `too_big`/`validation.outOfRange`;
  - `0` and `10000` → success, with the same parsed output as today.
- New standalone `newClinicFinanceSchema` cases:
  - `-0.5` and `10000.5` give the default int message `Expected integer, received float`, then the default too_small/too_big message;
  - `undefined` is still accepted.
- The `zod/v4` stand-in block: point it at the production chain (`.check(legacyInteger("validation.number"))`) so it no longer checks native v4 `.int`. If the reviewer prefers, this block can instead be deleted once real 4.6.6 runs the main block, since the stand-in subpath becomes redundant then. I will not decide that myself; it is an open question below.
- Revert proof: putting `.int()` back must make the fraction and large-number cases fail under 4.6.6.

## Gates (under the integrated Zod 4.6.6)
- Run the targeted test file, web typecheck, lint, the full web vitest suite, Prettier on the touched files, and the node-server build where pnpm can run.
- Report each exact command with its own exit code (pipefail).
- Nothing outside `apps/web`. No manifest or lockfile change. Each file stays at 300 lines or fewer. No change to UI, i18n or behaviour.

## Not claimed / open
- Non-finite input: `Number.isInteger` rejects NaN and Infinity, but JSON overflow such as `1e999` parses to Infinity. That diagnostic edge is the orchestrator's, so this plan claims no wider number policy and no full parity.
- How Infinity is reported (wrong type vs. integer issue) is not asserted here.
- Open question: keep and repoint the `zod/v4` stand-in block, or remove it after the switch?
