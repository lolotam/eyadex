# Zod 4 readiness — frontend stage 1 (apps/web only, still on Zod 3)

## What I checked (read-only, at the current tree)

- Installed `zod` is 3.25.76; it ships the `zod/v4` subpath, which I used as the local stand-in for Zod 4. The real patched 4.6.6 was not inspected here: Sol should re-check the two points below on 4.6.6 before the switch.
- `@hookform/resolvers` is 5.9.1. Its `zodResolver` has overloads for both Zod 3 and Zod 4 schemas, so the ~25 form files need no change.
- `ZodTypeAny` is still exported in Zod 4 classic (`v4/classic/compat.d.ts`: `ZodType as ZodTypeAny`, deprecated). `z.ZodError`, `z.input`, `z.infer`, `z.ZodType<T>` all exist. So `http-transport.ts`, `http-reports.ts`, `reports-client.ts`, `mock-reports.ts`, `mock-report-access.ts`, `mock-calendar.ts`, `mock-medical-access.ts` and `mock-appointments.ts` stay as they are. Renaming deprecated names is out of scope.
- `z.ZodTypeDef` does not exist in Zod 4. Only `visits/use-list-flush.ts:26` uses it, so it is a real blocker.
- In Zod 4, `normalizeParams` reads only `error` and `message`. `invalid_type_error` is still accepted at runtime but ignored, and TypeScript rejects it in a literal. Only `shared/api/new-clinic-finance.ts:23` uses it, so it is a real blocker.
- Other uses work the same in both versions: `issue.message` checks (mail-provider and WhatsApp dialogs, weekly schedule, mock report range), `issue.path[0]` / `path.join(".")`, `.email("validation.email")`, and `safeParse` success/data/error.

## Changes (2 source files, 2 test files)

### 1. `apps/web/src/visits/use-list-flush.ts`

Swap the `schema` option type for a small public structural contract that works in both versions:

```ts
type ItemsParser<T> = {
  safeParse(input: unknown): { success: true; data: { items: T[] } } | { success: false };
};
schema: ItemsParser<T>;
```

- Zod 3's `SafeParseReturnType` and Zod 4's `ZodSafeParseResult` are both assignable to this. Callers keep passing their contract schemas unchanged.
- Typed `data` stays typed. No `any`, no casts, no private types. The hook body does not change.

### 2. `apps/web/src/shared/api/new-clinic-finance.ts`

Replace the inline `{ invalid_type_error: ... }` with one exported options variable:

```ts
export const taxRateNumberParams = {
  invalid_type_error: "validation.number", // read by Zod 3
  error: (issue: { input?: unknown }) =>
    // read by Zod 4
    issue.input === undefined ? "Required" : "validation.number",
};
z.number(taxRateNumberParams)
  .int("validation.number")
  .min(0, "validation.outOfRange")
  .max(10000, "validation.outOfRange");
```

- **Zod 3:** ignores `error`. It keeps `invalid_type_error`, and with no `required_error` an undefined value gets today's default message, `"Required"`. Nothing changes.
- **Zod 4:** ignores `invalid_type_error`. The callback returns `"Required"` for undefined and `validation.number` for every other wrong type (null, text, NaN, boolean). The message is the same under both majors.
- `.int` / `.min` / `.max` set their own string messages, so the callback never sees those issues.
- It is passed as a variable, not a literal, so both versions' parameter types accept the extra key. No global error map.
- The `.int` / `.min` / `.max` string messages work the same in both versions.

## Tests (vitest, each fails without its change)

Every test is labelled as one of three kinds:

- **[Zod 3, current]**: runs on the installed major today.
- **[v4 stand-in]**: uses the `zod/v4` subpath inside 3.25.76. This is evidence only, not 4.6.6 verification.
- **[4.6.6, pending]**: the same file re-run by Sol after the switch.

- `apps/web/src/shared/api/new-clinic-finance.test.ts` (new). One shared table of cases for `taxRateBp` and its expected message:
  - `undefined` → `"Required"`;
  - `null`, `"abc"`, `NaN`, `true` → `validation.number`;
  - `1.5` → `validation.number`;
  - `-1`, `10001` → `validation.outOfRange`;
  - `0`, `10000` → pass.

  The file has two blocks:
  - **[Zod 3, current]**: runs the table on `createClinicFormSchema` with a valid base.
  - **[v4 stand-in]**: runs the same table, `undefined` → `"Required"` included, on `z.number(taxRateNumberParams).int(...).min(...).max(...)` built from `zod/v4`.

  Both blocks assert the same messages, so undefined is proven the same under both majors.

- `apps/web/src/visits/use-list-flush.types.test.ts` (new), with two checks:
  - **[Zod 3, current]** and **[v4 stand-in]**: a `{ items: T[] }` schema of each major is assignable to `ItemsParser<T>`, and `data.items` keeps its element type (`expectTypeOf`).
  - **Runtime**: `safeParse` success and failure narrow correctly.

  The existing visit sign/flush tests still cover the behaviour.

- Both files are **[4.6.6, pending]**: Sol re-runs them unchanged after the switch.

## Stage 1 gates (current Zod 3)

- `pnpm --filter @eyadex/web typecheck`, lint (0 errors), the vitest suite, Prettier on touched files, node-server build.
- No dependency, package or lockfile change. Nothing in `packages/contracts`, API, worker or `db`. Each file stays under 300 lines.
- No UI, copy or behaviour change.

## Open blockers (true ones only)

1. **Patched 4.6.6 runtime proof is pending:** the stand-in tests run on the `zod/v4` subpath of 3.25.76. The manager has confirmed 4.6.6 still exports `ZodTypeAny` (`v4/classic/compat.d.ts:39`), so aliases stay in place. After the switch, Sol must re-run both new test files on 4.6.6 to prove that `error` takes priority and `invalid_type_error` is ignored there.
2. **Contract-owned messages:** the web reads contract issue messages (`validation.rangeTooLong`, `validation.*`). These depend on Grok keeping those messages exactly, which is outside the frontend.
