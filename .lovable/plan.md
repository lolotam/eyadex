# F3 report screens — card 1 of 7 (shared frame + R1 + R2) and PR #140 follow-ups

Web only (`apps/web`). No contract, API, worker, SQL or mock business-rule change is needed (see "Fit with contract/API/mock").

## Part A — PR #140 follow-ups (done first)

| # | File | Change | Size |
|---|------|--------|------|
| A1 | `report-exports/export-request-form.tsx` | `noAccess = eligibleReports.length === 0` (drop `&& !reportLost`). The report selector renders only when `eligibleReports.length > 0`; the "report lost" message stays when another report remains. | ~±6 |
| A2 | `shared/i18n/*/report-exports` ar + en | Reword `reportExports.request.dateFormat` to a neutral "Pick a clinic business day (Asia/Kuwait time)" / «اختر يوم عمل في العيادة (بتوقيت الكويت)» — no typing order. | ~±2 |
| A3 | `report-exports/use-export-download.ts` | Capture the access fingerprint at start; the in-flight key becomes `id + fingerprint`; on settle, drop the result (success, forbidden, not_found) when the current fingerprint differs. The existing denial-clearing effect stays. | ~+20 |
| A4 | `shared/api/mock/mock-export-sheet-xml.ts` + `mock-export-xlsx.test.ts` | Guard becomes `value < 0n` only; test a count above `MAX_SAFE_INTEGER` written as exact text, and a negative still refused. | ~±4 / +15 |

Tests: `use-export-download.test.tsx` adds "denied → access changes while a forbidden answer is delayed → late forbidden ignored, retry not blocked, download succeeds" (controlled deferred adapter over the real mock). `export-request-form-guards.test.tsx` adds "last eligible report revoked → no-access notice, no selector, no POST".

## Part B — shared frame + R1 + R2

New business folder `apps/web/src/finance-reports/` (on-screen reports; `report-exports/` keeps exports). It imports `report-exports` only for the export prefill entry (one-way).

### Files and estimated size (all under 300 lines, one component per file)

Shared frame:
- `finance-reports/report-catalogue.ts` (~60) — per `ReportId`: route slug, i18n key, and an `canOpen(permissions)` built on `reportPermissionScope` from `@eyadex/contracts/finance-report-access` (permission strings only). R1/R2 are marked "available"; the other eight are listed but not linked until their card lands.
- `finance-reports/available-reports.tsx` (~80) — «التقارير المتاحة / Available reports» cards, only for reports the caller may open; links to `/clinic/reports/<reportId>`.
- `finance-reports/use-report-filters.ts` (~120) — from/to default = first day of current clinic month → clinic today (clinic time zone from the session, not device clock), branchId, groupBy (R1 default `day`, R2 `month`); validates with the report's real query schema `safeParse` and maps `validation.rangeTooLong` / `validation.dateOrder` / `validation.date` to translated messages before any request.
- `finance-reports/report-filters-bar.tsx` (~150) — From/To (reuses `report-exports/export-date-field.tsx`), branch select fed by the reviewed `useExportBranchOptions` (inactive branches marked), groupBy only when the report supports it.
- `finance-reports/use-report-query.ts` (~90) — generic React Query hook over `useApi().reports.<method>`; key = clinic + member + persona + report + parsed query; enabled only when the filters parse and the session is coherent; no retry on `ApiError`; `report_range_too_long` and `forbidden` surfaced as codes via `errorKeyOf`.
- `finance-reports/report-money.ts` (~50) — `formatReportMinor(minor, exponent, currency, lang)`: `formatMinor` from contracts with the response's own `currency`/`currencyExponent`, then digit localisation (Arabic-Indic in ar), minus sign kept. Pure, no `Number()`.
- `finance-reports/report-locale.ts` (~40) — one `Intl` number/date formatter per language (`ar-KW` / `en-GB`), period label for a day or a month.
- `finance-reports/report-states.tsx` (~70) — loading skeleton, empty «لا توجد بيانات في هذه الفترة», error with retry, forbidden (reuses the app's standard not-allowed block).
- `finance-reports/signed-amount.tsx` (~30) — minus sign + `text-destructive`-style semantic token, never colour alone.
- `finance-reports/report-shell.tsx` (~120) — title, period note, filters bar, export button «تصدير هذا التقرير», print button, `children` table, help line slot.
- `finance-reports/report-export-dialog.tsx` (~90) — opens the existing `ExportRequestForm` in a dialog prefilled with this report and the current filters (needs a small `initialDraft` input on `useExportForm`; export limit stays 1096, screen limit 366).
- `finance-reports/report-print.css` (~25) — `@media print` hiding sidebar, header, filters and buttons (scoped class).
- `finance-reports/sum-minor.ts` (~25) — BigInt sum of minor strings, used by tests and by a dev-only check that totals equal row sums.

R1 «الإيراد اليومي»:
- `finance-reports/daily-takings-page.tsx` (~110) — shell + query + states.
- `finance-reports/daily-takings-table.tsx` (~150) — 1440px table with headers (period, branch, method, in, out, net), rows grouped under each period, totals row (in, out, net) from `response.totals`; 390px one card per row with labelled values.

R2 «ملخص الفترة»:
- `finance-reports/period-summary-page.tsx` (~110).
- `finance-reports/period-summary-table.tsx` (~170) — period, branch, invoiced, discount, tax, collected, refunded, credit applied, void count; totals for all seven; help line "credit applied is information, not collected money".

Routes (thin, head() + re-export):
- `routes/clinic.reports.$reportId.tsx` (~30) — dispatches by `reportId` validated against `REPORT_IDS`; unknown id → not found; a report the caller cannot open → standard forbidden; an id whose screen is not built yet → not found for now.
- `report-exports/reports-page.tsx` (+5) — mounts `AvailableReports` above the export form.
- `report-exports/use-export-form.ts` (+15) — optional `initialDraft` (report, from, to, branchId, groupBy) applied once per actor epoch; existing guards unchanged.

i18n (ar + en): `shared/i18n/{ar,en}/finance-reports.ts` (~90 each) + one-line composition in `ar.ts`/`en.ts`. Arabic copy says «المراجع», never «المريض».

Estimated total: ~1,900 changed lines (source ~1,350, tests ~550), within the slice size.

## Tests

- `report-catalogue.test.ts`: receptionist opens R1, R2, R9 only; `report_own` (doctor) never opens R5; a custom role with `view:report_takings` but no `view:payments` cannot open R1; R2 needs covering `view:invoices` and `view:payments`.
- `available-reports.test.tsx`: cards match permissions per persona (admin, doctor, receptionist, technician) on the real mock root.
- `use-report-filters.test.ts`: default current clinic month → today (injected clinic clock); 367 days and to-before-from give translated messages and no request.
- `report-money.test.ts`: exponent 2 and 3, negative net with minus, Arabic-Indic digits, 16+ digit minor strings exact.
- `daily-takings-page.test.tsx`: real mock data; totals in/out/net equal BigInt sum of rows; rows grouped per period; empty state; error + retry; `report_range_too_long` from the API shown translated; direct URL without key → forbidden.
- `period-summary-page.test.tsx`: all seven totals equal row sums; help line present; groupBy switch refetches.
- `report-export-dialog.test.tsx`: export button opens the form prefilled; submit sends one POST with report + filters; a 400-day range accepted for export.
- `route` test: unknown reportId → not found.
- Mutation proofs: break a totals column, drop the covering-permission check, remove the range pre-check — each must fail a test.

## Fit with contract/API/mock

- No contract/API/mock change needed: R1/R2 queries, responses with `currency` + `currencyExponent`, `branchOptions(report)`, and `reportPermissionScope` all exist; the mock already returns R1/R2/R9 for a receptionist.
- `useClinicMoney` formats with the clinic settings' currency and Latin digits; the spec asks for the response's currency and Arabic-Indic digits, so report screens use the new pure `report-money.ts` over the same `formatMinor` instead of changing the shared hook.
- Branch options: reusing `useExportBranchOptions` (same per-report endpoint) rather than writing a second loader.

## Open questions

1. Report cards for R3–R10 before their screens exist: hide them (my default) or show them disabled?
2. Export from a screen with a range under 366 days only, or allow widening to 1096 inside the dialog (my default: allow, the form validates)?
3. Print: browser print of the current page (my default) — no PDF.

## Acceptance

typecheck, lint 0 errors, tests, node-server build (sandbox engine mismatch will be reported, no bypass), files under 300 lines, logical CSS only, every string in ar + en, Arabic/English at 1440px and 390px for admin, doctor and technician (clinic personas in the preview remain a known limit from last round).
