# Card 1b review fixes (PR #114) — web only

Base: `lovable` at 51bbca7a (verified ancestor of HEAD). No contract change, no new permission, no lockfile change, every file at most 300 lines.

## 1. Patient filter follows `view:patients`
- `receipts-content.tsx`: `seesPatients` computed as today. If it is false while `patient` is set, clear it in render (same pattern as the search reset) and call `pages.reset()`.
- The query sends `patientId` only when `seesPatients && patient`, so a stale selection is never sent, even for the one render before it clears.
- Test: render with `view:patients` and a picked patient (picker mock calls `onChange`), rerender without the key, assert the last `useReceiptList` query has no `patientId` and the cursor was reset.

## 2. Failures are errors, not "no data"
- Receipts list: when `branches.isError`, show a short inline error with a «حاول مرة أخرى» button (`branches.refetch`) above the table, in place of the branch filter. Rows keep the list itself.
- Receipt page: when `branches.isError`, the branch row shows the error text plus a retry button instead of «—».
- Patient picker: when `search.isError`, show a short error line with retry under the input instead of the empty list.
- New i18n keys ar+en: `payments.receipts.branchesError`, `payments.receipts.patientSearchError`. Reuse `common.tryAgain`.
- Tests: list and page each show the branch error + retry, and retry calls `refetch`.

## 3. Picker searches all statuses
- `patientSearchRequestSchema.status` is `patientStatusSchema.nullable()`, so `status: null` means every status. Change the picker to `status: null`. No contract change needed. Mock `patients.list` already treats null as "all" (checked while implementing; if not, report back instead of changing it).

## 4. Pager while placeholder data shows
- `receipts-content.tsx`: `canNext` and `canPrevious` also need `!list.isPlaceholderData`.
- Test: `useReceiptList` mock returns `isPlaceholderData: true` with a `nextCursor`; both buttons are disabled.

## 5. One component per file
- `receipt-row.tsx` (`Row`), `receipt-details.tsx` (`ReceiptDetails`); `receipt-page.tsx` keeps only `ReceiptPage`.

## 6. Mock `branchOptions` = API
- Sort reached branches by id; cursor is the last id without dashes (same `toCursor`/`fromCursor` logic as `apps/api/.../list-cursor.ts`, reimplemented in the mock since web cannot import `apps/api`); next page = ids greater than the decoded cursor.
- A cursor not matching `^[0-9a-f]{32}$` throws `ApiError("validation")`, checked after the permission check (API order).
- Tests: pages are id-ordered and the cursor has no dashes; a bad cursor (e.g. a dashed id) is refused with `validation`; existing paging test kept.

## Gates
`pnpm --filter @eyadex/web typecheck && lint && test` with exact counts (known pre-existing typecheck error in `invoices/finance-mock-audit.test.ts` reported again, not fixed), prettier, revert-proof that each new test fails without its fix, preview check ar+en at 1440/390. Report SHA, changed lines, test counts, deviations.
