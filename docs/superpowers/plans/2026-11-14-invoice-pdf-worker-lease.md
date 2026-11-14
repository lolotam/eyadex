# Invoice PDF worker lease Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a disabled, tenant-scoped PDF job store that safely claims, recovers, heartbeats and retries leased work.

**Architecture:** A pure domain policy decides failure outcomes. PostgreSQL adapters execute short `withTenant` transactions, fresh-clock fencing and rollback-on-miss; no production composition imports the store.

**Tech Stack:** TypeScript, Vitest, PostgreSQL 18, `@eyadex/db`, existing UUID `IdGenerator`.

---

## Global constraints

- Base: `c2f296b956ae51d6f3e3b3a9fc925363a12ca9f4`; keep PR177/178 and every HOLD unchanged.
- No SQL, migrations, API imports, renderer/model/storage, outbox, poller, `main.ts`, module registration, HTTP, UI, workflow or Dockerfile changes.
- Do not modify existing F3 files. New code stays under `apps/worker/src/invoice-pdfs/` plus this plan and ADR-0038.
- Every production operation runs as `eyadex_app` through `withTenant`; owner only seeds/inspects tests.
- Each file stays below 300 lines. Exported domain and port declarations carry Arabic JSDoc.
- The store is intentionally unregistered. No deployment, activation, shared migration or merge.

## File map

- `domain/pdf-job-failure.ts`: failure catalogue and three-attempt/two-retry policy.
- `ports/pdf-job-store.ts`: lease identity, claim/fence answers and store contract.
- `persistence/pg-pdf-claim.ts`: bounded recovery and oldest-due claim.
- `persistence/pg-pdf-fence.ts`: heartbeat, failure write and post-miss reread.
- `persistence/pg-pdf-job-store.ts`: dependency-injected facade only.
- `__tests__/pdf-job-fixtures.ts`: synthetic owner seeding and row inspection.
- `__tests__/pdf-job-claim.db.spec.ts`, `pdf-job-fence.db.spec.ts`: real-role races and isolation.

### Task 1: Failure policy and store contract

**Files:** create the domain/port files and `domain/pdf-job-failure.spec.ts`.

- [ ] **Step 1: Write failing policy tests**

```ts
import { describe, expect, it } from "vitest";
import { pdfFailureOutcome } from "./pdf-job-failure.ts";

describe("pdfFailureOutcome", () => {
  it.each([
    [1, 0, "store_unavailable", "retry_wait", 1, 30],
    [2, 1, "db_unavailable", "retry_wait", 2, 120],
    [3, 2, "lease_expired", "failed", 2, null],
    [1, 0, "invalid_model", "failed", 0, null],
    [1, 0, "size_limit", "failed", 0, null],
    [1, 0, "cancelled", "cancelled", 0, null],
  ] as const)("attempt %i retry %i code %s", (attempt, retries, code, status, count, delay) => {
    expect(pdfFailureOutcome(code, { attempt, retryCount: retries })).toEqual({
      status,
      retryCount: count,
      delaySeconds: delay,
    });
  });
  it("rejects an unknown public or native error", () => {
    expect(() =>
      pdfFailureOutcome("native_stderr" as never, { attempt: 1, retryCount: 0 }),
    ).toThrow(TypeError);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing module failure**

Run: `pnpm --filter @eyadex/worker test -- src/invoice-pdfs/domain/pdf-job-failure.spec.ts`.

- [ ] **Step 3: Implement the policy and contract**

```ts
export const PDF_FAILURE_CODES = [
  "store_unavailable",
  "db_unavailable",
  "lease_expired",
  "invalid_model",
  "size_limit",
  "cancelled",
] as const;
export type PdfFailureCode = (typeof PDF_FAILURE_CODES)[number];
export type PdfFailureOutcome = {
  status: "retry_wait" | "failed" | "cancelled";
  retryCount: number;
  delaySeconds: 30 | 120 | null;
};
/** يقرر إعادة المحاولة من رمز مسموح فقط، بحد أقصى ثلاث محاولات وإعادتين. */
export function pdfFailureOutcome(
  code: PdfFailureCode,
  current: { attempt: number; retryCount: number },
): PdfFailureOutcome {
  if (!PDF_FAILURE_CODES.includes(code)) throw new TypeError("pdf_failure_unknown");
  if (code === "cancelled")
    return { status: "cancelled", retryCount: current.retryCount, delaySeconds: null };
  const transient =
    code === "store_unavailable" || code === "db_unavailable" || code === "lease_expired";
  if (transient && current.attempt < 3 && current.retryCount < 2) {
    const retryCount = current.retryCount + 1;
    return { status: "retry_wait", retryCount, delaySeconds: retryCount === 1 ? 30 : 120 };
  }
  return { status: "failed", retryCount: current.retryCount, delaySeconds: null };
}
```

The port defines `PdfJobFence { clinicId, jobId, attempt, fence: bigint, leaseToken }`, `LeasedPdfJob` adding invoice/version/revision/deadlines, `PdfClaim = { kind: "claimed"; job: LeasedPdfJob } | { kind: "empty" }`, and `PdfFenceAnswer = { kind: "applied" | "own_success" | "lost_lease" }`. `PdfJobStore` exposes `claimNext(clinicId)`, `heartbeat(fence)` and `recordFailure(fence, code)` with Arabic JSDoc and `@param`/`@returns`.

- [ ] **Step 4: Re-run the policy test and commit only this task**

Expected: all seven cases pass. Commit: `test(worker): define PDF lease failure policy`.

### Task 2: Recovery and oldest-due claim

**Files:** create `persistence/pg-pdf-claim.ts`, facade and claim fixtures/tests.

- [ ] **Step 1: Seed two clinics and failing claim tests**

Seed clinic/branch/patient/invoice using the existing synthetic shapes in `pdf-admission-fixtures.mjs`; use `psql` through `execFileSync`, never a new dependency. Insert jobs with `render_revision='typst:1:1:1'`. Tests assert:

```ts
const [a, b] = await Promise.all([storeA.claimNext(clinicId), storeB.claimNext(clinicId)]);
expect([a, b].filter((x) => x.kind === "claimed")).toHaveLength(1);
expect(readJob(clinicId, jobId)).toMatchObject({ status: "running", attempt: 1, fence: "1" });
```

Also cover oldest-first, future `retry_wait` deferral, other-clinic invisibility, a locked first candidate leaving another due job claimable, and no partial recovery when the final claim misses. Each returned lease has a distinct UUID and `expect(leaseUntil.getTime()).toBe(deadlineAt.getTime())` about sixty seconds ahead. The adapter converts raw values explicitly with `Number(attempt)`, `BigInt(fence)` and `new Date(timestamp)`; it never returns unchecked driver strings as port types.

- [ ] **Step 2: Run the claim suite and confirm missing implementation**

Run: `pnpm --filter @eyadex/worker test:db -- src/invoice-pdfs/__tests__/pdf-job-claim.db.spec.ts`.

- [ ] **Step 3: Implement bounded recovery and CAS claim**

`claimNext` calls `db.withTenant(clinicId, ...)`. It selects at most 20 expired running rows `ORDER BY created_at,id FOR UPDATE SKIP LOCKED`, rereads each after the lock, and applies `pdfFailureOutcome('lease_expired', row)`. Recovery requires the complete observed fence and `lease_until <= clock_timestamp()` in `UPDATE … RETURNING id`; retry retains `clinic_slot`, clears all lease/deadline fields, increments only `retry_count`, and sets 30/120-second `next_attempt_at`. Exhaustion sets `failed`, clears the slot and stamps `cleanup_due_at`.

The claim then selects one due row:

```sql
SELECT id, invoice_id, invoice_version, render_revision, attempt, fence
FROM invoice_pdf_jobs
WHERE clinic_id = $1 AND (status = 'queued'
  OR (status = 'retry_wait' AND next_attempt_at <= clock_timestamp()))
ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
```

Reread status/timestamps after the lock. The update uses `UPDATE invoice_pdf_jobs AS j SET lease_until=tick.until, deadline_at=tick.until FROM tick`, where `tick AS (SELECT clock_timestamp() + interval '60 seconds' AS until)`, and requires the observed status, attempt and fence plus a fresh due predicate. It separately sets `attempt=attempt+1`, `fence=fence+1`, a generated `lease_token`, `next_attempt_at=NULL`, `error_code=NULL`, and returns all lease fields. No due candidate returns `{ kind: "empty" }` normally and commits completed recovery. Only a selected candidate whose conditional update returns zero rows throws a private `PdfClaimMiss`, rolling back recovery and claim together; the outer catch returns `{ kind: "empty" }`. Unexpected database/trigger errors propagate.

- [ ] **Step 4: Add lock-wait and recovery races**

Using an owner-held row lock, assert `SKIP LOCKED` leaves that candidate unchanged and allows another due row to be claimed; do not make claim wait, since heartbeat/failure own the blocking-lock expiry tests. Cover competing recovery (one retry increment), recovery racing claim (one owner), expired attempts 1/2 scheduling 30/120 seconds, and attempt 3 failing. Assert old tokens cannot heartbeat or fail the replacement. Add one expired running job with no other due job and require its recovery to persist even though the claim answer is empty.

- [ ] **Step 5: Re-run claim tests and commit**

Expected: all claim/recovery tests pass on real PostgreSQL. Commit: `feat(worker): claim fenced PDF jobs`.

### Task 3: Heartbeat and fenced failure

**Files:** create `persistence/pg-pdf-fence.ts` and `__tests__/pdf-job-fence.db.spec.ts`; modify the facade.

- [ ] **Step 1: Write failing heartbeat/failure tests**

Cover stale attempt/fence/token independently, cross-clinic calls, deadline expiry while waiting for an unchanged row lock, the complete `claim → 30s → claim → 120s → claim → failed` sequence, and immediate terminal `invalid_model`, `size_limit` and `cancelled`. `cancelled` clears slot/lease/deadline/scheduling and remains distinct from `failed`.

- [ ] **Step 2: Implement live-fenced writes**

Heartbeat requires the full fence and both `lease_until` and `deadline_at` in the future, then sets `lease_until=LEAST(clock_timestamp()+interval '60 seconds',deadline_at)` without changing the deadline. Failure locks first, rereads the clock, computes the domain outcome, and conditionally updates with the observed retry count. Retry retains the slot; terminal outcomes clear it and stamp cleanup. Every update uses `RETURNING`; zero rows throw `PdfFenceMiss` to roll back, then reread in a new tenant transaction. Return `own_success` only when the persisted attempt/fence, error and outcome exactly match this call; otherwise `lost_lease`.

- [ ] **Step 3: Run unit and DB suites, then commit**

Run the domain test plus both DB files. Expected: green, including post-lock expiry and forced-zero-row rollback. Commit: `feat(worker): fence PDF lease heartbeats and failures`.

### Task 4: Documentation and full verification

- [ ] Append a P4a section to ADR-0038 describing these disabled transitions and explicitly leaving publication/currentness, producers, poller, storage and activation unimplemented.
- [ ] Run `pnpm --filter @eyadex/worker typecheck`, `lint`, `test`, `test:db`, and `build`; all must pass with exact counts.
- [ ] Run Prettier on changed files and `git diff --check`; require no `db/sql`, workflow, `main.ts`, Dockerfile or F3 diff.
- [ ] Run `clean-code-guard`, `test-guard`, and final `requesting-code-review`; fix blocking findings and rerun affected gates.
- [ ] Commit docs as `docs(pdf): record disabled lease lifecycle` and deliver a Draft PR against `T3-CODE/p3b-invoice-pdf-admission`. No merge request or HOLD lift.

## Review verdicts

The first plan delegate returned no plan file, so the orchestrator wrote this fallback. An independent read-only `plan` subagent reviewed the design and then this file; all findings below were accepted and applied before the plan commit.

| #   | Finding                                 | Sev | Verdict | Reason                                                                                              |
| --- | --------------------------------------- | --- | ------- | --------------------------------------------------------------------------------------------------- |
| 1   | Reevaluate clocks after row locks       | P1  | accept  | Fresh reads and conditional writes are required; blocking expiry tests belong to heartbeat/failure. |
| 2   | Expired running cannot renew directly   | P1  | accept  | Recovery uses retry/failed, then a separate claim.                                                  |
| 3   | Enforce three attempts/two retries      | P1  | accept  | The domain policy owns the exact sequence and delays.                                               |
| 4   | Exclude competing recovery/claims       | P1  | accept  | Bounded SKIP LOCKED, CAS and race tests are required.                                               |
| 5   | Fence deadlines and terminal cleanup    | P1  | accept  | Heartbeat is LEAST-bounded; cancelled and failed clear scheduling.                                  |
| 6   | Roll back zero-row writes               | P1  | accept  | Misses roll back; only exact persisted outcomes may be own_success.                                 |
| 7   | Prove tenant isolation as app role      | P1  | accept  | Every operation has a cross-clinic negative test.                                                   |
| 8   | Separate lease/deadline SQL assignments | P1  | accept  | Chained assignment would be a boolean expression.                                                   |
| 9   | Commit recovery with no due candidate   | P1  | accept  | Only a selected-candidate CAS miss rolls recovery back.                                             |
| 10  | Align lock tests with SKIP LOCKED       | P2  | accept  | Claim tests skip; blocking expiry tests remain on fence writes.                                     |
| 11  | Convert driver values to port types     | P2  | accept  | Explicit bigint/number/Date conversion and getTime assertions are required.                         |
