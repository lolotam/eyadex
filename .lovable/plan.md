# Card 5 of 7 — R6 «أرصدة المراجعين» (Patient credit)

Web only: screens, hooks over `useApi()`, i18n, tests. No change to contracts, API, worker, SQL or mock rules.

## What I checked, and how it fits

- Access: `reportPermissionScope` lists `patient_credit` as `report_patients`, covering `["payments"]`, scopes `["clinic"]`. `canOpenReport` already enforces this, so a branch-scoped holder gets `null`. The catalogue needs no new permission code; I only add `patient_credit` to `SCREEN_REPORTS`.
- Query: `reportPatientCreditQuerySchema` = `reportFields` + `cursorFields`, with the 366-day check. It has no groupBy. `branchId` is optional, so leaving it out is valid.
- Response: `items` (patientId, patientName, balanceMinor, oldestCreditDay, currency), `nextCursor`, `total`, `currency`, `currencyExponent`. It has no summary. `api.reports.patientCredit` exists.
- Patient link: the patients UI links with `/clinic/patients/$patientId`, gated on `can(view, patients)` (see `visits/visit-content.tsx`). A link would put `patientId` in an `href`, and your extra rule forbids that. **The name stays plain text for everyone.** This is my reading of the two rules together; tell me if you want the link instead.
- Default dates: `SCREEN_DEFAULT_DAYS` only lists `outstanding`, so R6 keeps the frame's current clinic month, as you asked.
- Contract fit: no gaps found.

## Part 1 — shared cursor pager (refactor, behaviour unchanged)

`use-outstanding-pages.ts` (150 lines) is hard-wired to R5: the type, the `api.reports.outstanding` call and `canOpenReport(…, "outstanding")`. Copying it would put about 150 lines of race-sensitive code in two places. So:

- **new `use-report-pages.ts` (~140)**: a generic `useReportPages<Row, Page>(report, fetchPage, filters)`. It has exactly the current discipline:
  - the scope key is actor + membership + sorted permissions + reach + parsed filters (the filters are serialised generically, with `branchId ?? null`);
  - the `useCommittedEpoch` generation;
  - the first page replaces the list, and a page is appended only for the expected cursor;
  - an empty cursor counts as no cursor;
  - the load-more lock is held by a ref read only in handlers and effects;
  - a per-page retry keeps earlier pages;
  - every returned value comes from that render's state.
  
  It returns `pages`, `rows`, `total`, `first`, `currency`, `exponent` and the same flags and handlers as today.
- **`use-outstanding-pages.ts` (~150 → ~40)**: becomes a thin wrapper. It adds `summary` from the first page. Its public shape is unchanged, so the R5 files and tests are not touched.
- **new `use-patient-credit-pages.ts` (~35)**: a wrapper over `api.reports.patientCredit` for `"patient_credit"`. It also removes `branchId` from the filters before the key and the request, so `branchId` can never be sent even if the filters carry one.

Fallback, if you would rather not touch reviewed R5 code: a separate R6 hook copied from the R5 hook (~150 lines). Say which you prefer; I will build the shared pager unless you say otherwise.

## Part 2 — the R6 screen

- **`report-catalogue.ts` (+8)**: add `"patient_credit"` to `SCREEN_REPORTS`. Add `SCREEN_NO_BRANCH: ReadonlySet<ScreenReportId> = new Set(["patient_credit"])` and `SCREEN_CLINIC_WIDE_NOTICE` (the same set, used by the shell and the export button). R7, R8 and R10 stay hidden.
- **`report-filters-bar.tsx` (+6)**: when the report is in `SCREEN_NO_BRANCH`, the bar renders no branch picker and no branch-load error, and does not call `useExportBranchOptions` for it. To keep hook order fixed, the picker moves into a small child component. From/To stay visible.
- **new `report-branch-picker.tsx` (~60)**: the existing picker and its error row, moved out of the bar unchanged, so the bar only mounts it when the report has a branch filter.
- **`use-report-filters.ts` (+4)**: for reports without a branch filter, `branchId` is forced to `null` and never waits on branch checking, so there is no loading state while a branch is checked.
- **new `clinic-wide-notice.tsx` (~25)**: a prominent notice: icon + text, with a tinted token surface and `role="note"`. It reads ar «الرصيد الحالي للعيادة كلها؛ الفترة المختارة لا تحدّ هذا التقرير» / en "Current clinic-wide balance; the selected period does not limit this report." It has a `variant` (`banner` | `inline`).
- **`report-shell.tsx` (+4)**: for reports in `SCREEN_CLINIC_WIDE_NOTICE`, it renders `<ClinicWideNotice variant="inline">` next to the export button and `<ClinicWideNotice variant="banner">` above the content. Other reports are unchanged.
- **new `patient-credit-columns.tsx` (~50)**: columns for the المراجع name (plain text), the balance (response currency through the shared formatter) and the oldest credit day (clinic-day formatter, localized digits). The 390px card labels come from the same i18n keys. Row keys use the row index plus the page index, never `patientId`.
- **new `patient-credit-totals.ts` (~20)**: `sumBalances(rows): string`, a BigInt sum over minor strings that never uses `Number()`.
- **new `patient-credit-report-body.tsx` (~80)**: follows `outstanding-report-body.tsx`:
  - the table and its 390px cards;
  - a totals row only when `!hasMore` (every page is loaded), equal to `sumBalances` of the shown rows; otherwise no «Total»;
  - the «عرض X من Y» line, «تحميل المزيد», and an inline retry for a failed later page;
  - a print note about the rows loaded so far.
  
  There are no summary cards, because the response has none.
- **new `patient-credit-report-page.tsx` (~45)**: follows `outstanding-report-page.tsx`, with `useReportFilters("patient_credit", reportPatientCreditQuerySchema)`. It strips the cursor and limit and passes the filters to `usePatientCreditPages`.
- **`report-screen-page.tsx` (+2)**: maps `patient_credit` to the page. The route `/clinic/reports/$reportId` already exists, so no new route file is needed. I will confirm this when I build.
- **`available-reports.tsx`**: no change. The R6 card shows through `availableScreens`.
- **i18n**: about 12 new keys each: title, subtitle, help, notice, columns, total, the print note and an empty state. `ar-finance-reports.ts` and `en-finance-reports.ts` would go from 141 to ~155 lines, under 280, so no split. The Arabic says «المراجع», never «المريض».

## Tests (deterministic synthetic ids and names, e.g. `patient-0001`, «مراجع تجريبي ١»)

New `patient-credit-report.test.tsx` (~200) plus `patient-credit-access.test.tsx` (~80). Shared fixtures go in `patient-credit-report.fixtures.ts` (~60, no component).

1. The notice shows in ar and en, above the list and next to the export button: two `role="note"` elements with the exact text.
2. The branch picker is hidden for R6 and still shown for R1, R2, R3, R4, R5 and R9 (a table test in `report-catalogue.test.ts` and a render test).
3. `branchId` is never sent: a spy on `api.reports.patientCredit` checks every call's query, including a run where the filters arrive with a branch.
4. Load more appends exactly the next page (the row count and order) and shows «عرض X من Y» with `total`.
5. A filter change (From) restarts at page 1. A late old-filter page, resolved through a deferred promise, is ignored.
6. An error on load more keeps the earlier pages, and retry re-requests only that cursor.
7. Totals: no «Total» while `hasMore`. Once complete, the totals row equals the BigInt sum, using values above 2^53 (e.g. `"9007199254740993"` + `"9007199254740995"`).
8. Permission split:
   - `view:report_patients:clinic` + `view:payments:clinic` opens R6;
   - `report_patients:branch` (+ payments) does not;
   - without `view:payments` it does not;
   - a role with only `report_own` does not;
   - a role with only `report_takings` does not.
   
   This is checked on the card list and on the route (forbidden page).
9. The route `/clinic/reports/patient_credit` renders the R6 page.
10. Empty, error-with-retry and forbidden states.
11. No patient data except the name: the synthetic `patientId` value does not appear in `document.body.innerHTML` (text, attributes or hrefs), and the name has no anchor.
12. The existing R5 tests stay green unchanged, which shows the pager refactor keeps R5's behaviour.

Mutation proofs (each must fail a test, then the source is restored byte for byte):
- the clinic-scope rule: allow `branch` for R6 by bypassing the catalogue check in the R6 hook or page (the contract file is not edited);
- totals only when complete: render the totals row while `hasMore`;
- the late-page guard: remove the `old.key !== forKey` / `isCurrent` check in `use-report-pages.ts`.

## Acceptance

- Typecheck, lint (0 errors), and tests for the changed area (`report-exports/`).
- The full suite runs once, at the end.
- Every file under 300 lines and one component per file. Logical CSS only. Every string in ar and en, including placeholders and dashes.
- If `pnpm` gates still fail on the sandbox Node 22 / pnpm 11 mismatch, I will report it and not bypass it.
- The clinic-persona browser check at 1440 and 390 will stay unverified if the preview only offers the platform admin.

## Open questions

1. Is the shared pager refactor in Part 1 acceptable, or do you want a separate R6 hook?
2. Should the patient name stay plain text even for viewers with `view:patients`? This plan keeps it plain text, per the no-patientId-in-DOM rule.
