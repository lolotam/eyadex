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
  invalid_type_error: "validation.number",                       // read by Zod 3
  error: (issue: { input?: unknown }) =>                          // read by Zod 4
    issue.input === undefined ? undefined : "validation.number",
};
z.number(taxRateNumberParams).int("validation.number").min(0, "validation.outOfRange").max(10000, "validation.outOfRange")
```
- Zod 3 ignores `error`. It has no `required_error`, so undefined keeps today's default message, `"Required"`.
- Zod 4 ignores `invalid_type_error`. For undefined, returning `undefined` falls back to Zod 4's default message.
- It is passed as a variable, not a literal, so both versions' parameter types accept the extra key. No global error map.
- The `.int` / `.min` / `.max` string messages work the same in both versions.

## Tests (vitest, each fails without its change)
- `apps/web/src/shared/api/new-clinic-finance.test.ts` (new): runs `createClinicFormSchema` against a valid base and checks the `taxRateBp` issue message for each input:
  - `null`, `"abc"` and `NaN` → `validation.number`;
  - `1.5` → `validation.number`;
  - `-1` and `10001` → `validation.outOfRange`;
  - `undefined` → `"Required"` (today's Zod 3 behaviour, pinned);
  - `0` and `10000` pass.

  A second block builds `z.number(taxRateNumberParams)` from `zod/v4`, which ships inside the current package, so no dependency change. It shows `null`, `"abc"` and `NaN` give `validation.number`, and `undefined` does not.
- `apps/web/src/visits/use-list-flush.types.test.ts` (new): type-level plus runtime check that a Zod 3 schema and a `zod/v4` schema of `{ items: T[] }` are both assignable to the hook's parser type, and that `data.items` keeps its element type (`expectTypeOf`). The existing visit sign/flush tests cover the behaviour.

Both test files import `zod/v4` only as a test stand-in. If importing the subpath is unwanted, I can drop those blocks and leave the cross-major proof to Sol's Zod 4 run.

## Stage 1 gates (current Zod 3)
- `pnpm --filter @eyadex/web typecheck`, lint (0 errors), the vitest suite, Prettier on touched files, node-server build.
- No dependency, package or lockfile change. Nothing in `packages/contracts`, API, worker or `db`. Each file stays under 300 lines.
- No UI, copy or behaviour change.

## Open blockers (true ones only)
1. **Undefined tax rate under Zod 4:** the message changes from `"Required"` to Zod 4's default text. That only matters if a screen shows it. The form always sends a number (`valueAsNumber` gives `NaN`, never undefined), so I expect no visible change, but I did not confirm this in the browser. Owner choice: accept the change, or have the `error` function return `"Required"` for undefined under Zod 4 too.
2. **Real 4.6.6 not inspected:** the `ZodTypeAny` alias and the `normalizeParams` behaviour were checked on the `zod/v4` subpath of 3.25.76, not on 4.6.6. Sol should re-run the two new test files after the switch.
3. **Contract-owned messages:** the web reads contract issue messages (`validation.rangeTooLong`, `validation.*`). These depend on Grok keeping those messages exactly, which is outside the frontend.
