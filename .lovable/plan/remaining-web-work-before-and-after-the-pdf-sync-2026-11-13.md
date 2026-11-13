# Remaining web work before and after the PDF sync

Base: `lovable` = `main` = `53d48725` (PR #179). Not touched: `shared/api/api-provider.tsx`, `shared/api/api-client-provider.tsx` (PR #180), and the PDF-held files: `invoices/invoice-page*`, `invoices/invoice-pdf-*`, `payments/receipt-details*`, `payments/receipt-pdf-*`, `shared/pdf/*`, and the PDF keys in the finance and payments i18n files.

## Card 2c — the last lint warning

- Warning: `shared/i18n/i18n-provider.tsx:87` (`react-refresh/only-export-components`). The file exports both `I18nProvider` and the `useI18n` hook.
- Fix, same pattern as persona in #179: move `I18nProvider` into a new `shared/i18n/i18n-language-provider.tsx`. `i18n-provider.tsx` then holds only the context and `useI18n`, so the roughly 200 hook imports stay as they are.
- Files that import `I18nProvider` and need a one-line import change: 73 in total. That is `routes/__root.tsx`, `shared/persona/persona-test-kit.tsx`, 2 report test kits, and 69 test files across appointments, audit, cash-closings, invoices, patients, payments, platform, report-exports, roles, schedules, services, settings, shared/messages, shared/shell, users and visits.
- **2 of them are PDF-held**: `invoices/invoice-page.test.tsx` and `payments/receipt-details.test.tsx`. So Card 2c **waits for the PDF sync**. The other option is to move the hook instead, but that touches `invoice-page.tsx` and `receipt-details.tsx`, which are held too.
- Tests that mock the i18n module by path: none found. After the change, I run the affected test files as focused runs.

## Card 1 — finance accessibility and print, what is left

Already in #179: refund reason and closing note open by tap or keyboard and print in full; the mobile menu button is 44×44; the report «المزيد» button; contrast on 5 finance pages (ar/en, 1440/390); keyboard and print on the daily takings report.

Checks for every screen: Arabic and English, 1440px and 390px, Tab order with a visible focus frame and a name on every control, dialogs that trap focus and return it, status shown with icon and label, print output (one report title and notice, no app chrome, the table not cut across pages), and no horizontal page scroll at 390px.

### (a) Free now
- Payments lists: `payments/payments-content.tsx`, `receipts-content.tsx`, `refunds-content.tsx`, `use-receipt-columns.tsx`, `use-refund-columns.tsx`, `receipt-patient-picker.tsx`, `receipt-toast-link.tsx`.
- Payment dialogs: `record-payment-dialog.tsx`, `refund-form.tsx`, `apply-credit-dialog.tsx` (keyboard, labels, error announcement).
- Invoice list and create/edit: `invoices/invoices-content.tsx`, `use-invoice-columns.tsx`, `new-invoice-page.tsx`, `invoice-form.tsx`, `invoice-line-row.tsx`, `invoice-discount-fields.tsx`, `invoice-totals-panel.tsx`, `invoice-patient-picker.tsx`, `invoice-void-dialog.tsx`, `invoice-status-badge.tsx`, `invoice-settlement-chip.tsx`.
- Cash closings: `cash-closings/closings-content.tsx`, `close-dialog.tsx`, `closing-details.tsx`, `closing-movements.tsx`, `closing-method-totals.tsx`, `closing-difference.tsx`, `use-closing-columns.tsx`.
- Reports R2–R10 (keyboard, contrast, print over several pages): `report-exports/screens/*` pages and bodies, `report-table.tsx`, `report-shell.tsx`, `report-filters-bar.tsx`, `report-branch-picker.tsx`, `report-export-dialog.tsx`, plus `reports-page.tsx` and `export-history*.tsx`.
- Finance navigation and settings: `shared/shell/finance-tabs-nav.tsx`, `settings/finance-settings-page.tsx`, `payment-methods-card.tsx`, `invoice-prefixes-card.tsx`.
- To see refund reasons and closing notes on screen, I record a refund and close a drawer in the preview as «مدير العيادة», through the normal screens. The demo seed data does not change.

### (b) Waits for the PDF sync
- `invoices/invoice-page.tsx` (invoice details and print), `payments/receipt-details.tsx`, and their tests.
- The PDF buttons `invoice-pdf-action.tsx` and `receipt-pdf-action.tsx`: review their keyboard behaviour and labels only, no rebuild.
- `payments/invoice-payment-panel.tsx` and `invoice-movements.tsx`: the files are free, but they render inside the invoice page. I check them on screen after the sync. Code fixes can land now only if they are self-contained.
- Card 2c (above).

## 3. Other unblocked web work (suggestions, needs your yes)
- **Full test suite, once**, split by folder to stay under the 300-second tool limit. The last full run never finished, so its result is still unknown. Worth doing first.
- **Review-lessons checklist sweep** on the #179 diff (labels, i18n ar/en parity, the 300-line limit). This is read-only, and I fix only real findings.
- **i18n parity test**: one test that fails if an ar key has no en key, or the other way round, if none exists yet. Test-only. It checks the PDF keys too but does not edit them.
- Nothing else found that is unblocked and worth doing. Everything else is with you (staging, Node 24 / pnpm 12.5.1 gates, production).

## Order after «execute»
1. Split full-suite run, then fix only regressions.
2. Card 1 (a), one screen group per commit, focused tests per group.
3. After you confirm the PDF sync: Card 1 (b), then Card 2c, then focused tests.

## Technical notes
- apps/web only. The mock adapter stays. No change to contracts, API, SQL, permissions or money math. No new libraries. Files stay ≤300 lines with one component each. Logical CSS only. Every new string is an i18n key in ar and en. Arabic copy uses «المراجع».
- Every fix gets a test that fails without it.
- Engine mismatch (Node 22 / pnpm 11) is reported, never bypassed.
