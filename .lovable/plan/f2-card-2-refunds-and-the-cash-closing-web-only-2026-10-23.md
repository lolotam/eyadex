# F2 card 2 — refunds and the cash closing (web only)

Base: `lovable` at 5565f5e4 (ancestor check passes). No change outside `apps/web` (plus `roadmap.md` / `AGENTS.md` quick rules). Contracts read, never edited: `finance-refunds.ts`, `finance-cash-closing.ts`, `finance-audit-shapes.ts`, `settlement-operations.ts` (`planPaymentRefund`, `planCreditRefund`).

## Size and split

Estimate: about 2,000 lines for refunds and about 2,600 for the cash closing, with roughly half of that in tests. The total is above 3,000, so I propose:

- **2a: refunds**, sections 0, 1 (refund methods), 2, 3, 5 (refund + platform totals) and their tests.
- **2b: cash closing**, section 1 (closing methods) and sections 4 and 5 (closing) with their tests. 2b starts only after your separate message.

## 0. Finance strip as navigation (2a)

- `shared/shell/finance-tabs.tsx` becomes `<nav aria-label>` with `Link`s. The active link gets `aria-current="page"` and the active style through tokens. No `Tabs`/`TabsTrigger`.
- `finance-tab-list.ts` is unchanged in 2a. In 2b, a cash closing entry is a separate sidebar item, not part of this strip.
- Test: the active link has `aria-current`, the other does not, and nothing has `role="tab"`.

## 1. Client methods

- `PaymentsApi` (2a): `refund`, `listRefunds`, `getRefund`. `http-payments.ts` covers `POST /v1/invoices/:id/refunds` (`refundWriteResponseSchema`), `GET /v1/refunds` (`refundListResponseSchema`) and `GET /v1/refunds/:id` (`refundResponseSchema` → `.refund`).
- New `CashClosingsApi` (2b) in `shared/api/cash-closings-client.ts` with `http-cash-closings.ts`: `closingPreview`, `closeCash`, `listClosings`, `getClosing`, parsed by the four closing schemas. It is wired into both adapters and `ApiClient`.
- HTTP route tests cover each method: method, path, query, `Idempotency-Key` and schema rejection.

## 2. Refund dialog (2a, `payments/refund-dialog.tsx` + `refund-form-fields.tsx`)

- The «استرداد» button appears on a receipt movement row when `canAtBranch("create","refunds",invoice.branchId)` and `refundableMinor > 0`. It also appears on the «رصيد المراجع» card when the credit is above 0, including on a void invoice.
- Fields:
  - Amount in major units through `parseMajorToMinor`, capped at the source's available amount.
  - Method, limited to the enabled methods. A cash hint appears below it.
  - Reason, required, 1–300 characters.
- A payment-source refund shows the "owes this amount again" warning.
- On success, a toast «تم الاسترداد» shows the refund number as plain text, since there is no refund page. Then the invoice payments, invoice and list queries refresh.
- Idempotency uses `useHeldKeys` through `keyOf`/`drop` only. The key is dropped on success or on a definite refusal.
- `invoice-movements.tsx` adds refund rows (number, date, method, signed amount, reason). There is no delete or cancel action on a receipt.
- Errors go through `errorKeyOf`: `refund_exceeds_available`, `credit_insufficient`, `payment_method_disabled` and `invoice_prefix_missing` (the keys already exist from card 1; any missing ones are added in ar+en).

## 3. Refunds list (2a)

- `payments/refunds-content.tsx` and `use-refund-columns.tsx`. Columns: number, date, patient name (plain text), invoice number, method, amount, reason (truncated, with a tooltip).
- Filters: branch, method, from–to and patient. There is no number search.
- It reuses `useReceiptBranches` and its error-with-retry, `ReceiptPatientPicker` (only with `view:patients`, cleared when the key is lost), and the placeholder-safe pager.
- `/clinic/payments` shows a two-option switcher «الإيصالات / الاستردادات» held in component state, as the other filters are. **Question A:** should it be a separate route `/clinic/refunds` in the finance strip instead? I would keep it in component state unless you prefer the route.

## 4. Cash closing (2b, `apps/web/src/cash-closings/`)

- A sidebar item «إقفال الصندوق» appears with `view:cash_closings`. Routes are `clinic.cash-closings.tsx` (history) and `clinic.cash-closings.$closingId.tsx` (detail). Both are thin route files.
- History: a cursor list with branch and from/to filters, showing business date, closed by (membership id is not resolved; **Question B:** show «—» or leave the column out), expected, counted, difference and a note marker. «إقفال جديد» appears only with `create:cash_closings`.
- Close dialog:
  - A branch picker. **Question C:** no endpoint lists the branches the create key reaches. My proposal is `branchOptions` filtered on the client by `canAtBranch("create","cash_closings",id)`. This misses branches outside `view:payments` reach, so a create-only role would see no branches.
  - Then the preview: the period, cash in, cash out, expected (`formatSignedMinor`), the movements (numbers and amounts only), and the other method totals «للعلم فقط».
  - Counted amount at 0 or above. A live signed difference shows in success (green) or warning (amber) tokens with «عجز/زيادة».
  - The note is required when the difference is not 0.
- Refusals:
  - `cash_drawer_changed`: refetch the preview and keep counted and note.
  - `cash_closing_exists`: show the message with a link to the history filtered to that branch and day, because the error carries no id.
  - Nothing is ever edited or reopened.
- Detail page: the closing fields and its movements, with no patient names.

## 5. Mock

- Refund (2a), `mock-refund-writes.ts`, in this order:
  1. Guards, the same as card 1's payment writes, with `create:refunds` at the invoice branch.
  2. Idempotency scope `refund:create`, with a fingerprint over `invoiceId` and the body.
  3. `not_found` for the payment, or if the payment belongs to another invoice.
  4. `payment_method_disabled`.
  5. `planPaymentRefund` → `refund_exceeds_available`, or `planCreditRefund` → `credit_insufficient`.
  6. `invoice_prefix_missing`.
  7. The refund number `PREFIX-RF-YYYY-NNNNNN` from its own gap-free series per branch and year.
  8. A cash refund takes the shared branch `cashSeq` counter from card 1.
  9. Audit: one `credit.released` row per release, then `refund.recorded` with the `RefundAuditSnapshot` shape (`reasonLength` only), checked by the contract's shape function.
- Refund reads: the same reach as the payment reads, newest first, with the card 1b cursor format.
- Platform totals (2a): `collectedMinor` and `refundedMinor` per clinic-timezone month, summed from payments and refunds. Only the totals are sent. The table shows «—» when a field is absent.
- Closing (2b), `mock-cash-closings.ts`:
  - Guards, then branch reach giving `forbidden`/`not_found`.
  - The preview over `(lastClosedSeq, lastCashSeq]`.
  - Close, refused in order: `cash_drawer_changed`, then `cash_closing_exists` (same business day), then `closing_note_required` (`""` counts as no note).
  - `cash_closing.closed` audit with `noteLength` only.
  - Two closings in a row with no cash between them succeed on different days.

## 6. Tests (each proven failing by revert)

- 2a:
  - S7, S8 and S10.
  - A refund on a void invoice from its released credit.
  - Refund numbers are gap-free and separate from receipts, and cash refunds share `cashSeq`.
  - The refusal order.
  - Idempotent replay and conflict.
  - Audit shapes with no reason text.
  - The dialog warning and the cap.
  - The refunds list (filters, patient picker hidden without the key, pager).
  - The finance strip `aria-current`.
  - Platform «—».
  - HTTP routes.
- 2b:
  - A stale preview gets `cash_drawer_changed`.
  - A second closing the same day gets `cash_closing_exists`.
  - `closing_note_required`.
  - Shortage and negative expected rendered through `formatSignedMinor`.
  - A payment after a closing lands in the next one.
  - No patient name on the closing screens or the mock answers.
  - HTTP routes.

## Gates

- `typecheck`, `lint` (0 errors), `test` (exact counts) and `prettier` in `apps/web`. `NITRO_PRESET=node-server` build; locally pnpm stops at the Node 24 engine check, so I would run vite build directly and report that.
- Preview check in ar+en at 1440/390.
- No lockfile change, every file 300 lines or less, one component per file.

## Open questions

- A: refunds as a switcher on `/clinic/payments`, or a separate route?
- B: what to show for "closed by"?
- C: the branch list for closing, where a create-only role sees nothing (an API branch-options route for `create:cash_closings` would be needed).
- Do you accept the 2a/2b split?
