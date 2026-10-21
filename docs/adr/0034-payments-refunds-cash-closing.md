# ADR-0034 — Payments, refunds and the cash closing (finance F2)

- Status: accepted (owner approval 2026-10-20: the SQL plan and F2-Q1 … F2-Q19 as recommended;
  `docs/specs/finance-design.md` §4, owner
  decisions FIN-11 … FIN-16, review rules R1-4, R1-5, R1-9, R1-17, R2-2, R2-8 and §8d)
- Date: 2026-10-20

## Context

F1 (SQL 0060–0063, PRs 78, 84, 85, 87) issues invoices whose `status` is only `issued | void` and whose
lines stay editable after issue (FIN-A5). F2 records the money: payments by cash, KNET terminal, bank
transfer or other (FIN-11), partial payments (FIN-12), credit when an edited invoice drops below what was
paid (FIN-13), refunds as their own movement (FIN-14), a daily cash closing per branch (FIN-15) and gap-free
receipt numbers per branch (FIN-16). R1-4 forbids storing payment progress in `status`; R1-5 and R2-2 say
money is tracked as movements and a lowered or voided invoice releases its excess into credit; R2-8 fixes
one patient lock for every money operation. ADR-0033 (`0033-f1-money-numbering-invoice-life-cycle.md`)
records F1's money, numbering and invoice life cycle; this record also cites the spec's §3, §8 and §8b for
those rules.

## Decision

1. **Movements, never balances.** Money lives in six append-only tables — `payments` (money in),
   `payment_allocations` (money placed on an invoice, funded by exactly one payment or one credit),
   `patient_credits` (money released from an allocation, with its origin and cause), `refunds` and
   `refund_sources` (money out and the credits it spent), `cash_closings`. `eyadex_app` has `SELECT,
INSERT` on them and no role has `UPDATE` or `DELETE`. A correction is a new movement.
2. **Everything else is derived** by pure functions in `packages/contracts/src/settlement.ts`, shared by the
   API, the web mock and the receipt: an allocation's live amount (its amount minus the credits released from
   it), an invoice's paid and owed amounts, its state `unpaid | partly_paid | paid` (none when void), and the
   patient's credit balance. R1-4's `credit` is the patient's balance, not an invoice state, because the
   excess leaves the invoice when its total drops.
3. **Fixed release and spending orders.** A lowered invoice releases from its newest allocation first; a
   void releases all; credits are spent (on an invoice or a refund) oldest first. A refund from a payment is a
   release of that payment's allocation followed by a refund of the new credit, in one transaction, so every
   refund spends credit and money is never released twice.
4. **The database enforces the patient.** Composite foreign keys carry `patient_id` through invoice,
   payment, allocation, credit and refund, so money cannot cross patients; a deferred check (0066, kept by the
   owner, F2-Q17) re-computes the patient's invariants and each refund's sources at commit. It is
   `SECURITY DEFINER` with its own NOLOGIN owner and takes the clinic from the row, because `withTenant`
   clears `app.clinic_id` before `COMMIT` (R3-1, R3-2).
5. **Receipts** are numbered `PREFIX-R-YYYY-NNNNNN` per branch, series and clinic-timezone year from a new
   `receipt_sequences` table with F1's gap-free recipe (insert-if-missing, `FOR UPDATE`, inside the writing
   transaction with the idempotency record). The prefix is the branch's locked `invoice_prefix` (R1-9).
6. **Cash is sequenced per branch.** Every cash payment and cash refund takes the next `cash_seq` from the
   branch's `branch_cash_drawers` row under `FOR UPDATE`; a closing covers exactly the range since the last
   closing and confirms the previous closing and the range its preview showed (`cash_drawer_changed`
   otherwise). Closings chain by `previous_closing_id`, so a day with no cash still closes (R3-3). A cash
   movement is in exactly one closing, independent of clocks.
7. **Lock order** (joins ADR-0027 in the SQL/API slice): the idempotency claim (new 0) → patient row (item 7) → invoice rows by id ascending (new 7a) → branch row `FOR SHARE` (item 9) → the branch's cash drawer (new
   9a) → F1's invoice sequence (new 9b) or the branch's receipt sequence (new 9c). A closing takes 0 → 9 → 9a. A payment does not change the invoice
   row or its `version`. F2's rows reference no membership; F1's issue and edit, which do through their
   lines, lock those memberships (item 6) before the patient row (R3-4).
8. **The platform sees totals only** (FIN-3): no grant on any new table; `finance_monthly_totals` is
   recreated with `collected_minor` (payments by the month of `received_at`) and `refunded_minor` (refunds by
   the month of `refunded_at`), keeping its existing column names; the payment, refund, credit and closing
   audit entity types are excluded from the platform's audit view and policies; the payment-methods setting,
   which names no patient, stays visible like other clinic settings.
9. **Audit** writes one row per payment, credit use, credit release, refund and closing, with ids, numbers,
   methods and amounts only; references, refund reasons and closing notes are stored on their rows and appear
   in audit as their length.

## Consequences

- F1's invoice edit and void change: they read the paid amount after their locks and write credit releases
  in the same transaction (R1-5, R2-2). F1's issue and edit also gain the membership locks of R3-4.
- Contracts gain signed amounts for the closing (`signedMinorAmountSchema`, `formatSignedMinor`; R3-5).
- Balances are computed by aggregation on every read; the indexes of the spec's §4.2 keep it per invoice and
  per patient. F3 may add a read model later; it would be derived and rebuildable, never the source.
- A mistaken payment cannot be deleted; it is refunded with a reason (F2-Q12, owner decision 2026-10-20), which
  keeps receipt numbers gap-free and the cash closing exact.
- The owner decided every open rule on 2026-10-20 as recommended (spec §4.10, F2-Q1 … F2-Q19): items 3, 5
  and 6 stand as written, refunds are numbered `PREFIX-RF-YYYY-NNNNNN`, a branch closes once a day, and cash
  closings stay out of the platform's audit.

## As built (F2 slices 3–5, PRs 94, 95, 99)

- **Routes** (the hosts mount the API under `/api/v1`). The clinic routes each carry
  `@RequiresFeature("finance")`: `POST /v1/invoices/:id/refunds` (`create:refunds:branch`,
  `Idempotency-Key` required); `GET /v1/refunds` and `GET /v1/refunds/:id` (`view:payments:branch`; a
  refund has no view key of its own); `GET /v1/cash-closings/preview?branchId=` and `POST /v1/cash-closings`
  (`create:cash_closings:branch`, the close takes an `Idempotency-Key`); `GET /v1/cash-closings` and
  `GET /v1/cash-closings/:id` (`view:cash_closings:branch`). A branch key admits the clinic scope too; the
  use case narrows to the caller's reach, and a branch outside it is `not_found`. The platform route
  `GET /v1/platform/clinics/:id/finance-totals` (totals only) is guarded by `@PlatformStaff()` alone, with
  no finance feature gate; an unknown clinic is `not_found`.
- **Refund lock order:** the clinic idempotency key (0) → the patient row (7) → the invoice `FOR UPDATE`
  (7a) → the invoice's branch `FOR SHARE` for the prefix (9) → the branch's cash drawer `FOR UPDATE`, for
  a cash refund only (9a) → the refund series of `receipt_sequences` (9c). Every balance is read after the
  patient and invoice locks, and the clock after the patient, invoice and branch locks. A refund from a payment writes the
  `refund` credits it releases first and then spends exactly them in `refund_sources`.
- **Close lock order:** the idempotency key (0) → the branch `FOR SHARE` (9) → the drawer `FOR UPDATE`
  (9a). A closing takes no patient lock, but it takes turns with the branch's cash payments and cash
  refunds through the drawer lock: they take it `FOR UPDATE` for their `cash_seq` (`takeCashSeq`) and
  hold it until they commit. A non-cash payment or refund never takes the drawer lock, and the branch
  `FOR SHARE` locks do not conflict, so it never waits for a closing. The preview writes nothing.
- **Refundable from a payment (issue #91):** the smaller of the payment's live allocations and the
  payment amount minus what was already released from its allocations, never below zero
  (`refundableFromPayment`). More than that is `refund_exceeds_available` (409); the payment must belong
  to the invoice in the path, or it is `not_found`.
- **Close rules:** the request repeats the preview's `previousClosingId` and `throughCashSeq`; if the
  drawer moved since, it is `cash_drawer_changed` (409). A branch closes once per clinic-timezone business
  day: the last closing's date decides (`cash_closing_exists`, 409), and a clock set back to an earlier
  closed day reaches the `cash_closings_business_date_unique` index, which answers the same code. When
  the counted amount differs from the expected one (cash in − cash out in the range), a non-blank note is
  required (`closing_note_required`, 400).
- **Audit** keeps ids, numbers, methods and amounts; a refund records `reasonLength` and a closing
  `noteLength` (when it has a note), never the text.
- **Platform totals v2:** each month of `finance-totals` adds `collectedMinor` and `refundedMinor` beside
  `invoicedMinor`, from `finance_monthly_totals` (the two fields are optional in the contract).
- **Deferred:** the receipt PDF (`GET /v1/payments/:id/pdf`, F2-Q14) waits with slice 8g; the web
  (slice 6) is still to come.
