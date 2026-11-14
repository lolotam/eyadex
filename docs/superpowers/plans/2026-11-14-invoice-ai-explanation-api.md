# Invoice AI Explanation — API admission and status

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Approved spec: `docs/superpowers/specs/2026-11-14-invoice-ai-explanation-design.md`. Parent plan: `docs/superpowers/plans/2026-11-14-invoice-ai-explanation.md`.

## Task 4: Register stable bilingual API failures

**Owner:** Orchestrator. **Files:** `apps/api/src/shared/invoice-explanation-messages.ts`, `api-error-messages.ts`, `errors.ts`; tests in existing `shared/__tests__/errors.spec.ts`.

- [ ] Add a table-driven test constructing `new ApiError(code)` for each pair below and checking status and both message strings. Run `pnpm --filter @eyadex/api test src/shared/__tests__/errors.spec.ts`; expected RED for missing catalogue entries.
- [ ] Add the complete map below, spread it into `API_ERROR_MESSAGES`, and add the status entries. Add all six codes to `RULE_ONLY` so a generic framework 429/503 is not accidentally translated to an AI-specific refusal.

| Code | HTTP status if an envelope | Arabic | English |
| --- | --- | --- | --- |
| `ai_not_configured` | 503 | خدمة شرح الفاتورة غير مهيأة حاليًا. | Invoice explanation is not configured. |
| `ai_generation_failed` | 502 | تعذّر إنشاء الشرح. حاول مرة أخرى. | The explanation could not be generated. Try again. |
| `ai_timeout` | 504 | استغرق إنشاء الشرح وقتًا طويلًا. حاول مرة أخرى. | Explanation generation timed out. Try again. |
| `ai_rate_limited` | 429 | وصلت إلى حد طلبات الشرح. حاول لاحقًا. | The explanation request limit was reached. Try later. |
| `ai_busy` | 429 | لديك طلب شرح قيد التنفيذ. انتظر حتى يكتمل. | You already have an explanation in progress. Wait for it to finish. |
| `ai_access_revoked` | 403 | لم يعد الوصول إلى هذه الفاتورة متاحًا. | Access to this invoice is no longer available. |

```ts
import type { ExplanationError } from "@eyadex/contracts/invoice-explanation";
export const INVOICE_EXPLANATION_MESSAGES: Record<ExplanationError, {
  message_ar: string; message_en: string;
}> = {
  ai_not_configured: { message_ar: "خدمة شرح الفاتورة غير مهيأة حاليًا.", message_en: "Invoice explanation is not configured." },
  ai_generation_failed: { message_ar: "تعذّر إنشاء الشرح. حاول مرة أخرى.", message_en: "The explanation could not be generated. Try again." },
  ai_timeout: { message_ar: "استغرق إنشاء الشرح وقتًا طويلًا. حاول مرة أخرى.", message_en: "Explanation generation timed out. Try again." },
  ai_rate_limited: { message_ar: "وصلت إلى حد طلبات الشرح. حاول لاحقًا.", message_en: "The explanation request limit was reached. Try later." },
  ai_busy: { message_ar: "لديك طلب شرح قيد التنفيذ. انتظر حتى يكتمل.", message_en: "You already have an explanation in progress. Wait for it to finish." },
  ai_access_revoked: { message_ar: "لم يعد الوصول إلى هذه الفاتورة متاحًا.", message_en: "Access to this invoice is no longer available." },
};
```

- [ ] Rerun the test and API typecheck. Expected GREEN. Job failures are delivered in a valid HTTP 200 polling response with `status: "failed"`; they are not converted into transport errors. Never attach provider errors as `details` or `cause`.


## Task 5: Build dedicated rate admission behind a billing port

**Owner:** Orchestrator. **Files:** API limit paths from the file map; `identity/index.ts`, `billing/invoice-explanation-providers.ts`.

- [ ] In `apps/api/src/modules/identity/auth/__tests__/invoice-explanation-limit.spec.ts`, use a fake `CounterStore` with count/TTL and instantiate the existing `RateLimiter`. Start with this test; add an independent-member case and a store rejection case. The adapter propagates the rejection internally; the admission boundary replaces it with the existing safe 503 error without its message.

```ts
import { expect, it } from "vitest";
import { RateLimiter } from "../rate-limiter.ts";
import { InvoiceExplanationRateLimit } from "../invoice-explanation-limit.ts";
it("allows five requests and refuses the sixth", async () => {
  const counters = new Map<string, number>();
  const limiter = new RateLimiter({ increment: async (key, windowMs) => {
    const count = (counters.get(key) ?? 0) + 1;
    counters.set(key, count);
    return { count, ttlMs: windowMs };
  } }, "synthetic-rate-test-key");
  const adapter = new InvoiceExplanationRateLimit(limiter);
  for (let hit = 0; hit < 5; hit += 1)
    expect((await adapter.consume("clinic-a", "member-a")).allowed).toBe(true);
  expect(await adapter.consume("clinic-a", "member-a"))
    .toEqual({ allowed: false, retryAfterSeconds: 600 });
});
```

- [ ] Run `pnpm --filter @eyadex/api test src/modules/identity/auth/__tests__/invoice-explanation-limit.spec.ts`; RED until the new adapter is exported/tested. Add the billing port and the identity adapter below. The adapter is bound **only in `billing.module.ts`**, satisfying the existing identity-to-billing adapter boundary; update its architecture row to name this adapter.

```ts
// billing/ports/invoice-explanation-limit.ts
export interface InvoiceExplanationLimit {
  /** يحد طلبات العضو الجديدة؛ فشل Redis يمنع القبول.
   * @param clinicId العيادة @param membershipId العضوية @returns السماح والانتظار بالثواني */
  consume(clinicId: string, membershipId: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}
```

```ts
// identity/auth/invoice-explanation-limit.ts
import type { RateLimiter } from "./rate-limiter.ts";
export class InvoiceExplanationRateLimit {
  constructor(private readonly limiter: RateLimiter) {}
  consume(clinicId: string, membershipId: string) {
    return this.limiter.check("clinic", [{
      route: "invoice-explanation", dimension: "membership",
      value: `${clinicId}:${membershipId}`, limit: { max: 5, windowMs: 600_000 },
    }]);
  }
}
```

- [ ] Export the adapter plus `AUTH_RATE_LIMIT`/`AuthRateLimit` through `identity/index.ts`; bind it using AuthModule's existing Redis connection and lifecycle, never a second unmanaged connection. Add `INVOICE_EXPLANATION_LIMIT = Symbol("billing.InvoiceExplanationLimit")` to billing tokens. Existing Redis options already disable the offline queue and command retries; preserve them.
- [ ] Rerun the targeted tests and `pnpm --filter @eyadex/api test src/shared/__tests__/module-boundaries.spec.ts`. Expected GREEN. Admission tests in Task 7 prove replays and busy refusals bypass `consume`, and real Redis tests prove shared membership limits across API instances.


## Task 6: Implement the tenant request store and atomic admission

**Owner:** Orchestrator. **Files:** `ports/invoice-explanation-store.ts`, `persistence/pg-invoice-explanation-store.ts`, `use-cases/explain-invoice/explain-invoice.ts`, `events/published.ts`, boundary relation list.

- [ ] First create the Task 7 `explanationFixture` and the admission test below it, without the controller implementation. Run `pnpm --filter @eyadex/api test:db src/modules/billing/__tests__/invoice-explanation-admission.db.spec.ts`; expected RED (missing route). Keep that same failing behavior test while implementing Tasks 6–7; do not implement the store before establishing the admission assertion.
- [ ] Define the store port with these exact methods/types. `readForRequester` returns only the polling DTO; it never selects the question. Add Arabic JSDoc to each method in the actual source.

```ts
import type { Tx } from "@eyadex/db";
import type { ExplanationBody, ExplanationStatusResponse } from "@eyadex/contracts/invoice-explanation";
export type QueuedExplanation = ExplanationBody & {
  clinicId: string; id: string; invoiceId: string; requestedBy: string;
  createdAt: Date; expiresAt: Date;
};
export interface InvoiceExplanationStore {
  lockMember(tx: Tx, clinicId: string, membershipId: string): Promise<void>;
  expireActive(tx: Tx, clinicId: string, membershipId: string, now: Date): Promise<void>;
  hasActive(tx: Tx, clinicId: string, membershipId: string): Promise<boolean>;
  insert(tx: Tx, row: QueuedExplanation): Promise<void>;
  readForRequester(tx: Tx, clinicId: string, membershipId: string, invoiceId: string,
    requestId: string, now: Date): Promise<ExplanationStatusResponse | null>;
}
```

- [ ] Implement the SQL methods with bound `sql` parameters under the caller's `withTenant`. The lock name is `invoice_explanation:<clinicId>:<membershipId>`; all admissions take it **before** the ledger claim. SQL kernels:

```ts
await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
  ${`invoice_explanation:${clinicId}:${membershipId}`}, 0))`);
await tx.execute(sql`UPDATE invoice_explanation_requests SET status='failed',
  question=NULL, explanation=NULL, error_code='ai_generation_failed', updated_at=${now.toISOString()}::timestamptz
  WHERE clinic_id=${clinicId} AND requested_by=${membershipId}
    AND status IN ('queued','running') AND expires_at <= ${now.toISOString()}::timestamptz`);
const active = await tx.execute(sql`SELECT 1 FROM invoice_explanation_requests
  WHERE clinic_id=${clinicId} AND requested_by=${membershipId} AND status IN ('queued','running') LIMIT 1`);
```

- [ ] Implement `ExplainInvoice.request(actor, invoiceId, body, key)` with dependencies `{ db, reads, store, limit, clock, ids, append? }`. `reads` is the existing `InvoiceReads`; `append` defaults to `appendOutboxEvent` and permits rollback fault injection. Use this exact orchestration core:

```ts
await this.deps.reads.get(actor, invoiceId);
const normalized = explanationBodySchema.parse(body);
const now = this.deps.clock.now();
const claim = { clinicId: actor.clinicId, scope: `invoice:explain:${actor.membershipId}`,
  key, hash: requestHash({ invoiceId, ...normalized }) };
return this.deps.db.withTenant(actor.clinicId, async (tx) => {
  await this.deps.store.lockMember(tx, actor.clinicId, actor.membershipId);
  const claimed = await claimClinicIdempotencyKey<ExplanationAdmission>(tx, claim, this.deps.ids.newId(), now);
  if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
  if (claimed.kind === "replay") return { replayed: true, answer: explanationAdmissionSchema.parse(claimed.response) };
  await this.deps.store.expireActive(tx, actor.clinicId, actor.membershipId, now);
  if (await this.deps.store.hasActive(tx, actor.clinicId, actor.membershipId)) throw new ApiError("ai_busy");
  const decision = await this.deps.limit.consume(actor.clinicId, actor.membershipId)
    .catch(() => { throw new ServiceUnavailableError(); });
  if (!decision.allowed) throw new ApiError("ai_rate_limited");
  const id = this.deps.ids.newId();
  const expiresAt = new Date(now.getTime() + 3_600_000);
  await this.deps.store.insert(tx, { clinicId: actor.clinicId, id, invoiceId,
    requestedBy: actor.membershipId, ...normalized, createdAt: now, expiresAt });
  await (this.deps.append ?? appendOutboxEvent)(tx, {
    id: this.deps.ids.newId(), clinicId: actor.clinicId, type: EXPLANATION_REQUESTED,
    payload: { requestId: id }, createdAt: now,
  });
  const answer = explanationAdmissionSchema.parse({ request: {
    id, status: "queued", createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
  } });
  await completeClinicIdempotencyKey(tx, claim, answer);
  return { replayed: false, answer };
});
```

- [ ] Use `INSERT` with every named table column; `question` and dates come only from the validated body/injected clock, and `explanation`/`error_code` begin NULL. Add a typed event publisher to `billing/events/published.ts` for the exact event above and call it from admission. Add `invoice_explanation_requests` to `apps/api/src/shared/__tests__/billing-relations.ts`.
- [ ] Checkpoint: no model dependency or `AI_GATEWAY_*` read in API; no patient identity in the ledger response/outbox. The RED/GREEN HTTP tests in the next task validate this store through real runtime-role writes, not an owner-backed substitute.


## Task 7: Prove admission/replay/rollback over HTTP

**Owner:** Orchestrator. **Files:** API fixtures and admission/rollback tests named in the file map; new controller/provider wiring.

- [ ] Create the shared fixture below; reuse existing real-session fixtures rather than inventing fake authentication.

```ts
import { openHarness, closeHarness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { financeClinic, manualInvoice, setPrefixes } from "./billing-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
export async function explanationFixture() {
  const h = await openHarness({}, true);
  const invalidator = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  const C = await financeClinic(h, invalidator);
  await setPrefixes(h, C);
  const patient = await patientIn(h, C, C.branchR);
  const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchR);
  return { h, C, invoice, invalidator, close: () => closeHarness(h),
    post: (cookie: string, key: string, question = "Explain the total", invoiceId = invoice.id) =>
      send(h, cookie, "POST", `/v1/invoices/${invoiceId}/explain`, { question, language: "en" }, key),
    get: (cookie: string, requestId: string, invoiceId = invoice.id) =>
      send(h, cookie, "GET", `/v1/invoices/${invoiceId}/explanations/${requestId}`),
  };
}
```

- [ ] Add this test, using `beforeAll` to assign `f = await explanationFixture()` and `afterAll(() => f.close())`. Run `pnpm --filter @eyadex/api test:db src/modules/billing/__tests__/invoice-explanation-admission.db.spec.ts`; RED: the route does not exist before wiring.

```ts
it("admits 202, replays 200, and emits exactly one ID-only event", async () => {
  const key = crypto.randomUUID();
  const first = await f.post(f.C.admin.cookie, key, " Explain the total ");
  const replay = await f.post(f.C.admin.cookie, key);
  expect([first.statusCode, replay.statusCode]).toEqual([202, 200]);
  expect(replay.json()).toEqual(first.json());
  const { request } = explanationAdmissionSchema.parse(first.json());
  const events = await f.h.owner`SELECT payload FROM outbox_events
    WHERE clinic_id=${f.C.clinicId} AND event_type='finance.invoice_explanation_requested'
      AND payload->>'requestId'=${request.id}`;
  expect(events.map((row) => row.payload)).toEqual([{ requestId: request.id }]);
  const busy = await f.post(f.C.admin.cookie, crypto.randomUUID());
  expect([busy.statusCode, busy.json().code]).toEqual([429, "ai_busy"]);
});
```

- [ ] Add the POST controller using `@Res({ passthrough: true }) reply: FastifyReply`, `@Headers("idempotency-key") key`, `@Body(new ZodValidationPipe(explanationBodySchema)) body`, and the same two access decorators as invoice send. The method body is:

```ts
const result = await this.explain.request(actorOf(request), idOf(id), body, keyOf(key));
void reply.code(result.replayed ? 200 : 202).header("Cache-Control", "no-store");
return result.answer;
```

- [ ] Bind `INVOICE_EXPLANATIONS`, store, `INVOICE_READS`, clock and IDs through `invoice-explanation-providers.ts`; add `InvoiceExplanationsController` and those providers to `BillingModule.forRoot`. Keep cross-module identity adapter construction in `billing.module.ts`. All callbacks receive the existing `DATABASE` provider; do not create another API DB pool.
- [ ] Add cases with fresh fixture membership per case: concurrent same key returns [200,202] and one row/event; different keys for the same membership produce one 202 and one `ai_busy`; changed question/language/invoice produces 409 `idempotency_conflict`; missing key/extra body fields produce 400; clearing a completed job allows another fresh key; five completed requests consume the window, sixth is 429 `ai_rate_limited`; replays at the limit still return 200. Test normalized whitespace replay explicitly.
- [ ] In the rollback test, instantiate `ExplainInvoice` with the real `DATABASE`/`INVOICE_READS` from `h.app`, `new PgInvoiceExplanationStore()`, a deterministic clock, `systemUuidV7()`, and a fake limiter implementing the Task 5 port. Construct the actor from `C.admin` with `view:invoices:clinic` and `{ all: true }`. Fault-inject `append` to throw after INSERT and assert request/ledger/event counts remain zero; retry the same key using the real `appendOutboxEvent` succeeds. Inject limiter failure and assert `ServiceUnavailableError` plus no claimed key. This direct use-case seam preserves real `eyadex_app` SQL and does not require changing the shared HTTP harness. HTTP tests continue to use the real mounted Redis adapter; never clear all Redis keys on a shared server.
- [ ] Rerun admission/rollback DB tests. Expected GREEN under `eyadex_app`; owner is used only for synthetic setup/assertions. Do not mark these tests passed if role URLs/Redis are absent.


## Task 8: Implement requester-only status with current invoice reach

**Owner:** Orchestrator. **Files:** `queries/invoice-explanation-status.ts`, store read, GET controller, `invoice-explanation-access.db.spec.ts`.

- [ ] With the fixture from Task 7, admit as admin then poll as the branch-R desk who can view the same invoice. Assert admin gets 200 and desk gets 404 `not_found`. Add another invoice id and another clinic's real session; both return 404. Run the access DB test; expected RED before GET implementation.
- [ ] Implement `InvoiceExplanationStatus.get(actor, invoiceId, requestId)` with `{ db, reads, store, clock }`: await `reads.get(actor, invoiceId)`, then call `store.readForRequester` inside `withTenant`, parse the strict response, and throw `ApiError("not_found")` for null. The store query is:

```ts
const rows = await tx.execute(sql`SELECT id,status,explanation,error_code,
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at
  FROM invoice_explanation_requests WHERE clinic_id=${clinicId} AND id=${requestId}
    AND invoice_id=${invoiceId} AND requested_by=${membershipId}
    AND expires_at > ${now.toISOString()}::timestamptz`);
```

- [ ] Map only those columns to `{ request: { id,status,explanation,errorCode,createdAt,expiresAt } }`. Add GET `:id/explanations/:requestId` with the same guards, `idOf` on both IDs, and `Cache-Control: no-store`. Bind the query token in the same provider file.
- [ ] Extend the test with clinic/branch/own reach, own across an unassigned branch, another provider's patient, malformed IDs, disabled membership, inactive role, revoked permission, disabled finance, suspended/expired clinic, and expired/missing row. Use existing `serviceAppointment` for own access and invalidator after changes. Compare the status endpoint's refusal with ordinary invoice GET for each same actor/invoice pair.
- [ ] Assert polling with revoked rights cannot return a previously successful result; an expired row returns 404 even before purge. Rerun the access test and route-declaration/module-boundary tests. Expected GREEN; no new permission and no platform route.
