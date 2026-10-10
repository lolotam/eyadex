# ADR-0027 — One global lock order

- Status: accepted (owner decision 2026-10-10, slice A2)
- Date: 2026-10-10

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

1. `roles:<clinic>` (advisory)
2. `users:<clinic>` (advisory)
3. `patients:<clinic>` (advisory)
4. `appointments:<clinic>:<membership>` (advisory, the provider lock; several are taken sorted by
   membership id — `lockProviders`)
5. an `appointments` row
6. a membership row, then an invitation row
7. a patient row
8. `branches:<clinic>` (advisory)
9. a branch row
10. a `clinic_services` row
11. the `clinics` row: every clinic-table INSERT takes `KEY SHARE` on it through `clinic_id`, so the
    writers that lock it `FOR UPDATE` (clinic settings, platform clinic changes) take nothing after it

The rule for implicit locks: a row a write will reference through a foreign key is locked explicitly at
its place in the list before anything later is taken, so the INSERT's `KEY SHARE` is already held. The
schedule save now reads the provider through `ProviderDirectory.lockForWrite` (the membership row
`FOR SHARE OF m`) before `SchedulingBranchReader.lockForFiling` (the branch row): in the cycle above (c)
waits on (a) without holding the branch, so (b) completes, then (a), then (c).

The paths as they stand: user writes take 1 → 2 → 6 → 8 (→ 9 through `membership_branches`); invitation
writes 1 → 2 → 6 (the invitation row) → 8, and an acceptance 6 → 8;
role writes 1 → 2 (→ 8); branch writes 8 → 9; patient writes 3 → 7 → 9; the booking profile 1 → 2 → 4 →
6; schedules and time off 4 → 6 (→ 9); a booking (A2) 4 → 6 → 7 → 9 → 10; a reschedule, status change
or cancel 4 → 5 (→ 6 → 7 → 9). `appointments.created_by` carries the actor's user id with no foreign key:
a foreign key to the actor's membership would take a second membership row lock at insert time, after
the branch row.

## Consequences

- `apps/api/src/modules/appointments/__tests__/lock-order.db.spec.ts` replays the three sessions: with the
  old order the schedule save is aborted (500); with this order all three complete.
- A new lock (advisory key or row) is placed in this list in the same PR, with its reason; a path that
  needs an earlier lock after a later one is restructured, not exempted.
- `apps/api/AGENTS.md` points here; `provider-lock.ts` documents its place.
