# PDF ledger foundation — local validation only

Owner authorization: `feat-f3-export-end-to-end/docs/superpowers/plans/2026-11-07-pdf-ledger-owner-approval.md`.
The exact owner answers select bounded newest-version/lazy generation and one isolated local PostgreSQL experiment.
The earlier proposal's deferred queue and global tenant index are rejected and absent here.

## Scope and invariants

`0077_invoice_pdf_ledger.sql` adds jobs, upload ownership evidence, artifacts, and display revisions.
At numbering time remote main was `3c08265e5abe750a36ac6fbf4f0603023000c0c1`, ending in 0076;
the task base is PR176 `44c2f9886621df50e49aaab16930404cb21921e0`.
No previously applied SQL was edited. The migration is under 300 lines.

- Only queued/running/retry_wait consume capacity. No deferred status or intent queue.
- A singleton infrastructure row contains only a count (0..100), with no tenant/document identifiers.
  No runtime role has direct access. A NOLOGIN, NOBYPASSRLS function owner can read/update
  that counter only; its trigger computes the delta from OLD/NEW without reading tenant jobs.
  The trigger and row mutation share the transaction. Duplicates and failed transactions cannot charge capacity.
- Ten tenant-leading unique slots enforce at most ten admitted jobs per clinic independently of isolation level.
  All indexes of the three document tables lead with clinic_id. Their PK/FK chains are composite.
- Forced RLS, explicit grants, no platform/auth/dispatcher document grants, no direct runtime DELETE.
  Identity UPDATE grants are absent; job and upload guards validate initial/claim identity.
- Display revision triggers cover actual clinic names/timezone/commercial_reg_no/logo_blob_key,
  branch names/address/phone, and patient full_name. Revisions start at one, increment only on
  changes to those columns and cannot be directly updated by runtime roles. Existing table-wide
  UPDATE grants are replaced with equivalent old-column grants to exclude the new counter.
- Terminal evidence is separate from live admission. The live-generation partial unique index
  permits a later request after terminal completion without deleting evidence.
- Purge processes at most 100 rows per table per tenant call, after seven days. Only confirmed
  deleted uploads/artifacts qualify; unknown evidence and published references remain retained.
  This is not storage deletion, proof of storage absence, or an orphan scanner.

## Required following implementation contracts

1. Admission is a dedicated short tenant transaction after successful authorization. It must
   read current source versions, coalesce/supersede obsolete live work, choose a free tenant
   slot and insert the latest generation. Unique/quota conflict means pending/later request;
   never attempt admission in a financial mutation transaction. No durable rejected-intent row.
2. The global counter lock is held only for the short admission/release transaction. Never
   carry it over render, blob I/O or invoice mutation. Existing native 2 active/2 waiting stays.
3. Capture current invoice version and source counters in one snapshot. Render revision format
   is `templateRevision:clinicCounter:branchCounter:patientCounter`; template identity binds
   renderer/fonts/locale. No PHI hash. Immutable logo bytes still need an independently verified
   create-only/object-version storage contract; unique application-generated keys are insufficient.
4. Publication/download must lock/revalidate patient -> invoice -> branch -> clinic -> job ->
   upload -> artifact, compare current invoice version and all counters, and require the exact
   live attempt/fence/token/deadline. The SQL ledger is not itself an authorization or publication
   implementation. A syntactically valid old revision may remain as evidence but must never be served.
5. One initial attempt plus two transient retries at 30/120 seconds; 60 seconds remains experimental.
   Future claim/publication use cases must enforce CAS and retry timing, authorization, currentness,
   and commit ambiguity reconciliation. No policy change to currency or the renderer.
6. Retain ready bytes for 24 hours; start failed/cancelled cleanup within one hour. Mark unknown
   after ambiguous PUT/COMMIT and retain until conclusive reconciliation. A timestamp or purge
   eligibility never proves that a writer stopped or storage deletion succeeded.

## Local evidence and limitations

Owned resource: `eyadex-pdf-ledger-5e3991ef`, label `eyadex.owner=5e3991ef`.
Cached image `sha256:123b17998ccaf47e53b502e8c6a1e79afd8f579c6f3eec83c563da026f957395`;
`--pull never --network none --tmpfs /var/lib/postgresql`; no mounts or published ports.
Synthetic fixture names/phone only; runtime proofs use actual LOGIN connections through docker exec.
Only the owner seeds fixtures and reads catalogs/global diagnostic totals. No owner SET ROLE proof.
Fresh baseline uses the real migration runner, then this candidate, inside this container only.

Reproduce on that owned local container with `PDF_PROOF_DATABASE=eyadex_verified`:

```text
python db/tests/pdf-ledger-proof.py
python db/tests/pdf-ledger-integrity.py
cd packages/db && node pdf-ledger-catalog.mjs
pnpm --filter @eyadex/ids build
pnpm --filter @eyadex/db typecheck
pnpm --filter @eyadex/db lint
pnpm --filter @eyadex/db test
pnpm --filter @eyadex/db build
```

The proof script requires a freshly migrated synthetic database; rerunning seed on the same
database intentionally fails rather than silently deleting evidence. The catalog adapter runs
the existing schema-drift table comparator against live catalog queries without opening a port.
The normal URL-based DB suites cannot connect under the required network-none/no-ports policy;
this does not claim a run of those suites, API/worker end-to-end, or production migration proof.

Evidence directory: `F:/Dev/Temp/eyadex-pdf-ledger-5e3991ef`.
Known development failures retained: initial branch revision UPDATE privilege test exposed broad
baseline grants (fixed); first catalog pass exposed extra predicate parentheses and varchar
normalization (fixed); second local database exposed cluster-wide pre-existing NOLOGIN roles
(migration now supports the existing roles); initial typecheck required building workspace ids.
One diagnostic ALTER used the wrong truncated constraint name and was rejected without changes.
The catalog helper initially wrote a temporary module into the lint tree; concurrent lint saw
that transient generated file. It now uses the ignored package-local node_modules cache, and
the final lint rerun passed. Test runs never used a shared database or a host port.

Final local results: fresh migration runner through 0077 PASS; global 101 admissions produced
exactly 100 successes; clinic 11 admissions produced exactly 10 successes; rollback/release/
duplicate/claim/retry accounting PASS. Independent runtime-role RLS, grants, composite-FK,
upload-fence, unknown-retention and same-revision regeneration tests PASS. Live catalog comparison
matched all 65 tables. DB package typecheck, lint, build PASS; 15 unit files / 247 tests PASS.
Full URL-based database/API/worker integration suites were not run, for the isolation reason above.

Self-review: confirmed no global index on a tenant table, no deferred state, no runtime counter
privilege, no finance/worker/storage edits, no applied baseline edits, and no new dependency.
The permanent generation uniqueness was narrowed to live states to allow later regeneration;
terminal evidence remains intact. Publication/currentness/CAS and actual storage cleanup remain
explicit follow-up implementation contracts, not behaviors claimed by these schema tests.

No enqueue, poller, SDK, runtime binding, UI, shared migration, deployment or activation.
All native performance/crash/logo/staging/review/migration/release HOLD gates remain independent.

## Manager review correction (2026-11-07)

The first PR database job failed at `branch-contact.sql`: its old table-level
UPDATE assertion conflicted with deliberately column-scoped grants. The test now
checks every previously writable column and rejects direct revision-counter writes.
The full baseline SQL sweep also exposed the missing non-partial invoice foreign-key
index; the migration and Drizzle mirror now include it.

CI now runs the admission and real LOGIN-role proofs on a separate freshly migrated
clone, exports their JSON evidence, and compares the complete live catalog to the
Drizzle mirrors. Admission failures must identify the quota constraint, not an
unrelated connection or SQL error. The existing rollback-only RLS entry point is
split into relative includes below 300 lines and covers all three tenant PDF tables
for clinic reads and platform denial; Python covers the write/fence negatives.

Manager validation: corrected migration runner on a fresh isolated database PASS;
all baseline SQL probes PASS after corrections; revised RLS entry point PASS;
real-role admission/integrity proofs and 65-table comparison PASS; DB package
TypeScript and lint PASS. The initial local harness used the manager checkout's
pre-ledger baseline, and stdin could not resolve relative SQL includes; the corrected
runs used this task's migration and file-based entry points. Those harness failures
and the initial CI failure are retained in local evidence. URL-based API/worker/DB
suites remain CI gates, not locally claimed results. No shared migration or release.

The final review also exposed two state-integrity defects: deleted storage records
could be revived, and upload admission did not lock the running job while validating
its fence. A terminal deletion trigger now protects both ledgers; admission locks
the matching job so cancellation and upload admission serialize. A new real-connection
race test verifies blocking and revalidation after cancellation. Both regressions
were demonstrated against the pre-fix schema. The SQL isolation entry point now
also probes cross-clinic updates and inserts for all three PDF tables.

Follow-up review: upload allocation now also requires its deadline to fit the job's
current lease. Retention execution belongs only to `eyadex_dispatcher`, matching
CLAUDE's role boundary; application/platform/auth callers are rejected. Both issues
were reproduced on the prior schema, then the integrity and cancellation-race
proofs passed on the corrected fresh baseline. Creating a database with TEMPLATE
copies objects but not database ACLs: the proof clone now explicitly reapplies
0022's TEMPORARY revocation. The local clone's initial TEMP test failure is retained;
it is not treated as a product pass.

The following review pass adds tenant-leading partial purge indexes on the actual
retention timestamps and uses a stable statement cutoff. Forced index-plan checks
confirm the indexes can satisfy each query; they do not establish production latency.
ADR-0038 records admission serialization, privileged role ownership, forced RLS,
retention responsibilities and the unchanged release gates.

The capacity trigger is now a deferrable constraint, initially immediate. Normal
admission still checks immediately; every committed transaction must satisfy the
hard limit. The rollback-only RLS suite explicitly defers this trigger. A separate
fresh-database test fills all 100 committed slots, holds the global row lock, and
requires the entire RLS suite to finish independently and roll back; a deferred
101st admission must still fail at commit. CI runs this proof in its own database.
A local attempt to reuse the offset fixtures for the ordinary proof exposed a test
seed range issue; seed now inserts related rows only for its requested range. The
failed attempt is retained; final regression runs use fresh databases.
