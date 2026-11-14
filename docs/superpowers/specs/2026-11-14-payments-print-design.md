# Payments and refunds list printing

Date: 2026-11-14
Status: approved by the owner's standing instruction to choose the recommended options and proceed
Branch: `feat/payments-print`

## Purpose

Let clinic staff print the active Payments tab as a clean list. The printed document must represent every result matching the current filters, not only the 20 rows in the visible cursor page. Payment and refund forms, dialogs, navigation and row actions must never print.

This is independent of invoice-page printing and of the invoice AI explanation. It needs no schema, migration, API route or permission change.

## Current state

- `PaymentsContent` switches between `ReceiptsContent` and `RefundsContent` in page state.
- Both lists use cursor pagination with `PAGE_SIZE = 20` and existing `view:payments` checks in the API and mock.
- Receipts filter by branch, method, patient when permitted, from/to dates and receipt number. Refunds use the same filters except receipt number.
- `apps/web/src/report-exports/screens/report-print.css` establishes the local print opt-in pattern. The global print rules must not be edited.
- Lovable has an existing implementation checkpoint on `origin/lovable` at `90683a1e`; it is review input, not accepted work.

## Approaches considered

1. **Reuse each list's existing API method and follow cursors until exhausted (chosen).** The printed rows exactly match the active filters and existing permissions. No backend change is needed. Loading and partial-failure states must be explicit.
2. Print only the visible page. Simpler, but silently omits matching rows and was rejected by the owner.
3. Add a dedicated bulk-print endpoint. Could reduce client requests, but adds a second query/permission path and is unnecessary for this UI-only slice.

## Behavior

- A Print action is available on each active list, including its current filter state.
- On activation, the UI enters a preparing state and prevents a second print run for that list.
- The client requests the first page with the active filters, then follows every `nextCursor` in order with the same filters until no cursor remains. It never reuses a cursor with changed filters.
- The current visible page remains usable on screen. The printable document is a separate render of the collected rows, not a screenshot of the current page.
- Changing the active tab or any filter invalidates the prepared result; the next print starts from the new state. A stale run must not open the print dialog.
- A request failure shows the existing translated error path and leaves printing unopened. Retry starts a fresh complete read; no partial list is printed.
- Successful collection opens browser printing only after all rows have been rendered for print.
- The active tab determines the document: receipts and refunds are never combined.

## Printed document

- Bilingual title identifying receipts or refunds.
- A concise filter summary and the print timestamp in the current UI language.
- The same business columns and localized values as the active list, excluding action columns, links that exist only for navigation, checkboxes and controls.
- Long lists use normal paged print layout: repeated table header where the browser supports it and no forced row splitting.
- Empty results show a translated empty message rather than calling `window.print()` for a blank table.
- No payment form, refund form, dialog, app sidebar, header, finance navigation, tab switcher, filter editor, pager, toast or button is printed.

## Privacy and authorization

- Printing uses only rows returned by the existing authorized list methods.
- `view:payments` scope and patient-filter visibility are enforced on every cursor request by the API or mock.
- The patient filter is omitted when the caller lacks `view:patients`, as it is on screen.
- No patient identifier, payment form input or additional record is introduced into logs, storage or audit events.
- No new audit event is written for browser printing in this slice.

## Failure and loading states

- Preparing: the action reports progress and cannot be submitted twice.
- Error: a translated message appears in the list area and the previous screen state remains available.
- Filter/tab change during preparation: the old run is discarded and cannot print.
- Empty: the existing empty state remains; no blank print window.
- Success: printing is requested once, and the preparing state is cleared even if the user cancels the browser dialog.

## Testing and acceptance

- Unit/component tests prove that all cursor pages are requested with identical filters and all rows reach the printable list.
- Tests prove that a later-page failure does not call `window.print()` and exposes the translated error.
- Tests prove that tab/filter changes invalidate a pending or completed print result.
- Tests cover receipts and refunds, the receipt-number filter, patient-filter permission, empty results and exclusion of action/form content.
- Print-media browser checks in Arabic and English at 1440px and 390px cover a short list and a list longer than one printed page.
- `pnpm typecheck`, `pnpm lint`, package tests one at a time, and `NITRO_PRESET=node-server pnpm build:all` pass on the final branch.
- The final head is checked on staging against the real API before merge; production health is checked after the automatic deployment.

## Out of scope

- Combining receipts and refunds in one document.
- CSV/XLSX export, saved print presets, aggregate financial totals or server-generated PDF.
- Invoice-page printing, invoice AI explanation, or changes to global print CSS.
- New permissions, database tables, audit events or API endpoints.
