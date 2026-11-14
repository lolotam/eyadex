# Invoice AI Explanation — Worker lifecycle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Approved spec: `docs/superpowers/specs/2026-11-14-invoice-ai-explanation-design.md`. Parent plan: `docs/superpowers/plans/2026-11-14-invoice-ai-explanation.md`.

## Task 12: Add atomic worker claim, prepare, and fenced completion

**Owner:** Orchestrator. **Files:** `ports/invoice-explanation-jobs.ts`, `persistence/pg-explanation-jobs.ts`, `__tests__/explanation-jobs.db.spec.ts`.

- [ ] Define the worker job boundary. It deliberately carries only IDs through the outbox/handoff; content appears only in `prepare` and stays in process memory while generating.

```ts
import type { DispatchOutcome } from "@eyadex/db";
import type { ExplanationError } from "@eyadex/contracts/invoice-explanation";
import type { InvoiceExplanationInput } from "../domain/explanation-input.ts";
export interface ExplanationIdentity { clinicId: string; requestId: string; token: string }
export type ExplanationClaim = { kind: "claimed"; identity: ExplanationIdentity; retryAt: Date }
  | { kind: "settled"; outcome: DispatchOutcome };
export type ExplanationOutcome = { text: string } | { errorCode: ExplanationError };
export interface InvoiceExplanationJobs {
  claim(clinicId: string, requestId: string): Promise<ExplanationClaim>;
  prepare(identity: ExplanationIdentity): Promise<InvoiceExplanationInput | null>;
  finish(identity: ExplanationIdentity, result: ExplanationOutcome): Promise<void>;
}
```

- [ ] Add a real-DB test invoking `claim` concurrently twice. One result is `claimed`; the other is `settled`/`deferred`; the row is running. Before implementing, run `pnpm --filter @eyadex/worker test:db src/invoice-explanations/__tests__/explanation-jobs.db.spec.ts`; expected RED.
- [ ] Implement `claim` inside `withTenant`: SELECT the row `FOR UPDATE`; missing/expired/terminal rows are acknowledged without generation. For a queued row atomically update status and return an exact PostgreSQL timestamp token and retry deadline:

```ts
const [running] = await tx.execute<{ token: string; retry_at: string }>(sql`
  UPDATE invoice_explanation_requests SET status='running', updated_at=clock_timestamp()
  WHERE clinic_id=${clinicId} AND id=${requestId} AND status='queued' AND expires_at>clock_timestamp()
  RETURNING to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS token,
    to_char((updated_at+interval '60 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS retry_at`);
```

- [ ] For existing running rows, compare time in PostgreSQL, not a rounded JS timestamp. Before `updated_at + interval '60 seconds'`, return `deferred` with that deadline. Afterwards UPDATE to failed/`ai_generation_failed`, clear question/answer, and return `dispatched`. Expired active rows follow the same terminal cleanup but are never exposed by status reads. No running row ever transitions back to queued or gets a second model call.
- [ ] `prepare` uses a separate short tenant transaction: verify running status/token/unexpired deadline, load current access and the single-statement authorized invoice snapshot from Task 10, and build the Task 9 input. If access/visibility fails, end that read transaction, then use a short fenced update to fail `ai_access_revoked`; return null. The question never enters the handoff map or log.
- [ ] `finish` uses a short tenant transaction: lock the request row, compare status/token and both expiry/deadline; read current access and invoice visibility again; discard text on revocation. Validate text again with `explanationTextSchema` before writing. Apply this fenced terminal UPDATE using the computed result:

```ts
await tx.execute(sql`UPDATE invoice_explanation_requests SET
  status=${"text" in result ? "succeeded" : "failed"}, question=NULL,
  explanation=${"text" in result ? result.text : null},
  error_code=${"errorCode" in result ? result.errorCode : null}, updated_at=clock_timestamp()
  WHERE clinic_id=${identity.clinicId} AND id=${identity.requestId} AND status='running'
    AND updated_at=${identity.token}::timestamptz AND expires_at>clock_timestamp()
    AND clock_timestamp()<updated_at+interval '60 seconds'`);
```

- [ ] Add the stale-running test: advance stored `updated_at` beyond the deadline; claim again; assert failed/`ai_generation_failed`, NULL question/answer and zero second generations. Run the targeted DB test for GREEN.
- [ ] Add the crash-between-claim-and-handoff test: commit the request claim but skip `afterClaim`; retry after the deadline; assert terminal failure rather than a provider call. Run the targeted DB test for GREEN.
- [ ] Add expiry-during-generation and retention-before-completion cases: neither may publish a result or recreate a deleted row. Run the targeted DB test for GREEN.
- [ ] Add late-completion-after-recovery and access-revocation-before-finish cases: neither may overwrite the failure with success. Assert no partial answer and question NULL in **every terminal path**. Run the targeted DB test for GREEN.


## Task 13: Dispatch only after commit; do not duplicate model calls

**Owner:** Orchestrator. **Files:** `domain/explanation-event.ts`, `handle-explanation-requested.ts`, `explanation-handoff.ts`, `explanation-runner.ts`, their tests.

- [ ] Add event tests using `explanationEventPayloadSchema.safeParse`: correct type+clinic+`{requestId}` accepted; null/malformed clinic, malformed ID, extra `question`, extra invoice data, or wrong event type rejected as `invalid_payload`. Use existing `idSchema` for both IDs.
- [ ] Implement `ExplanationRunner` with jobs and generator ports. It must finish the read transaction before `generate`, and convert every unexpected provider error to a stable code without logging it:

```ts
export class ExplanationRunner {
  constructor(private readonly jobs: InvoiceExplanationJobs,
    private readonly generator: InvoiceExplanationGenerator) {}
  async execute(identity: ExplanationIdentity, signal: AbortSignal): Promise<void> {
    const input = await this.jobs.prepare(identity);
    if (input === null) return;
    let result: ExplanationOutcome;
    try {
      result = { text: await this.generator.generate(input, signal) };
    } catch (error) {
      result = { errorCode: error instanceof ExplanationFailure ? error.code : "ai_generation_failed" };
    }
    await this.jobs.finish(identity, result);
  }
}
```

- [ ] Implement a dedicated handoff class with `canClaim`, `record`, `afterClaim`, `stop`, using local concurrency **1**. Match F3's claim-frame semantics: `canClaim` discards any previous uncommitted frame, `record` copies `{clinicId,requestId,token}` only, `afterClaim` starts the recorded job once, and failed claims never execute a recorded frame. `stop` refuses new work, aborts the active job, and waits for its terminal write before pool shutdown. Do not reuse the export-specific identity type or add this event to the email poller.
- [ ] The handler parses the event, calls `jobs.claim`, and for a claimed identity records it and returns `{kind:"deferred",nextAttemptAt:retryAt}`. For settled claims return their outcome. Invalid event data returns `{kind:"failed",error:"invalid_payload"}`. Database exceptions propagate to the existing dispatcher retry mechanism; catch/log only sanitized codes in the runtime. A retry of a running request uses Task 12's deadline logic, never a second generation.
- [ ] Add the post-commit test below with an `OutboxPoller` whose fake `claimNext` calls the real handler then records `commit`. `jobs` is a fake implementing the port from Task 12; `generate` pushes `model` into the same order array. Define `afterClaim` using the real handoff. Run the test before handoff implementation to see RED, then after to see GREEN.

```ts
const order: string[] = [];
const execute = vi.fn(async () => { order.push("model"); });
const handoff = new ExplanationHandoff(execute);
handoff.canClaim();
handoff.record({ clinicId: "c", requestId: "r", token: "2026-11-14T00:00:00.000001Z" });
expect(execute).not.toHaveBeenCalled();
order.push("commit");
handoff.afterClaim();
await Promise.resolve();
expect(order).toEqual(["commit", "model"]);
await handoff.stop();
```

- [ ] Add rollback/no-`afterClaim`, duplicate `afterClaim`, backpressure, shutdown, thrown execution, and malformed event cases. Add a DB integration barrier that keeps the SDK fake pending and confirms no tenant/dispatcher transaction remains open for this job. Assert duplicate events call the generator exactly once. Run `pnpm --filter @eyadex/worker test src/invoice-explanations/explanation-handoff.spec.ts src/invoice-explanations/explanation-runner.spec.ts`. Expected GREEN; mail poller remains independently runnable.


## Task 14: Wire worker runtime and one-minute retention

**Owner:** Orchestrator; SQL function remains **Migrations lane** ownership. **Files:** `invoice-explanations.ts`, `purge-explanations.ts`, `main.ts`, `packages/db/src/dispatcher.ts`, existing exhaustive retention records/tests.

- [ ] Add `"invoiceExplanations"` to `RetentionTarget` and the fixed statement below to `PURGES`. Keep arbitrary SQL inaccessible on the dispatcher interface:

```ts
invoiceExplanations: (tx, limit) =>
  tx`SELECT purge_expired_invoice_explanations(${limit}::integer) AS deleted`,
```

- [ ] Update `RetentionRun.purged` initialization and exhaustive fixture records with `invoiceExplanations: 0`. Keep the legacy `RETENTION_TARGETS` array unchanged: the dedicated one-minute job owns this target, avoiding duplicate schedulers and avoiding an hourly content-purge delay.
- [ ] Implement `purgeExplanations(outbox)` as a bounded operation, then mount it with `new PeriodicJob(async () => { await purgeExplanations(outbox); }, 60_000)`, enclosing the callback in a stable-code-only error handler. Counts only may be logged; no content/IDs returned from the SQL purge.

```ts
import type { DispatcherOutbox } from "@eyadex/db";
export async function purgeExplanations(outbox: Pick<DispatcherOutbox, "purgeExpired">) {
  let deleted = 0;
  for (let batch = 0; batch < 20; batch += 1) {
    const count = await outbox.purgeExpired("invoiceExplanations", 500);
    deleted += count;
    if (count < 500) return { deleted, backlog: false };
  }
  return { deleted, backlog: true };
}
```

- [ ] Test calls with returned counts [500,2], [0], and twenty full batches. Assert totals 502/0/10000 and backlog false/false/true. A purge failure logs a stable `purge_failed` code only and retries next interval. Check dispatcher alone can execute the function in the real DB test.
- [ ] Implement `createInvoiceExplanations({ env, app, outbox, logger, intervalMs })`: construct jobs, gateway adapter (including null config), runner, handoff, dedicated outbox poller, and purge job. Return `start()` and `stop()`. **Always mount this runtime even with no gateway configuration**, so queued requests become `ai_not_configured` rather than remaining queued. Mount before worker listen/start ordering, and await its stop before DB pools close in `main.ts`.
- [ ] Run worker unit tests, DB tests and `pnpm --filter @eyadex/worker build`. Expected GREEN. Run the existing worker-image boot/shutdown checks without any `AI_GATEWAY_*` variables; `/health` still works and unrelated jobs still run. Verify no main-process fatal configuration error is introduced by this optional feature.
