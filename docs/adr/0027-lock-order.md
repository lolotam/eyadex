# ADR-0027 — One global lock order

- Status: accepted (owner decision 2026-10-10, slice A2)
- Date: 2026-10-10
- Amended: 2026-10-20 (finance F2, slice 2): items 0, 7a, 9a, 9b and 9c (finance spec §4.4, ADR-0034).

## Context

Writes serialise on per-clinic advisory locks (`roles:` ADR-0017, `users:` ADR-0012, `branches:` ADR-0011,
`patients:` ADR-0018), on the per-provider lock `appointments:<clinic>:<membership>` (ADR-0026 §3) and on
row locks, explicit (`FOR UPDATE`, `FOR SHARE`) or implicit (an INSERT's foreign key takes `KEY SHARE` on
the referenced row). Each slice fixed the order of the locks it added, but nothing fixed the order across
modules. Codex confirmed a cycle on A1:

1. (a) a user's branch change: `users:` → membership row `FOR UPDATE` → waits `branches:`;
2. (b) a branch deactivation: `branches:` → waits the branch row `FOR UPDATE`;
3. (c) a schedule save: provider lock → branch row `FOR SHARE` → its INSERT waits the membership row
   (`KEY SHARE` through the foreign key), held by (a).

(a) waits on (b), (b) on (c), (c) on (a): PostgreSQL aborts one of them with `deadlock_detected`.

## Decision

Every transaction takes the locks it needs as a **prefix-ordered subset** of this list, never going back
to an earlier item:

**0** — the `clinic_idempotency_keys` claim of the request's own key (finance F1 already takes it first;
no other path locks that row)

1. `roles:<clinic>` (advisory)
2. `users:<clinic>` (advisory)
3. `patients:<clinic>` (advisory)
4. `appointments:<clinic>:<membership>` (advisory, the provider lock; several are taken sorted by
   membership id — `lockProviders`)
5. an `appointments` row
6. a membership row, then an invitation row
7. a patient row

   - **7a** — invoice rows, by id ascending (`FOR UPDATE`)

8. `branches:<clinic>` (advisory)
9. a branch row

   - **9a** — the branch's `branch_cash_drawers` row (`FOR UPDATE`: cash payments, cash refunds and closings)
   - **9b** — the branch's `invoice_sequences` row (finance F1)
   - **9c** — the branch's `receipt_sequences` row (receipts and refunds)

10. a `clinic_services` row
11. the `clinics` row: every clinic-table INSERT takes `KEY SHARE` on it through `clinic_id`, so the
    writers that lock it `FOR UPDATE` (clinic settings, platform clinic changes) take nothing after it

The rule for implicit locks: a row a write will reference through a foreign key is locked explicitly at
its place in the list before anything later is taken, so the INSERT's `KEY SHARE` is already held. The
schedule save now reads the provider through `ProviderDirectory.lockForWrite` (the membership row
`FOR SHARE OF m`) before `SchedulingBranchReader.lockForFiling` (the branch row): in the cycle above (c)
waits on (a) without holding the branch, so (b) completes, then (a), then (c). `lockForWrite` locks the row and then reads
the member in a second statement: a statement that waited for a row re-reads that row but not its subqueries,
so one statement would decide on the branch links of before the wait.

A transaction that finds the row it locked has moved to a provider whose lock it does not hold rolls back
and starts over (`retryWhenMoved`) instead of taking that lock late.

The paths as they stand: user writes take 1 → 2 → 6 → 8 (→ 9 through `membership_branches`); invitation
writes 1 → 2 → 6 (the invitation row) → 8, and an acceptance 6 → 8;
role writes 1 → 2 (→ 8); branch writes 8 → 9; patient writes 3 → 7 → 9; the booking profile 1 → 2 → 4 →
6; schedules and time off 4 → 6 (→ 9); a booking (A2) 4 → 6 → 7 → 9 → 10; a reschedule, status change
or cancel 4 → 5 (→ 6 → 7 → 9). `appointments.created_by` carries the actor's user id with no foreign key:
a foreign key to the actor's membership would take a second membership row lock at insert time, after
the branch row. Finance F2: a payment 0 → 7 → 7a → 9 (`FOR SHARE`, the prefix) → 9a (cash only) → 9c;
a credit use 0 → 7 → 7a; an invoice edit or void with releases 7 → 7a; a refund 0 → 7 → 7a → 9 → 9a
(cash only) → 9c (the refund series); a cash closing 0 → 9 → 9a, with no patient lock, so it never
waits on a payment that waits on it. F2's rows reference no membership (`received_by`, `refunded_by`
and `closed_by` have no foreign key). F1's invoice issue and edit take a membership `KEY SHARE` through
their lines after the branch row; finance slice 4 moves those membership locks before the patient row
(spec §8d R3-4).

## Consequences

- `apps/api/src/modules/appointments/__tests__/lock-order.db.spec.ts` replays the three sessions: with the
  old order the schedule save is aborted (500); with this order all three complete.
- A new lock (advisory key or row) is placed in this list in the same PR, with its reason; a path that
  needs an earlier lock after a later one is restructured, not exempted.
- `apps/api/AGENTS.md` points here; `provider-lock.ts` documents its place.
