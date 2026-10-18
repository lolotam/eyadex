# F1 follow-ups — web part

Scope: `apps/web` only. No edits to contracts, api, worker, db, docs or `components/ui`. Estimated around 2,400–3,000 changed lines, so I propose **two pushes**:
- **Push A:** items 1, 2, 3, 9, 10 (mock audit rows, the `shared/finance` move, the source button, clinic create replay, `prices.ts`).
- **Push B:** items 4, 5, 6, 7, 11, 12, and item 8 once it is decided.

## 1. Mock finance audit rows (first)
- Copy the API's actions and order: `invoice.issued` / `invoice.edited` / `invoice.voided` (entity `invoice`; the void row stores only `reasonLength`), `service.price_set` (`details.changed: ["priceMinor"]`), `service.provider_prices_set` (`details.providerCount`), `clinic.commercial_reg_no_set`, `clinic.logo_set`, `branch.invoice_prefix_set` (branch snapshot with `invoicePrefix` before/after). Each row is written inside the write, after validation and before the return.
- Add a mock `invoiceAuditSnapshot` that matches `apps/api/src/shared/finance-audit.ts` field for field (number, status, version, the minor totals, lineCount, discount snapshots).
- Scrub exemption: add an `exactSnapshot` path to `writeClinicAudit` that skips `scrubAuditValue` for invoice snapshots only. Typed names are still scrubbed.
- Check the `audit-format` / `ar-audit.ts` / `en-audit.ts` labels for each action and add any action label that is missing. Entity labels are not duplicated.
- Tests: one per write (fails without the row), one for the scrub exemption (a 7+ digit number stays intact), and one where a forbidden or invalid write leaves no row.

## 2 + 3. Move `shared/finance` into `invoices/` and fix the button
- Move `use-source-invoice-link`, the button and the menu item into `invoices/`. `appointment-actions.tsx` and `visit-content.tsx` get an `invoiceSlot` render prop. The route files (`clinic.appointments…`, `clinic.visits…`) compose it, following ADR-0030. Delete `shared/finance`. `area-boundaries.test.ts` is not changed.
- The lookup checks the appointment and each of its visits (`source` + `sourceId` queries), and the first issued invoice wins.
- Decision table:
  - view key that reaches the branch + an invoice exists: «عرض الفاتورة».
  - no view key, or the invoice is out of reach: no lookup at all. Show «فاتورة» (new flow) if `canAtBranch(create, invoices, record.branchId)`.
  - neither key: nothing.
- Tests: custom roles with create only, view only, and both. The out-of-branch case shows nothing.

## 4. New-invoice page
- Discount fields are gated by `canAtBranch(create, discounts, selectedBranch)`. On a branch change the discounts are cleared and checked again. The mock already rejects an out-of-reach discount; I will add a test that proves it.
- When the existing-invoice lookup fails, show a StatusPanel with a retry button instead of the form.
- `invoice-options.ts`: loop through the services cursor 100 at a time until `nextCursor` is null. Test with 150 seeded services.

## 5. Invoice PDF
`window.open("", "_blank")` runs synchronously inside the click. After the blob arrives the tab goes to the object URL, which is revoked after load or a timeout. If the popup is blocked, a hidden `<a download>` is clicked instead. The 503 inline message stays. Tests mock `window.open` and `URL.revokeObjectURL`.

## 6. Dialogs keep unsaved input
Service price, provider prices, invoice prefix dialog and the platform finance tab each seed the form once per open, using a ref keyed by open + record id + version. A refetch does not reset what was typed. The prefixes card gets an error panel with retry. Tests: a refetch after typing keeps the typed value, and a failed read shows retry.

## 7. Role editor
`viewScope` falls back to the widest available scope (clinic > branch > own). Add a test.

## 8. Services screen for price-only roles — needs your decision
`GET /v1/services` requires `view:services:clinic` (`appointments/http/services.controller.ts`). The API only offers `GET /v1/prices` (`view:prices:clinic`) to a price-only role. I have not yet confirmed that the prices answer carries service names. If it does not, the API cannot serve this screen, and per the brief I stop here. Options:
- (a) The orchestrator adds service names to `GET /v1/prices`, or lets price keys read `GET /v1/services`. Then I build the nav, the guard and the mock to match.
- (b) The web builds a prices-only view from `GET /v1/prices`, if that already carries names (I check this first in Push B).
I will not guess. Item 8 waits for your answer.

## 9. Mock clinic create
Add currency and taxRateBp to the `mock-clinic-replay.ts` fingerprint, so the same key with a different body is a conflict. Parse the body through the contract `parse()` before any state change, so a bad body gives `ApiError("validation")` and nothing is written. Two tests.

## 10. `prices.ts`
Remove the `!`. A missing `readPrices` result throws `ApiError("not_found")` explicitly. Add a test.

## 11. Invoice list debounce
A small `useDebouncedValue` hook (300 ms, timer cleared on unmount) for the number search and the patient picker. `placeholderData: keepPreviousData` keeps the previous rows while loading. Tests with fake timers check for no request before 300 ms, one after, and no timer after unmount. No patient names in the rows.

## 12. Patient name on the invoice page
`invoice-patient-name.tsx` takes `patientName` from the invoice detail and stops calling `patients.open`. The fallback label is «المراجع» / "Patient". The mock detail adds `patientName` only after the existing reach check, so an unreachable invoice is still `not_found`, and it writes no `patient_access` row. Tests: the name is shown, the fallback is shown, no audit row is written, and an unreachable invoice gives `not_found`.

## Gates
Typecheck, lint with 0 errors, all web tests, `NITRO_PRESET=node-server pnpm build:all`, prettier on touched files, no lockfile change, the review-lessons checklist ticked, and screens checked in Arabic and English at 1440 and 390. The report lists done items, test counts and anything left open (item 8 unless it is decided).
