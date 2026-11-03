# Card 6 of 7 — R7 «المستردات» (Refunds) + R8 «الخصومات» (Discounts)

UI only, under `apps/web/src/report-exports/screens/`. No contract, API, worker, SQL or mock-rule change.

## Contract fit (checked)

- Queries `reportRefundQuerySchema` / `reportDiscountQuerySchema`: `reportFields` (from, to, optional branchId) + `cursorFields`, 366-day cap, no groupBy.
- Responses `reportRefundResponseSchema` / `reportDiscountResponseSchema`: items, nextCursor (nullable), total, currency, currencyExponent. `api.reports.refunds` / `api.reports.discounts` and the mock already exist.
- Access (`finance-report-access.ts`): refunds = report_patients + covering payments; discounts = report_patients + covering invoices; both at clinic or branch scope.
- Differences from the brief (none blocking):
  1. `reason` is `text(300)`, **not nullable** on both rows. «—» covers an empty or whitespace-only string.
  2. `refundedByName` is nullable (the membership is gone), while `refundedBy` (id) is required. Only the name is shown.
  3. `discountedBy` and `discountedByName` are both nullable. Only the name is shown.
  4. R7 rows have `refundId` but the brief gives no refund page link, so the refund number is plain text. `refundId` never reaches the DOM.
  5. Neither report is in `NO_BRANCH_REPORTS`, so the branch picker and the export form's branch field show without any shared change.

## Files

| File | Est. lines | Content |
|---|---|---|
| `use-refunds-pages.ts` | ~30 | thin wrapper over `useReportPages("refunds", …)`, filters `{from,to,branchId?}` |
| `use-discounts-pages.ts` | ~30 | same for `"discounts"` |
| `reason-text.tsx` | ~55 | plain text node; truncated view collapses `\s+` to one space and clamps it; a toggle button with `aria-expanded` / `aria-controls` shows the full text (`whitespace-pre-line`); empty → `financeReports.common.dash`; no HTML |
| `refunds-columns.tsx` | ~75 | refund no., day, branch, «المراجع» name, method (existing payment-method label keys), source label (text + icon, not colour alone), amount, refunded by / «—», reason |
| `discounts-columns.tsx` | ~80 | invoice no. (`<Link to="/clinic/invoices/$invoiceId">` only when `can(perms,"view","invoices")`, like R5), day, branch, name, kind label, discount, set by / «—», reason |
| `adjustment-pages-footer.tsx` | ~55 | shared «عرض X من Y», print note, load more, per-page retry. Taken out of the R6 body pattern; R5/R6 stay as they are |
| `refunds-report-body.tsx` | ~45 | ReportTable + footer; `rowKey` = row index; total `amount` only when `!hasMore` (BigInt `sumMinor`) |
| `discounts-report-body.tsx` | ~45 | same, total `discount` |
| `refunds-report-page.tsx` | ~40 | frame like the R6 page: filters with branch, shell, content (default period empty wording), export prefill, print |
| `discounts-report-page.tsx` | ~40 | same |
| `report-catalogue.ts` | +2 | add `refunds`, `discounts` to `SCREEN_REPORTS` |
| `report-screen-page.tsx` | +4 | dispatch both reports (keyed by memberId) |
| `available-reports.tsx` | +0–4 | only if card descriptions are keyed per report |
| `ar-finance-reports.ts` / `en-finance-reports.ts` | 153 → ~185 each | names, descriptions, columns, `source.payment/credit` («من إيصال»/«من الرصيد»; "From receipt"/"From credit"), `kind.line/invoice` («على بند»/«على الفاتورة»; "Line"/"Invoice"), `reason.more/less`, dash. If either goes past 280 lines, split into `*-finance-reports-adjustments.ts` and compose it at the root |

The existing R5 «عرض/تحميل المزيد» keys (`financeReports.outstanding.*`) are reused, as R6 already does. No new duplicates.

## Tests (each file under 300 lines; synthetic ids and names such as `branch-test-a`, «مراجع تجريبي ١»)

- `adjustment-reports.test-kit.tsx` (~120): seeds refunds/discounts through the real mock API (as the R6 kit does), persona builders and render helper. Only helpers, no components besides the wrapper.
- `refunds-report.test.tsx` (~230): route `/clinic/reports/refunds`; columns; source labels ar + en; method label; «—» for null `refundedByName`; reason `<b>x</b>` renders as text with no `b` element; truncation + expand (`aria-expanded` toggles, keyboard Enter); load more appends exactly page 2 and shows `total`; filter change restarts and a late old-filter page is ignored; load-more error keeps page 1 and retries only that cursor; a total only when complete, equal to the BigInt sum with values above 2^53; branch picker shown and `branchId` sent; empty/error/forbidden; no patientId or refundId in `document.body.innerHTML`.
- `discounts-report.test.tsx` (~230): the same set for R8, plus kind labels ar + en, «—» for null `discountedByName`, invoice link only with `view:invoices` (and its href holds only the invoice id), no patientId.
- `adjustment-access.test.tsx` (~120): report_patients + view:payments → R7 card + route, not R8; report_patients + view:invoices → R8, not R7; branch scope opens both; no covering key → neither; report_own, report_takings and report_analytics only → never. R10 card stays hidden.
- `report-screens.test.tsx`: the "unbuilt report is not found" example changes from `refunds` to `own_summary` (R10), because R7 is now built. Only that line changes.
- `report-catalogue.test.ts`: update the built-screens list if it asserts it.

## Mutation proofs (each must fail a test, then the source is restored byte for byte)

1. Covering key: change the refunds `covering` check out of the screen path. Because the rule lives in contracts, which are not editable, the mutation is in `canOpenReport` (ignore covering by checking only the report key). It must fail R7 and R8 access tests. Also, temporarily drop `view:invoices` gating in the R8 link column.
2. Totals only when complete: remove the `hasMore` condition in both bodies, and a test must fail.
3. Late-page guard in `use-report-pages.ts`: R7/R8 tests fail, and the R5/R6 tests are confirmed failing too.

## Acceptance

Typecheck, lint (0 errors), changed-area tests, and the full suite once at the end. Every file stays under 300 lines with one component per file, logical CSS, ar + en strings, «المراجع». R1–R6 and R9 behaviour does not change. The export form is not changed. pnpm build: if the Node/pnpm mismatch blocks it, this is reported without a bypass. Clinic-persona browser check at 1440/390 will likely stay unverified (platform-admin preview).

## Open question

- Kind labels: «على بند / على الفاتورة» ("Line" / "Invoice") are proposed wording. Confirm or give the exact copy.
