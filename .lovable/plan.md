# F3 slice 3, card A: on-screen finance reports API (R1 to R10)

## Before starting (needs your confirmation)
1. **Who edits `apps/api`:** my project knowledge says I never touch `apps/api` or `packages/*` unless the brief says so. This brief does say so, and I'll take that as permission for `apps/api` only. `packages/contracts` stays unchanged unless point 3 below needs a change.
2. **db specs:** this sandbox has none of the `EYADEX_TEST_*_URL` databases. I can write the `*.db.spec.ts` files and run the unit specs, typecheck and lint here. The db specs will only run in CI or locally on your side. Should I report it that way, or do you want to give me a test database?
3. **Contract fit:** before writing any code I'll read all of `finance-reports.ts` and `finance-reports-rows.ts`. If a field the spec needs is missing (R6 oldest-credit day, R7 `source`, R8 `discountedBy`), I'll stop and ask rather than change the contract.

## Files (all under `apps/api/src/modules/billing/` unless noted)

### Domain (pure, Arabic JSDoc)
- `domain/report-scope.ts`
  - `REPORT_KEYS`: one row per report, holding its `@Require` base key and its covering keys (the table in the brief).
  - `decideReportScope(report, permissions, member, clinicBranchIds, branchFilter)` returns `{ scope: "clinic"|"branch"|"own", branchIds }` or `forbidden`.
  - Clinic scope = every branch of the clinic, inactive ones included. Branch scope = the member's branches. Own scope applies to R10 only.
  - Every covering key is checked with `viewScopeCovers` at the decided scope. For R10, only an `own` key counts.
  - A `branchId` outside the reach answers `forbidden`.
- `domain/report-aging.ts`: `ageBucket(issueDay, today)` gives 0–30 / 31–60 / 61–90 / 90+.
- `domain/report-rollup.ts`: rolls days up into months for R1/R2, plus the totals reducers (bigint over minor-unit strings).

### Ports and wiring
- `ports/billing-staff.ts`: `BillingStaffNames.findMany(tx, clinicId, membershipIds)`. It is bound in `billing.module.ts` to identity's `PgProviderDirectory.findMany`, exported through `identity/index.ts` if it isn't exported yet.
- `ports/tokens.ts`: adds `FINANCE_REPORTS`.
- `ports/billing-branches.ts`: reuse `listForOptions` for clinic-wide branch ids and names (no new port).

### Queries (each ≤ 300 lines, split by responsibility)
- `queries/report-sql.ts`: `uuidArray` copied from `audit-sql.ts`, plus `reportCursor` (reuses `list-cursor.ts`).
- `queries/report-takings.ts`: R1, R2 and R9 through `finance_report_daily_takings`, `_period_summary` and `_cash_closings`.
- `queries/report-analytics.ts`: R3 and R4 through `finance_report_by_service` and `_by_doctor`, tax row kept.
- `queries/report-outstanding.ts`: R5 from the `finance_invoice_balances` view, where `owed_minor > 0`, the invoice is issued and its issue day is in range. Ordered by id, with a cursor. The summary per bucket and branch comes from the same query.
- `queries/report-patient-credit.ts`: R6, credits − funded allocations − refund_sources per patient, keeping only balances > 0, with `min(day)`. Keyed by patient id.
- `queries/report-refunds.ts`: R7, one row per refund. `source = payment` when the spent credit's `cause = 'refund'`, otherwise `credit`.
- `queries/report-discounts.ts`: R8, a UNION of live discounted lines (`archived_at IS NULL`) and invoice discounts, on issued invoices in range, with `discounted_by`.
- `queries/report-own-summary.ts`: R10, live lines of non-void invoices where `provider_id = membershipId` and `ownPatientFilter(membershipId, sql\`i.patient_id\`)`, grouped by clinic month.

### Use case and HTTP
- `persistence/pg-finance-reports.ts`, the `FinanceReports` use case, which:
  - runs inside `withTenant`;
  - calls `decideReportScope`;
  - runs the query;
  - resolves names in one batch each: patients through `displayNames` (no audit row), staff through the new port, and branch or service names by `preferredLanguage`;
  - attaches the money facts from `clinicMoneyFacts`;
  - takes "today" from the injected `Clock` in the clinic timezone;
  - parses each answer with its response schema.
- `http/finance-reports.controller.ts`: ten `GET /v1/finance-reports/<id>` handlers. Each has `@RequiresFeature("finance")` plus one `@Require` and uses `ZodValidationPipe(contract query)`. If this goes over 300 lines, I'll split it into `finance-reports-lists.controller.ts` (R5 to R8).
- `apps/api/src/shared/zod-validation.pipe.ts`: when an issue's message is `validation.rangeTooLong`, it throws `report_range_too_long`.
- `apps/api/src/shared/errors.ts`: adds the 400 status line for `report_range_too_long`. The ar/en messages already exist in `finance-error-messages.ts`.

### Module boundaries
- Move the billing list out to `apps/api/src/shared/__tests__/billing-relations.ts`. Add `finance_invoice_balances` and the five `finance_report_*` functions to it, and import it into `module-boundaries.spec.ts`, which brings that file back under 300 lines.

## Tests
- Unit tests, which run here:
  - `report-scope.spec.ts`: every report at clinic, branch and own scope; a missing covering key; a `branchId` outside the reach; a branch key never standing in for `own`; inactive branches included at clinic scope.
  - `report-aging.spec.ts`: the 30/31/60/61/90/91 edges.
  - `report-rollup.spec.ts`
  - the range-too-long mapping in the pipe.
- db specs, which run in CI:
  - `reports-takings.db.spec.ts` (R1, R2, R9)
  - `reports-analytics.db.spec.ts` (R3, R4, the tax row, the «No doctor» row)
  - `reports-patients.db.spec.ts` (R5 to R8: numbers, cursor, names, no `patient_access` row)
  - `reports-credit.db.spec.ts` (R6)
  - `reports-own.db.spec.ts`: R10 matches `GET /v1/invoices` for the same doctor, and only his own lines count.
  - `reports-access.db.spec.ts`:
    - a receptionist reaches R1, R2 and R9 only;
    - `report_patients` without `view:invoices` gets nothing from R5;
    - `report_own` never opens R5;
    - a 367-day range answers 400 `report_range_too_long`;
    - another clinic's data never shows up.
  - Shared fixtures go in `__tests__/report-fixtures.ts`.
  - Every spec checks the clinic, branch and own scopes and connects as `eyadex_app`.
- Revert-proof: every rule is disabled once and its test is shown to fail.

## Out of scope
The web ApiClient and the mock (card B), exports, and any `db/sql` change.

## Gates
Typecheck, lint, unit tests, Prettier, every file ≤ 300 lines, no lockfile change, plus the `api-image` build if it can run here. The report will give the commit SHA, the changed lines and the test counts, and will name the db specs that were not run here.
