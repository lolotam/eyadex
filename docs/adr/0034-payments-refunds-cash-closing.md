# ADR-0034 — Payments, refunds and the cash closing (finance F2)

- Status: proposed (design awaiting the owner's approval; `docs/specs/finance-design.md` §4, owner
  decisions FIN-11 … FIN-16, review rules R1-4, R1-5, R1-9, R1-17, R2-2, R2-8 and §8d)
- Date: 2026-10-20

## Context

F1 (SQL 0060–0063, PRs 78, 84, 85, 87) issues invoices whose `status` is only `issued | void` and whose
lines stay editable after issue (FIN-A5). F2 records the money: payments by cash, KNET terminal, bank
transfer or other (FIN-11), partial payments (FIN-12), credit when an edited invoice drops below what was
paid (FIN-13), refunds as their own movement (FIN-14), a daily cash closing per branch (FIN-15) and gap-free
receipt numbers per branch (FIN-16). R1-4 forbids storing payment progress in `status`; R1-5 and R2-2 say
money is tracked as movements and a lowered or voided invoice releases its excess into credit; R2-8 fixes
one patient lock for every money operation. ADR-0033 (F1's money, numbering and invoice life cycle) is not
written yet; this record cites the spec's §3, §8 and §8b for those rules.

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
   payment, allocation, credit and refund, so money cannot cross patients; a deferred check (0066, if the
   owner keeps it) re-computes the patient's invariants and each refund's sources at commit. It is
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
7. **Lock order** (joins ADR-0027 in the SQL/API slice): idempotency claim → patient row (item 7) → invoice
   rows by id ascending (new 7a) → branch row `FOR SHARE` (item 9) → the branch's cash drawer (new 9a) → the
   branch's receipt sequence (new 9b). A closing takes 9 → 9a only. A payment does not change the invoice
   row or its `version`. F2's rows reference no membership; F1's issue and edit, which do through their
   lines, lock those memberships (item 6) before the patient row (R3-4).
8. **The platform sees totals only** (FIN-3): no grant on any new table; `finance_monthly_totals` is
   recreated with `collected_minor` (payments by the month of `received_at`) and `refunded_minor` (refunds by
   the month of `refunded_at`), keeping its existing column names; the new audit entity types are excluded
   from the platform's audit view and policies.
9. **Audit** writes one row per payment, credit use, credit release, refund and closing, with ids, numbers,
   methods and amounts only; references, refund reasons and closing notes are stored on their rows and appear
   in audit as their length.

## Consequences

- F1's invoice edit and void change: they read the paid amount after their locks and write credit releases
  in the same transaction (R1-5, R2-2). F1's issue and edit also gain the membership locks of R3-4.
- Contracts gain signed amounts for the closing (`signedMinorAmountSchema`, `formatSignedMinor`; R3-5).
- Balances are computed by aggregation on every read; the indexes of the spec's §4.2 keep it per invoice and
  per patient. F3 may add a read model later; it would be derived and rebuildable, never the source.
- A mistaken payment cannot be deleted; it is refunded with a reason (pending owner question F2-Q12), which
  keeps receipt numbers gap-free and the cash closing exact.
- Rules the owner has not settled (spec §4.10, F2-Q1 … F2-Q18) are `TODO(spec)` and not implemented by
  guess; their answers may change items 3, 5 and 6 and will amend this record.
