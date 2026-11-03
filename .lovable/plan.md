# Card 4 — R5 «المبالغ المستحقة» (Outstanding balances)

Web only (`apps/web/src/report-exports/screens` + i18n + tests). No contract, API, worker, SQL or mock-rule change is needed.

## Contract fit (confirmed by reading)

- `reportOutstandingQuerySchema` = report fields + `cursorFields` (`cursor` opaque `^[A-Za-z0-9_-]{1,64}$`, `limit` 1–100, default 50), range max 366, no groupBy. We send `limit: 50` explicitly.
- Response rows/summary/total/currency/exponent exactly as the brief lists; `api.reports.outstanding` exists in `ReportsApi`.
- Access: `outstanding` = `report_patients` + covering `invoices`, scopes clinic/branch — read through the existing `canOpenReport` (`reportPermissionScope`).
- Invoice link: the invoices list links with `<Link to="/clinic/invoices/$invoiceId">` and the invoices area gates on `can(perms, "view", "invoices")`. R5 already needs covering `view:invoices` at the report scope and rows are inside reach, so the link shows when `can(perms,"view","invoices")` holds (kept as an explicit check, plain text otherwise).
- Patient: only `patientName` rendered as plain text. `patientId` is never rendered, linked or put in a test id (no patient-file link: not required, keeps the screen minimal).
- One spec gap, no change requested: `summary` rows are per (bucket, branch) for the whole result, not for the loaded pages. Cards therefore show the response summary (whole range); the "cards vs table" test asserts equality on a fixture that fits one page, and on a multi-page fixture asserts cards = summary of the whole set while the table shows the loaded subset with «عرض X من Y».

## Files

| File | Est. lines | Content |
| --- | --- | --- |
| `screens/use-outstanding-pages.ts` (new) | ~130 | Cursor pager over `useApi()`. Scope key = actor + membership + sorted permissions + reach + parsed filters (same inputs as `use-report-query.ts`). Pages held in state tagged with that key; a filter/access change resets to page 1 and drops pages. Every fetch carries a generation from `useCommittedEpoch`; a late page whose key/generation is not current is ignored. `loadMore()` locks against double-fire; an error on page n>1 keeps pages 1..n-1 and exposes `retryMore()` for that cursor only; first-page error exposes `retry()`. No automatic retry. Returns `{ rows, total, summary, currency, exponent, status, moreError, hasMore }` computed from the render's state (no render-time ref writes). |
| `screens/outstanding-summary.ts` (new) | ~60 | Pure: `bucketTotals(summary)` and `bucketTotalsByBranch(summary)` with BigInt sums over minor strings; all four buckets always present (0 / "0"); `rowBucketTotals(rows)` for tests and print note. |
| `screens/outstanding-summary-cards.tsx` (new) | ~90 | Four bucket cards (count + owed). When no branch filter: a per-branch group under each, names from loaded branch options, else from row `branchName`, else the i18n "unknown branch" label — never invented. |
| `screens/age-bucket-badge.tsx` (new) | ~30 | Text label + tone token (icon + tint), not colour alone. |
| `screens/outstanding-columns.tsx` (new) | ~80 | Columns: invoice number (Link or text, `dir="ltr"`), branch, issue day, المراجع, total, paid, owed, age badge. Mobile cards via existing `report-table` labelled layout. |
| `screens/outstanding-report-page.tsx` (new) | ~110 | Frame: `useReportFilters` (no groupBy, branch fallback + suspended query while a chosen branch is checked), `ReportShell` (export prefill, print), states loading/empty/error/forbidden, cards then table, «عرض X من Y», «تحميل المزيد» / per-page retry, print note "printing the N rows loaded so far". |
| `screens/report-catalogue.ts` | +1 | Add `outstanding` to `SCREEN_REPORTS`. |
| `screens/report-screen-page.tsx` | +3 | Dispatch `outstanding`. |
| `screens/report-shell.tsx` | +2 if needed | R5 subtitle key only. |
| `shared/i18n/{ar,en}-finance-reports*.ts` | ~+35 each | Title, description, buckets, columns, load more, showing X of Y, retry page, print note, unknown branch, dash. If `ar/en-finance-reports.ts` pass 280 lines, move R5 keys to `{ar,en}-finance-reports-outstanding.ts` spread back. |

Route: existing `clinic.reports.$reportId.tsx` covers `/clinic/reports/outstanding`; no new route file.

## Tests (all synthetic, deterministic ids/names like "Test Patient A")

- `screens/outstanding-summary.test.ts` (~70): BigInt sums with values > 2^53; empty bucket = 0; per-branch grouping.
- `screens/outstanding-report.test-kit.tsx` (~80, one helper component): real mock root, fixture with invoices across all four buckets on two branches (controlled clock), personas by permission strings.
- `screens/outstanding-report.test.tsx` (~220): cards equal table BigInt sums and the response summary (one-page fixture); load more appends exactly page 2 and shows total; filter change resets to page 1 and a late page of the old filter (deferred adapter promise) is ignored; load-more error keeps page 1 and retries only page 2; empty/error/forbidden; only the name of the patient is rendered (no patientId text, no phone/civil id, no patient link); invoice number link present with `view:invoices`.
- `screens/outstanding-access.test.tsx` (~110): `report_patients` + `view:invoices` opens R5 and card shows; without `view:invoices` not; `report_own` never; only `report_takings` not; route `/clinic/reports/outstanding` renders and forbidden variant; R6–R8, R10 cards stay hidden.
- Update `report-catalogue.test.ts` / `report-screens.test.tsx` expected card lists only where a persona now gains R5.

## Mutation proofs (each must fail a test, then restore byte-for-byte)

1. Bucket sum (e.g. drop one addend / use Number) in `outstanding-summary.ts`.
2. Remove covering `view:invoices` from the R5 gate (simulate by bypassing `canOpenReport` for outstanding).
3. Remove the late-page key/generation guard in `use-outstanding-pages.ts`.

## Acceptance

Typecheck, lint 0 errors, report-exports area tests, every file < 300 lines, one component per file (test kit included), full suite at most once at the end. Build: report the Node 22 / pnpm mismatch honestly, no bypass. Clinic-persona real-browser check at 1440/390 likely unverifiable in this preview (platform-admin only); will say so.
