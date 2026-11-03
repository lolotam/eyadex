# Card 7 — R10 «ملخص فواتيري» / "My billing summary" (UI only)

## Fit check (read before planning)

- Access: `own_summary` = `report_own` at `own` only + covering `invoices` at `own` (finance-report-access.ts line 44; the own scope needs an own covering key, a clinic/branch key does not stand in). Fits the spec; no change.
- Query/response: `reportOwnSummaryQuerySchema` (from, to, optional branchId), rows `{period, billedMinor, currency}`, `totals.billedMinor`, `currency`, `currencyExponent`. `api.reports.ownSummary` and the mock (`mock-report-analytics.ts` `ownSummary`) exist. No contract/API/mock change needed.
- `branchId` for an own caller: the mock filters invoices by `reaches(ctx, branchId)`, and an own-scope reach is every clinic branch (`use-export-branch-options.test.tsx` row `own_summary … true`). So a branchId would narrow by branch, but the doctor's lines are already limited to his own lines on his own patients, there is no branch column, and the spec calls the report "per month, mine". Decision (as recommended): add `own_summary` to the shared `NO_BRANCH_REPORTS` — screen and export form hide the branch field, fetch no branch list, never send `branchId`, exactly like R6.
- Month labels: `useReportFormat().period` already formats «YYYY-MM» as a long month in the viewer's language (UTC-anchored, no zone shift). Reused.
- Invoices link: shown when `can(perms, "view", "invoices")` (the same check R5/R8 use; the doctor's `view:invoices:own` passes; /clinic/invoices is the list he already sees).
- No place where contract/API/mock does not fit.

## Files

Change:
- `report-exports/report-no-branch.ts` (~10) — add `own_summary`, extend the why-comment (own report: the doctor's own lines; no branch filter).
- `screens/report-catalogue.ts` (~57) — add `own_summary` to `SCREEN_REPORTS`.
- `screens/report-screen-page.tsx` (~69) — render `OwnSummaryReportPage` for `own_summary`.
- `screens/report-shell.tsx` (~85) — replace the nested subtitle ternary with a lookup map `SUBTITLE_KEY: Record<ScreenReportId, string>` (same keys, R1/R2 keep `financeReports.note`), adding `own_summary → financeReports.ownSummary.note`. Same output for R1–R9.
- `shared/i18n/ar-finance-reports.ts`, `en-finance-reports.ts` (~190 each) — `ownSummary: { note, month, billed, total, myInvoices }`.
  - ar note: «المبلغ المُفوتَر لبنود فواتيرك أنت في كل شهر، كما فُوتِر لا كما حُصِّل؛ لا يتضمن هذا التقرير المدفوع ولا المتبقي.»
  - en note: "The billed amount of your own invoice lines per month, as billed, not as collected; this report has no paid or owed amounts."
  - link: «فواتيري» / "My invoices"; columns «الشهر»/"Month", «المُفوتَر»/"Billed", totals «الإجمالي»/"Total".

Add (all under `report-exports/screens/`):
- `own-summary-report-page.tsx` (~70) — `useReportFilters("own_summary", reportOwnSummaryQuerySchema)` (current clinic month default, no branch), `useReportQuery("own_summary", …, api.reports.ownSummary)` (key already carries persona/permissions/reach and filters; late answers ignored), `ReportShell` + `ReportContent` (loading/empty with the normal period wording/error+retry), body, and the «فواتيري» link (print:hidden) when `can(view, invoices)`.
- `own-summary-columns.tsx` (~45) — month (`fmt.period`) and billed (`fmt.money`) columns only; labelled values on 390px via the existing `ReportTable` card mode.
- `own-summary-report-body.tsx` (~50) — `ReportTable` with rows keyed by period+currency and a totals row from `totals.billedMinor`, shown only when it equals the BigInt sum of `rows[].billedMinor` (`report-money.ts` helper); on disagreement the totals row shows «—» via i18n (no Number()).
- `own-summary-report.fixtures.ts` (~60) — deterministic synthetic ids/names, R10 keys, a mock seed with values above 2^53.
- `own-summary-access.test.tsx` (~110), `own-summary-report.test.tsx` (~230); split further if either passes 280.

No new text is clamped, so print shows everything; table prints, nav hidden by existing `report-print.css`.

## Tests

own-summary-access.test.tsx
- `report_own:own` + `view:invoices:own` opens R10; `report_own:own` alone does not; `view:invoices:own` alone does not.
- `report_own:branch|clinic` (with branch/clinic invoices) does not open R10; `report_takings/analytics/patients` at branch/clinic never open R10.
- `report_own` + `view:invoices:own` opens none of R1–R9; a caller with own + clinic keys sees both sets of cards.
- Route `/clinic/reports/own_summary`: opens for R10 keys, forbidden page otherwise.

own-summary-report.test.tsx
- Totals row equals the BigInt sum with row values above 2^53; a response whose totals disagree shows no wrong total.
- Month labels in ar and en (no raw «YYYY-MM» text).
- DOM contains no paid/owed/branch/patient text and no ids (seeded patient names and ids absent).
- «فواتيري» link only with `view:invoices`; href `/clinic/invoices`.
- Shell header shows the own note, not the daily-takings note.
- No branch picker; request never carries `branchId`; export form for own_summary hides the branch field, fetches no branch list, and a failing branch list does not block submit.
- Empty, error-with-retry, forbidden states; late answer of an old filter ignored.

Mutations (each reported with the failing test, then restored byte-for-byte with SHA check):
1. drop the covering `invoices` key for `own_summary` check path (in a local copy of the screen gate) → access test fails;
2. let a branch-scope `report_own` key open R10 → own-scope test fails;
3. show `totals.billedMinor` without the BigInt agreement check → totals test fails.

## Existing tests to update (R10 is now built)

- `report-screens.test.tsx:132–136` — «unbuilt report is not found» moves from `own_summary` to a clearly invalid id (`not_a_report`).
- `adjustment-access.test.tsx:46–51` — "R10 stays hidden" becomes "R10 is a screen and shows only for its keys".
- `outstanding-access.test.tsx:37` and any card-list assertion that excludes R10 — updated to the new truth.
- `use-export-branch-options.test.tsx:111` — keep as is (the hook still reads own reach when called directly); the form/screen simply no longer calls it for own_summary. R1–R9 behaviour unchanged.

## Process limits

- Full suite once at the end; focused files during work. Every file under 300 lines, one component per file.
- The Node/pnpm engine mismatch may block pnpm build; reported plainly, not bypassed. Clinic-persona browser checks (1440/390, ar/en, print) likely unavailable in the platform-admin preview; reported as unverified.
