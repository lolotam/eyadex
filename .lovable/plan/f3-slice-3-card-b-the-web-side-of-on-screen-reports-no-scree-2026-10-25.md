# F3 slice 3, card B: the web side of on-screen reports (no screens)

## Blocker before any code
This workspace is at `e17d9fc6` and does not have PR #126 yet. `finance-reports.controller.ts`, `domain/report-scope.ts`, `use-cases/reports/` and `queries/report-*.ts` are all missing here, and I can't pull from inside this environment. The mock has to follow the API exactly, so I'll wait until `lovable` is moved to `main` (535aa152 or later) and synced here. After that, step 1 is to read those files and the contracts, and fix any detail below that disagrees with them.

## Files

### ApiClient
- `shared/api/reports-client.ts`: the `ReportsClient` type with ten methods taking `(persona, query)`: `dailyTakings`, `periodSummary`, `byService`, `byDoctor`, `outstanding`, `patientCredit`, `refunds`, `discounts`, `cashClosings`, `ownSummary`. Each takes the contract query input and returns the contract response, following `cash-closings-client.ts`.
- `shared/api/api-client.ts`: adds `reports: ReportsClient`.

### HTTP
- `shared/api/http/http-reports.ts`: `createHttpReports(ctx)`. One shared `get(id, query, schema)` builds the query string from the parsed contract query and calls `GET /v1/finance-reports/<id>` with that report's response schema.
- `shared/api/http/http-adapter.ts`: wires it in.

### Mock (each file ≤ 300 lines)
- `mock/mock-report-access.ts`: `requireReport(db, persona, reportId, query)`. It checks things in the API's order:
  1. `guardFinance`;
  2. the report key;
  3. the covering key at the decided scope (R6: `view:payments:clinic`; R10: only `view:invoices:own`);
  4. the scope: clinic means every branch, inactive ones included; branch means the member's branches;
  5. a `branchId` outside the reach answers `forbidden`;
  6. a range over 366 days answers `report_range_too_long`.

  Where the merged API puts these checks in a different order, I'll follow the API.
- `mock/mock-report-days.ts`: clinic-timezone day helpers through `clinic-time.ts`, and rolling days up into months.
- `mock/mock-report-takings.ts`: R1, R2, R9.
- `mock/mock-report-analytics.ts`: R3 and R4, with the tax row and the «بدون دكتور / No doctor» row.
- `mock/mock-report-outstanding.ts`: R5. Age buckets (0–30 / 31–60 / 61–90 / 90+) count from the clinic's today, and the summary is per bucket and branch.
- `mock/mock-report-credit.ts`: R6. Only available credit counts, through `creditRemaining` in `@eyadex/contracts/settlement`.
- `mock/mock-report-movements.ts`: R7 `source` (payment when the credit's cause is a refund), and R8 one row per discount with `discountedBy`.
- `mock/mock-report-own.ts`: R10. The doctor's own live lines on non-void invoices of his own patients (`isOwnPatient`), per month.
- `mock/mock-report-page.ts`: cursor paging, ≤ 100 a page, through `mock-list-cursor.ts`.
- `mock/mock-reports.ts`: `createMockReports()`, which every report goes through. Names follow the caller's language.
- `mock/mock-adapter.ts`: wires it in.

### Mock stores slice 2b's fields
- `mock-finance-state.ts`: adds `businessDate` and `discountedBy` to stored invoices, and `discountedBy` to lines.
- The issue path sets them. The edit path gets a small new `mock-discount-authors.ts` that mirrors the API's `invoice-discounts.ts`: an unchanged discount keeps its author, and a new, moved or changed one takes the editor.
- `mock-payment-state.ts` / `mock-payment-writes.ts`: an allocation takes `businessDate` from its payment's day, and a credit application from its own day.
- The read mappers strip these fields wherever the contract doesn't carry them.

### Error code
- `packages/contracts/src/common.ts`: takes `report_range_too_long` out of `financeApiOnlyErrorCodes` and into the web catalogue (the brief allows this one change). The two other F3 codes stay API-only.
- Messages go in `shared/i18n` `errors.report_range_too_long`, in ar and en.
- `http-errors` keeps the code as its own code.
- `AGENTS.md` quick rule: change it to "only the remaining F3 codes stay outside the catalogue".

## Tests (vitest on the mock, each revert-proofed)
- `reports-takings.test.ts`: R1 and R2 by day and by month, plus R9, all against seed numbers.
- `reports-analytics.test.ts`: R3 and R4 totals, the tax row, and the no-doctor row.
- `reports-patients.test.ts`: the R5 buckets at their edges with a pinned today, R6 available credit only, R7 `source`, R8 rows and authors, and paging for R5 to R8 (cursor, plus a bad cursor answering `validation`).
- `reports-own.test.ts`: R10 counts only the doctor's own lines, and its invoices match `listInvoices` for the same doctor.
- `reports-access.test.ts`:
  - a receptionist reaches R1, R2 and R9 only;
  - `report_patients` without `view:invoices` is refused on R5;
  - `report_own` never opens R5;
  - a `branchId` outside the reach answers `forbidden`;
  - a 367-day range answers `report_range_too_long` (366 days passes).
- `discount-authors.test.ts`: when an invoice is edited, an unchanged discount keeps its author, and a new, moved or changed one takes the editor.
- HTTP: a `fetch-stub` test on one report's path and query string, and the error mapping for `report_range_too_long`.
- `apps/api` and `db/` are not touched.

## Gates
Typecheck, lint, web tests, Prettier, every file ≤ 300 lines, no lockfile change. The report will give the commit SHA, the changed lines, the test counts and the review-lessons checklist.
