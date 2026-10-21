# ADR-0033 — F1 money, numbering and the invoice life cycle (finance F1)

- Status: accepted (owner decisions FIN-A1 … FIN-A8, FIN-1 … FIN-10, 2026-10-14; review rules R1 and R2,
  2026-10-15; the F1 plan review §8c, decided by the owner on the decisions page, batch 14;
  `docs/specs/finance-design.md` §2, §3, §8, §8b, §8c)
- Date: 2026-10-21 (written after F1 shipped: PRs 78, 84, 85, 87; SQL 0060–0063)

## Context

F1 gives each clinic service prices and invoices (FIN-A1). The owner fixed the shape of the money in
FIN-A2 to FIN-A5: one currency per clinic (default KWD, 3 decimals), one tax rate per clinic (default 0 %),
a gap-free invoice number per branch with a branch prefix, and an issued invoice that stays editable and is
never deleted. The design left four questions that two review rounds (R1, R2) settled and that every later
finance phase relies on: how an amount is stored and added up, how a number is taken without gaps, what an
invoice may do between issue and void, and how a patient is given a private link to one. ADR-0034 (F2)
builds on these rules and cites this record; the repository's lock order (ADR-0027) already carries the
positions F1 uses (5a, 7a, 9b).

## Decision

### Money

1. **Integers in minor units.** Every amount is a `bigint` count of the currency's minor unit (KWD: fils,
   1 KWD = 1000). No floating point anywhere. On the wire an amount is a canonical decimal integer string
   (`"12500"` = 12.500 KWD), parsed to `bigint` for arithmetic and never to `number`; the web formats from
   the string with the exponent (R1-2).
2. **Currency and exponent.** The supported list is `KWD 3`, `BHD 3`, `OMR 3`, `SAR 2`, `AED 2`, `QAR 2`.
   The exponent is derived from the code and never typed (a `CHECK` on `clinics`, and each invoice stores
   its own `currency` and `currency_exponent`). The platform sets the currency when it creates the clinic.
   Changing it is allowed only while the clinic has no base price, no per-doctor price and no invoice; the
   check and the change run in one `SECURITY DEFINER` function, `finance_set_currency`, under the per-clinic
   advisory lock `finance:<clinic>` that every price write and the clinic's first issue also take (lock-order
   position 5a). The platform has no direct `UPDATE` on the currency columns (R1-6, R2-3; SQL 0061).
3. **Tax.** One rate per clinic in basis points (0–10000, default 0), set by the platform; each invoice
   stores the rate it was totalled with. The tax line shows only when the rate is above zero (FIN-A3).
4. **Bounds.** A line's quantity is 1–999; a unit price, a line discount amount and a service price are
   non-negative and at most 10¹² minor units; a discount percentage is 0–10000 basis points. The totals
   function rejects a line whose `gross_line` (unit price × quantity) exceeds 10¹² with `validation`
   (`amount_out_of_range`), so a unit price of 10¹² only fits quantity 1; a negative price or an
   out-of-range quantity or basis-point value is `invalid_line`. Every aggregate is bounded by PostgreSQL
   `bigint`, and each multiply and add is range-checked against it (R1-2). An invoice has at most 50 lines (`position` 0–49).
5. **Totals: one pure function** in `packages/contracts` (`invoice-totals.ts`), used by the API, the web
   mock and the PDF, so a printed total never differs from the stored one (R1-1, R2-1):
   1. `gross_line = unit_price_minor × quantity`.
   2. A line discount is a percentage in basis points (`round_half_up(gross_line × bp / 10000)`) or an
      amount on the whole line (not per unit) that may not exceed `gross_line`;
      `net_line = gross_line − line_discount`.
   3. An invoice discount (percentage or amount) applies to `Σ net_line` and never exceeds it. A percentage
      becomes the amount `D = round_half_up(Σ net_line × bp / 10000)`, the same rounding as a line discount
      (for example `Σ net_line = 50` at 100 bp gives `D = 1`). It is
      allocated to lines in proportion to `net_line`: each share is `floor(D × net_line / Σ net_line)`, and
      the remainder goes one minor unit at a time to the lines that still have capacity
      (`net_line − share > 0`), in `position` order, cycling until spent. When `Σ net_line = 0`, every share
      is 0 and a non-zero invoice discount is a `validation` error (`discount_exceeds_total`).
      `line_total = net_line − share ≥ 0`.
   4. Tax is computed per line, `round_half_up(line_total × tax_rate_bp / 10000)`, and summed.
   5. `subtotal = Σ gross_line`, `discount = Σ line_discount + invoice_discount`,
      `total = Σ line_total + tax`. Tax is added, never subtracted. A negative intermediate is a
      validation error, never clamped; a 100 % discount gives a zero total, which is allowed.

   The spec's worked examples E1–E6 (§8b) are asserted by the shared test.

### Numbering

6. **Number format.** `PREFIX-YYYY-NNNNNN`, for example `SLM-2026-000123`. The prefix is the branch's
   `invoice_prefix` (2–6 upper-case letters or digits, unique among the clinic's branches); the year is the
   clinic-timezone year of `issued_at`; six digits is a minimum width, not a limit. The row stores both
   `number_seq` and the formatted `number`, which is unique per clinic.
7. **Gap-free per branch and year.** `invoice_sequences` has `UNIQUE (clinic_id, branch_id, year)`. The issue
   runs `INSERT … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE`, then increments `next_number`, all
   inside the one transaction that writes the invoice, its lines, the audit row and the idempotency record.
   A failed issue rolls the number back; a replayed `Idempotency-Key` returns the first invoice without
   taking a number. The sequence row is lock-order position 9b, after the branch row read `FOR SHARE` (9).
8. **Prefix life cycle.** A branch cannot issue without a prefix (`invoice_prefix_missing`). The prefix
   locks after the branch's first invoice, and a prefix ever used in the clinic can never be given to
   another branch: the use case writes the branch and `used_invoice_prefixes` (unique per clinic) in one
   transaction (R1-9). F2's receipts and refunds reuse the locked prefix (ADR-0034).

### Life cycle

9. **Status is only `issued | void`** (R1-4). Payment progress is derived in F2 from allocations and is
   never stored in `status`.
10. **Issue.** An invoice comes from an appointment, a visit or is manual (FIN-A6), never automatically. For
    an appointment or visit the API loads the source through the owning module's port and derives the
    patient and branch from it; a `CHECK` ties `source_id` to `source <> 'manual'`. At most one live invoice
    per source (a partial unique index `WHERE status <> 'void'`), and an appointment and the visit made from
    it count as one encounter (`invoice_already_exists`). Lines are service lines (priced from the doctor's
    price, else the base price; a service with no price is `price_missing`) or free lines (FIN-7).
11. **Edit** (FIN-A5, owner's choice over "lock after issue"). An issued invoice stays editable: lines,
    discounts and patient-facing fields. `source`, `source_id`, `branch_id`, `patient_id`, `number` and
    `issued_at` never change. Each edit is one transaction that recomputes the totals with the shared
    function, archives removed lines (`archived_at`; no row is deleted and archiving frees the position) and
    writes an audit row with a before and an after snapshot (`invoiceAuditSnapshot`): number, status, version,
    subtotal, discount, tax and total, the line count and a summary of the discounts (scope, kind and value,
    never the written reason) — not the changed lines. Changing a discount (add,
    remove, or change its value or reason) needs `create:discounts` as well; an edit that leaves discounts
    alone needs only `update:invoices` (R1-14). A void invoice cannot be edited (`invoice_void`).
12. **Versioning.** `invoices.version` starts at 1 and increments on every edit and on void; reads return it
    as the `ETag`. `PATCH` and void require `If-Match` (missing: 428 `precondition_required`; stale: 412
    `version_conflict`); the check and the increment follow `SELECT … FOR UPDATE` on the invoice, and the
    status is read again after the lock (R1-10). The invoice row is lock-order position 7a.
13. **Void** (FIN-8). Its own permission (`deactivate:invoices`) and a written reason of 1–300 characters.
    The row keeps its number, its lines and the reason and time of the void; the number is never reused.
    The source can be billed again, because the unique index ignores void rows. In F2 a void also releases
    every allocation on the invoice into credit in the same transaction (R2-2, ADR-0034).
14. **Lock order of a money operation** (R2-8): the idempotency claim (0), then the per-clinic advisory lock
    only when prices or currency are touched (5a), the line doctors' membership rows (6), the patient row
    (7), the invoice rows by id ascending (7a), the branch row (9), the numbering row (9b). An issue takes
    0 → 5 (the appointment it bills) → 5a (only the clinic's first issue) → 6 → 7 → 9 → 9b; an edit takes
    6 → 7 → 7a. `If-Match` is checked after the invoice lock.

### The patient's invoice link

15. **A private link per send.** `POST /invoices/:id/send` queues a `patient_notifications` row of kind
    `invoice` (the N1/N2 pipeline), identified by a client-generated `send_request_id` that is unique per
    clinic, so a retry returns the first row and a new press resends. The message carries
    `${APP_URL}/api/v1/public/invoices/<token>`, which reaches `GET /v1/public/invoices/:token`.
16. **The token.** 32 random bytes. `invoice_links` keeps the SHA-256 hash for lookup, never the token
    itself, and a sealed copy (`token_sealed`, sealed by the worker with the dedicated key
    `INVOICE_LINK_SEAL_KEY`, bound to clinic, link and notification) that only a retried send re-opens, so
    the retry sends the same URL (C1, owner-approved). A link expires after 14 days. A retry of the same send
    revokes its link when it has expired or its seal no longer opens (a rotated key) and mints a new one; a
    send that proves non-delivery revokes its link (`revoked_at`; never deleted). Rotating the key does not
    revoke links already sent: the lookup checks only the hash, `revoked_at` and the expiry, so they stay
    valid until they expire. A voided invoice's link stops working (R1-16). An
    ambiguous failure (a timeout) keeps it until expiry. One invoice can have several live links, one per
    send. The link transaction commits before any network send.
17. **Public lookup.** `GET /v1/public/invoices/:token` has its own rate limit and no clinic yet: the API hashes the token and
    calls `invoice_link_lookup(hash)`, a `SECURITY DEFINER` function owned by a `NOLOGIN`, `NOBYPASSRLS` role
    that can read the lookup columns only (never `token_sealed`) and executable by `eyadex_app` only; it
    returns the clinic, invoice and link of a live link, and the API then reads the invoice inside
    `withTenant`. The page shows the latest version and stops when the invoice is void. Opening it is
    audited with the actor `patient_link` (R2-7).

### What the platform sees

18. **Totals only** (FIN-3). The platform has no grant on any finance table. `finance_monthly_totals` is a
    `SECURITY DEFINER` function that returns per-clinic, per-month `invoiced` — the sum of the total of
    non-void invoices by the clinic-timezone month of `issued_at`, as they stand now, so an edit or a void
    restates its month (R1-17). Finance audit rows are `patient_access`, so the platform's audit view and
    policies exclude them; snapshots hold ids, numbers and amounts only, never patient names or free-line
    descriptions (R1-3).

## Consequences

- A total is reproducible anywhere from the stored lines and the shared function; the printed number and
  the stored number cannot drift, and the web mock checks the same table of examples.
- Numbers stay gap-free at the price of one row lock per branch and year during an issue; the number is taken
  last in the lock order and rolls back with the transaction. A void keeps its number, so no sequence has a hole.
- Because an issued invoice is editable and a payment is not part of its row, money that moves after an edit
  is tracked as separate movements (ADR-0034); a total can go down below what was paid without losing the
  payment.
- A currency can be chosen only before the first price or invoice; a later change is refused
  (`currency_locked`).
- The platform sees revenue by month and nothing else; a support question about one invoice is answered by
  the clinic.
- The link design needs one more secret (`INVOICE_LINK_SEAL_KEY`), rotated only after the invoice queue is
  drained; links already sent stay valid until they expire.
- F1's invoice PDF (slice 8g, `docs/specs/finance-f1-pdf-design.md`) is deferred by the owner to the end of
  the project; the stored totals do not depend on it.
