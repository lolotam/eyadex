# F2 web, card 1 of 2: payments, credit and receipts

Spec: finance-design §4.3, §4.4, §4.6, §4.7, §4.8, §4.10, §8d. Web only (`apps/web`). Frozen: `packages/*`, `apps/api`, `apps/worker`, `db/`, `docs/`, `components/ui`.

## Size and proposed split
Estimate with tests: about 4,500–5,500 changed lines (mock about 1,300, tests about 2,000, screens about 1,500). That is over the 3,000 target, so I propose two PRs, done in this order:

- **1a (about 3,000 lines):** sections 0, 1, 2, 3, 5, 6, 7 below. That covers error keys, audit labels, the client and both adapters, the whole mock (payments, credit, releases, settlement, method switches, seed), the invoice payment panel and its dialogs, the void/edit warnings, the list's settlement column and filter, and the payment-methods card.
- **1b (about 1,800 lines):** section 4. That covers the «المدفوعات» tab strip, the nav item change, `/clinic/payments` (receipts list) and `/clinic/receipts/$paymentId`. The success toast in 1a shows the receipt number as plain text, and 1b turns it into a link.

Confirm the split, or tell me to keep it as one PR.

## 0. Existing parts
- Role matrix: add only `roles/permission-matrix-finance-f2.test.tsx`, which checks that the three rows «المدفوعات» / «الاسترداد» / «إقفال الصندوق» show (ar and en).
- `shared/i18n/ar.ts` (272 lines) and `en.ts` (278 lines): add the 9 §7 codes under `errors`. Both stay under 300 lines.
- `ar-audit.ts` / `en-audit.ts`: add the 10 `fields` and 6 `values` from the brief.
- `audit/audit-format.ts`: add `formatPaymentMethods` and `formatSpends`, chosen by field name before `one()`. A new `audit-format-finance.ts` holds them if the file grows. `audit-format.test.ts` keeps its two-way contract check, and `FINANCE_ONLY_LABELS` stays as it is.

## 1. API client
- `shared/api/payments-client.ts` (`PaymentsApi`): `invoicePayments`, `recordPayment`, `applyCredit`, `listPayments`, `getPayment`. It is mounted as `payments` on `ApiClient`.
- `finance-client.ts`: add `setPaymentMethods`. The `listInvoices` query type takes `settlement`.
- `shared/api/http/http-payments.ts`: parses every answer with its schema and sends `Idempotency-Key` through the transport option. `http-finance.ts` gets the PUT. `http/__tests__/payment-routes.test.ts` checks method, path, header, body and schema.
- `payments/use-idempotency-key.ts`: makes a new UUID on dialog open, keeps it for a retry with the same `{method, amountMinor, reference}` fingerprint, and makes a new one when the fingerprint changes.

## 2. Invoice payment panel (new area `apps/web/src/payments/`)
- `invoice-page.tsx`: add only a `paymentPanel` slot prop, filled by `routes/clinic.invoices.$invoiceId.tsx` (ADR-0030). `invoices/` and `payments/` never import each other.
- `invoice-settlement-summary.tsx`: total, paid, balance due and `settlement-chip.tsx`, for any `view:invoices` scope. Nothing shows when `settlement` is null.
- `invoice-movements.tsx`: shown only when `canAtBranch("view","payments",invoice.branchId)`. Otherwise the query is disabled, so no request is sent. Movements oldest first, with patient credit shown when it is above 0.
- `record-payment-dialog.tsx` and `apply-credit-dialog.tsx`: react-hook-form with Zod. Only enabled methods are offered (absent means on). The amount is prefilled in major units through `formatMinor` and parsed with `parseMajorToMinor`. A check before sending compares the amount with `owedMinor` (and with credit, in the credit dialog) using `readMinor` bigint. Error codes map to i18n keys inline. On success: a toast with the receipt number, then the invoice and movement queries are invalidated.
- Buttons are gated on `canAtBranch("create","payments",branchId)`, the invoice being issued and `owedMinor > 0`. The credit button also needs credit above 0.
- `invoices/`: the void confirm and the edit save step show the "becomes patient credit" warning when `paidMinor > 0`, or when the new total is below `paidMinor`. This is computed in `invoices/invoice-release-warning.ts`, which does not import `payments/`.

## 3. Invoices list
- A settlement column with its own chip copy in `invoices/` (a separate component, because the areas do not import each other).
- A settlement filter in the URL search (`settlement`), validated in the route's search schema, and passed to `listInvoices`.

## 4. Receipts (card 1b)
- `shared/shell/finance-tabs.tsx`: a link strip gated by `can()`. In `nav-items.ts`, the invoices item shows with `view:invoices` or `view:payments` and lands on the first tab the user can see.
- Two thin routes: `clinic.payments.tsx` and `clinic.receipts.$paymentId.tsx`. The pages are `payments/receipts-page.tsx`, `receipts-content.tsx`, `use-receipt-columns.tsx`, `receipt-filters.tsx` and `receipt-page.tsx`.
- Branch options come from the `view:payments` reach. The receipt number search is debounced by 300 ms. The invoice number is a link only with `canAtBranch("view","invoices",…)`. No PDF and no print.

## 5. Payment methods card
- `settings/payment-methods-card.tsx`, placed on the finance tab beside the prefixes card. It has four switches in the fixed order. It is editable with `update:clinic_settings:clinic` and read-only otherwise. The last switch that is on is disabled. One save sends all four. The form starts once per load, using a ref so a refetch never resets it.

## 6. Mock (`shared/api/mock/`, each file 300 lines or less)
- `mock-payment-state.ts`: payments, allocations, credits, receipt sequences per (branch, clinic-tz year), cash drawer sequence per branch, method switches.
- `mock-payment-access.ts`: guards in this order: `subscription_blocked` → `module_disabled` → `forbidden` → body `validation` → key `validation` → idempotency → `not_found` (unknown invoice or a branch out of reach).
- `mock-payment-writes.ts`: record payment (`payment_method_disabled` → `invoice_void` → `invoice_settled` → `payment_exceeds_balance` via `planPayment` → `invoice_prefix_missing`). It sets the receipt number `PREFIX-R-YYYY-NNNNNN`, `cashSeq` for cash only, `businessDate` in the clinic timezone, and one allocation. It writes the `payment.recorded` row.
- `mock-credit-writes.ts`: apply credit via `planCreditApplication` (`invoice_void` → `invoice_settled` → `payment_exceeds_balance` → `credit_insufficient`), spending credits oldest first. It writes the `credit.applied` row.
- `mock-payment-replay.ts`: the fingerprint is the operation, `invoiceId` and the whole body. A replay returns the first answer and takes no new number. It answers `not_found` once the receipt's branch is out of reach, and `idempotency_conflict` when the fingerprint differs.
- `mock-invoice-releases.ts`: `planEditRelease` and `planVoidRelease` turn released amounts into credits and write `credit.released` rows, in the order of `changes.ts`. `mock-invoice-writes.ts` (293 lines) calls it with one line in edit and one in void.
- `mock-settlement.ts`: `settlementOf(invoice)` calls `invoiceSettlement` and returns null when the invoice is void. It is attached in detail, list, issue, edit and void, and used by the list filter.
- `mock-payment-reads.ts`: invoice movements (`paymentRefundable`), the receipt list (cursor pages, filters) and receipt detail. Names come without an audit row.
- `mock-finance-settings.ts`: methods are read as all four. The PUT needs `update:clinic_settings:clinic`, refuses `payment_methods_empty`, and writes one `payment_methods.changed` row.
- `mock-finance-audit.ts`: payment and credit snapshots are passed as `exact: true` and checked with `assertFinanceAuditSnapshotShape`.
- `mock-payment-seed.ts`: per seeded branch, a few payments, one credit and one partly paid invoice, all built through the functions above.
- The adapter mounts `payments`.

## 7. Error copy
The 9 codes with the brief's exact ar and en text, shown inline in the dialogs and the card.

## 8. Tests (each shown once to fail when its source is reverted)
- `payments/settlement-examples.test.ts`: S1, S2, S3, S4, S5, S6, S9 and S11 as one table, with a conservation check after each step.
- `payments/payment-refusal-order.test.ts`: one test per adjacent pair of steps.
- `payments/payment-idempotency.test.ts`: replay, conflict on another invoice or body, replay `not_found` after the branch leaves the caller's reach.
- `payments/receipt-numbers.test.ts`: gap-free per branch and per year, `cashSeq` for cash only, the business day across midnight UTC.
- `payments/payment-amounts.test.ts`: KWD and SAR round trips, and the chip from the shared function.
- `payments/payment-panel.test.tsx`: the doctor `own` case (settlement shown, no movements request), `create:payments` without `view:invoices`, `view:payments:branch` of another branch, prefill, and the check before sending.
- `payments/payment-audit.test.ts`: each row, no row on a refused write, the scrub exemption (a 7-digit amount stays whole).
- `settings/payment-methods-card.test.tsx`: the last switch, read-only mode, no reset on refetch.
- Audit formatter tests in ar and en.
- In 1b, receipts list and page tests: reach, filters, no `patient_access` row, loading, empty and retry states.
- Gates: web typecheck, lint, tests with exact counts, `NITRO_PRESET=node-server pnpm build:all`, Prettier on touched files, no lockfile change, Playwright in ar and en at 1440px and 390px. Then I tick the review-lessons checklist.

## Open questions
1. Is the 1a / 1b split above acceptable?
2. Should the void/edit release warning show for a user who cannot see payments? It is read from `invoice.settlement`, which every `view:invoices` holder already gets. My proposal is yes.
3. Should the cash drawer `cashSeq` sequence be per branch for all time, or reset each day? My proposal is to follow the API's drawer rule as read from `apps/api` billing before coding, and stop to ask if it is unclear.

Known issue, not fixed here: the typecheck error that was already there in `invoices/finance-mock-audit.test.ts` (it imports from `apps/api`) is reported, not fixed, unless you say so.
