# Card 2 of 7: R9 Cash closings + PR #141 follow-ups (web only)

## Contract check (what I read)
- `reportPermissionScope`: R9 = `view:report_takings:{clinic|branch}` plus `view:cash_closings` at the same scope. `report_own` is never a path to it. Fits the spec.
- `reportCashClosingQuerySchema` is `reportFields` only, **no cursor fields**, so R9 is a single table (no paging).
- Response: rows `{closingId, branchId, branchName, businessDate, expectedMinor (signed), countedMinor, differenceMinor (signed), closedBy, closedByName|null, notePresent, currency}`; totals `{expectedMinor, countedMinor, differenceMinor}`, `currency`, `currencyExponent`. No method totals in the contract. Fits the spec.
- `api.reports.cashClosings` already exists in the client and the mock (`mock-report-takings.ts`). The closing page `/clinic/cash-closings/$closingId` opens on any `view:cash_closings` key.
- **No contract, API, worker, SQL or mock-rule change needed.**

## Part A: follow-ups
1. `report-exports/screens/report-export-dialog.tsx` (46 → ~50): the export button goes inside `DialogTrigger asChild`, so Escape gives focus back to it. `onOpenChange(true)` still bumps the opening counter, so the form gets a fresh prefill each time.
2. `report-exports/use-export-download.ts` (~+20): pending downloads are kept in a `Map<token, rowId>`. The token is created per request and carries the access fingerprint. When the fingerprint changes, old-access tokens are dropped. Each `finally` deletes only its own token, and "is pending" means some current-access token exists for the row.
3. `screens/use-report-filters.ts` (73 → ~95) + `report-filters-bar.tsx` (94, prop only): a new `reconcileBranch(options)` effect. When options are loaded and the selected `branchId` is not among them, the selection is set back to `null` (all branches) **before** the query key is built. While options load or fail, the query is suspended, so the old branch is never sent, retry included. Synthetic test IDs only (`branch-a`, `00000000-…-0001`-style ids from the kit).
4. File splits, no behaviour change:
   - `shared/api/mock/mock-export-xlsx.test.ts` (302): move the numeric/count boundary group to `mock-export-xlsx-numbers.test.ts` (~90). The original drops to ~215.
   - `shared/i18n/en.ts` (304): move one coherent inline group into a companion `en-*.ts` file and spread it back in (mirror `ar.ts` only if it keeps key parity simple). Both files go under 300.

## Part B: R9 screen
New or changed files (all under `report-exports/screens/`):
- `report-catalogue.ts` (+1): add `"cash_closings"` to `SCREEN_REPORTS`. It gets no group default, so the filters bar shows no groupBy. The card shows through `availableScreens` (permission strings only). R3–R8 and R10 stay hidden.
- `cash-closings-report-page.tsx` (~110): the shared `ReportShell`, `useReportFilters(cash_closings, reportCashClosingQuerySchema)`, `useReportQuery(api.reports.cashClosings)`, `ReportContent` states (loading, empty, error with retry, forbidden through the existing screen page), the export dialog prefill, and print.
- `cash-closings-report-columns.tsx` (~90): column defs for `ReportTable`. Business day, branch, expected (`SignedAmount`), counted, difference (`SignedAmount`: minus sign plus a shortage/over text token, not colour alone), closed by (`closedByName ?? "—"`), note (icon plus «فيه ملاحظة / لا» text). The business day cell is a `Link` to `/clinic/cash-closings/$closingId` when `can("view","cash_closings")` holds; otherwise plain text.
- `cash-closings-totals.ts` (~30): BigInt sum over minor strings for expected/counted/difference. The footer shows the response totals; the test checks they equal the row sums.
- `report-screen-page.tsx` (53, +3): dispatch `cash_closings` to the new page.
- 390px: reuse `ReportTable`'s existing stacked-card mode (labels per cell).
- i18n: `en-finance-reports.ts` / `ar-finance-reports.ts` (+~15 keys each): card title/description, the 7 column labels, the note yes/no labels, shortage/over tokens. «المراجع» wording kept; no «المريض».

## Tests
- `cash-closings-report.test.tsx` (~200, new), on the real mock client:
  - footer totals = BigInt row sums (mixed signs, a shortage row is negative with its text token);
  - `closedByName` null shows «—»; the note shows an icon plus text; no method-total text appears;
  - the row links to the closing page; with no link permission the cell is plain text;
  - Arabic and English labels.
- `report-catalogue.test.ts` (+3): receptionist with `view:report_takings:clinic`, `view:payments`, `view:invoices`, `view:cash_closings` gets R1, R2 and R9. `report_takings` without `view:cash_closings` gets no R9. `report_own` only gets no R9.
- Route test (in `report-screens.test.tsx`, +1): `/clinic/reports/cash_closings` renders R9; a caller without access sees the forbidden state.
- `use-report-filters-reach.test.tsx` (~110, new): reach narrows while the screen is open → selection goes to all branches → the report loads with no `branchId`; retry never resends the refused branch.
- `report-export-dialog` test (+1): Escape returns focus to the export button; reopening gives a fresh prefill.
- `use-export-download.test.tsx` (+2): a restored-access retry is not blocked by an old request; an old request's `finally` does not clear the newer token.
- Mutation proofs (each reverted with `cmp`): totals sum, the R9 covering check (drop `cash_closings` from the screen gate path through `canOpenReport`), and the branch reset.

## Size plan
Every new file is under ~200 lines, one component per file. `report-screens.test.tsx` (206) only gains about 15 lines.

## Checks
Typecheck, lint (0 errors), the report-exports and i18n/mock tests touched, and one full-suite run. The build may be blocked by the sandbox's Node 22/pnpm mismatch; I won't bypass it, and I'll report it. A real browser check for clinic personas is likely blocked again (the preview opens only as platform admin), and I'll report that too.
