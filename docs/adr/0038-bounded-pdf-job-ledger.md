# ADR-0038: Bounded tenant PDF job ledger

Status: accepted for local implementation and review only; release remains HOLD.
Date: 2026-11-07
Related: ADR-0022 (retention), ADR-0037 (renderer); migrations 0077-0078.

## Context

The synchronous renderer retains its five-second API bound. The owner approved a
local worker candidate with a sixty-second execution bound, 100 admitted jobs
globally and 10 per clinic, and latest-version generation on demand if capacity was
unavailable. This does not authorize shared migrations, deployment or storage resources.

Three tenant ledgers separate jobs, upload attempts and artifacts. They must preserve
fencing and ambiguous-upload evidence without exposing patient rows to the platform
or granting the API direct deletion rights.

## Decision

- Enforce tenant RLS and composite tenant foreign keys on all three ledgers. Every
  tenant index starts with `clinic_id`; no global document index is introduced.
- Serialize global admission through a count-only infrastructure row. Its SECURITY
  DEFINER trigger belongs to NOLOGIN, NOBYPASSRLS `eyadex_pdf_capacity`. Runtime roles
  cannot directly access the row. A unique tenant-leading index enforces ten slots.
- Enforce capacity transactionally. The constraint trigger is initially immediate,
  preserving normal admission. Explicit deferral postpones enforcement until commit;
  committing over capacity still fails atomically. The rollback-only isolation suite
  defers the trigger so its fixtures never update or lock the live count. It always
  ends with ROLLBACK. Test this with a full, locked counter and separately verify that
  a deferred over-capacity transaction cannot commit.
- Lock the running job during upload allocation. Verify attempt, fence, unexpired
  lease, and upload deadline bounded by lease and execution deadline. Deleted storage
  evidence is terminal. Publication/currentness and storage reconciliation remain
  separate, unimplemented release gates.
- Assign the tenant-scoped SECURITY DEFINER purge to NOLOGIN, NOBYPASSRLS
  `eyadex_pdf_retention`, with a fixed search path and forced RLS. Only
  `eyadex_dispatcher` can execute it; runtime roles receive no direct DELETE.
  Unknown/published objects are ineligible. Deleted evidence and terminal unreferenced
  jobs retain the approved seven-day window, with batches of at most 100 deletions.
  Server triggers stamp job updates, upload terminal age and evidence deletion age;
  caller-supplied backdating cannot shorten the retention period.
- Match partial tenant-leading indexes to purge cutoff and ordering columns. Use
  stable statement timestamps for indexable cutoff bounds. Retain separate scheduling
  indexes for later worker cleanup.
- Increment guarded display revisions on current patient-name or clinic/branch
  branding changes. Future publication must combine these with invoice version and
  revalidate access/currentness before delivering a stored result.

## Consequences

The global row intentionally serializes admission changes: an enforceable hard bound
costs contention. Throughput, crash containment, native performance, maximum-logo and
staging proof remain independent HOLD gates.

There is no enqueue, retry scheduler, worker, storage encryption, cleanup executor,
polling or activation in this slice. Only a separate owner decision can authorize a
shared migration or production change.

CI covers real LOGIN-role negatives, admission concurrency, rollback under a locked
full counter, and all table mirrors. Cloned databases reapply 0022's database-level
TEMPORARY revocation because template cloning does not preserve database ACLs.
