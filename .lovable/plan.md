# Card 3 of 7 — #143 follow-up + R3 «الإيراد حسب الخدمة» + R4 «الإيراد حسب الدكتور»

Web only (`apps/web`). No contract, API, worker, SQL or mock-rule change is needed (fit check at the end).

## Part A — deferred items

### A1. Issue #143 — `use-export-download.ts` (214 lines today, about 215 after)
- Replace the render-written `generation` ref with `const { epoch, isCurrent: isCurrentScope } = useCommittedEpoch(scope)`. `current()` checks `isCurrentScope(epoch)` instead of `generation.current.value === epoch`.
- Move the `live` snapshot write into a `useLayoutEffect` (no deps, runs after every commit). Keep the initial value from the first render (`useRef({ scope, rows, ready: <first-render readiness> })`), so a download called right after mount still sees a ready snapshot.
- `live.current.scope === scope` now compares against the last committed scope. A speculative render for another persona or a not-ready session can no longer change it.
- The token keeps `[scope, epoch, started, row.id]`. A speculative render produces the same epoch as the committed render, so it cannot create a second token for the same request.

### A1 test — new `use-export-download-concurrent.test.tsx` (about 140 lines)
- Uses the existing `use-export-download.test-kit.tsx` and the real mock root.
- Start a download for persona A and hold the adapter promise. Then, inside `startTransition`, switch to persona B (and, in a second case, to a not-ready session) through a component that suspends on a never-settling promise. React renders this speculatively and never commits it. Then abandon the transition.
- Assert: (1) `downloadExport` was called once; (2) calling `download(row)` again during or after the abandoned render returns the same promise and makes no second call; (3) once the bytes arrive, the anchor click happens and the URL is revoked, so the request was not treated as stale; (4) pending clears.
- The test proves only this: an abandoned transition render for another scope or a not-ready session, under React 19 in jsdom, does not stale or duplicate an in-flight download. It does not prove every possible concurrent interleaving is safe.
- Mutation proof: put back the render-time write of `live` and the generation. The test must fail. Then restore the source.
- The existing `use-export-download.test.tsx`, `use-export-download-access.test.tsx` and test-kit stay green and unchanged.

### A2. Deterministic test data
In every test file this card touches, ids and names are fixed synthetic constants (for example `00000000-0000-7000-8000-0000000000a1`, "Service A"), with no `randomUUID` and no real-looking names or phone numbers.

## Part B — R3 and R4 screens (same frame as R1/R2/R9)

Access: `canOpenReport` → `reportPermissionScope`. Both reports need `report_analytics` plus covering `view:invoices`, at clinic or branch scope. No role names are checked.

### Files
| File | Change | Est. lines |
|---|---|---|
| `screens/report-catalogue.ts` | add `by_service`, `by_doctor` to `SCREEN_REPORTS` (no group default) | +2 |
| `screens/report-screen-page.tsx` | dispatch both to the new pages | +4 |
| `screens/report-shell.tsx` | report-specific help line (R3 billed-not-collected, R4 management view) | +4 |
| `screens/revenue-rows.ts` (new) | `taxLast(rows)` stable partition (non-tax in received order, then tax); `rowLabel(kind,name,t)` for free/none/tax labels | ~35 |
| `screens/revenue-columns.tsx` (new) | `useRevenueColumns(kindLabels, fmt)`: name, line count, quantity, amount; tax row marked with `data-tax` and a top border/muted tint | ~70 |
| `screens/revenue-report-body.tsx` (new) | shared table + totals row (line count, quantity, billed, tax, total from response totals); used by both pages | ~90 |
| `screens/by-service-report-page.tsx` (new) | `useReportFilters(reportByServiceQuerySchema)` + `useReportQuery(api.reports.byService)` + body | ~60 |
| `screens/by-doctor-report-page.tsx` (new) | same for `reportByDoctorQuerySchema` / `api.reports.byDoctor` | ~60 |
| `shared/i18n/en-finance-reports.ts` / `ar-finance-reports.ts` | names/descriptions exist already; add help lines, column labels, totals labels (billed/tax/total), kind labels («بنود حرة»/Free lines, «بدون دكتور»/No doctor, «الضريبة»/Tax), dash placeholder | 85→~115 each |

`ReportTable` needs no change. Its `totals` record carries the five totals as cells under the numeric columns. Billed, tax and total show as a small labelled totals block under the table, so the totals row stays in the column layout. All files stay well under 300 lines, one component per file.

### Behavior
- Filters: From/To default to the current clinic month up to today; the branch comes from branch options; no groupBy. The card 2 branch fallback and the "checking branch" loading state carry over unchanged through `useReportFilters`.
- States (loading, empty, error with retry, forbidden) come from `ReportContent` / `report-screen-page`.
- Money uses the response's `currency` and `currencyExponent` through `useReportFormat`. Totals are the response's own and are never recomputed with `Number()`.
- Export button is prefilled with the report and its filters. Print, 390px cards, RTL first and logical CSS are inherited from the frame.
- No chart: the owner chose a table-only card (no `recharts`, no `revenue-chart.tsx`).
- R5–R8 and R10 stay hidden.

## Tests
New `screens/revenue-reports.test.tsx` (~200 lines), with a test kit split into `revenue-reports.test-kit.tsx` (~90) if needed. Real mock root, synthetic invoices with service lines, free lines, a no-doctor line and tax:
1. R3 totals equal the BigInt sums of the rows: billed = sum of non-tax, tax = the tax row, total = billed + tax, and line count and quantity match. Same for R4.
2. The tax row is rendered last (desktop and mobile), even when the input order puts it first (unit test on `taxLast`).
3. Kind labels: free → «بنود حرة» / Free lines, none → «بدون دكتور» / No doctor, tax → «الضريبة» / Tax, in both languages.
4. Permissions: `report_analytics` + `view:invoices` (clinic, and branch) opens both and shows both cards; `report_analytics` without `view:invoices` shows neither and the route shows the "not allowed" page; `report_own` alone never opens R3/R4; `report_catalogue.test.ts` is updated so a receptionist still sees only R1/R2/R9.
5. Routes `/clinic/reports/by_service` and `/clinic/reports/by_doctor` render the right page.
6. Empty, error with retry, and forbidden states.
7. Help line present for each report, in ar and en.
8. A1 concurrent test (above).

Mutation proofs (each must fail a test, then the source is restored byte for byte): (a) totals cell bound to the wrong field; (b) the covering `view:invoices` check bypassed in `canOpenReport`; (c) `taxLast` returning input order; (d) the A1 layout-effect move reverted.

## Acceptance
Typecheck, lint (0 errors) and the changed-area tests (`src/report-exports`), then the full web suite once at the end. Every file under 300 lines. The build is tried directly. If the Node 22/pnpm 10 mismatch blocks pnpm gates, I will report it without bypassing. Clinic-persona browser checks will likely stay unverified, because the preview signs in as platform admin only.

## Contract / API / mock fit
- The query schemas have `from`, `to` and an optional `branchId`, with no cursor and no groupBy, and the 366-day range is enforced. This fits.
- Rows have `kind`, `name`, `lineCount`, `quantity`, `amountMinor` and `currency`. Totals have `lineCount`, `quantity`, `billedMinor`, `taxMinor` and `totalMinor`, plus `currency` and `currencyExponent`. This fits.
- The mock sorts rows by kind then id, so the tax row is already last. The contract does not guarantee that order, so the UI enforces tax-last for display only. This is not a rule change.
- `api.reports.byService` / `byDoctor` exist in the `ApiClient` and the mock. No change is needed anywhere outside `apps/web`.
