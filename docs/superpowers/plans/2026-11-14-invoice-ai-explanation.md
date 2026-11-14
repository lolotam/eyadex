# Invoice AI Explanation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authorized clinic staff ask a question about an invoice, review a bounded AI explanation in Arabic or English, and copy it without changing or sending the invoice.

**Architecture:** The billing API admits an idempotent request and an ID-only outbox event in one tenant transaction; a separate worker checks current access, projects authorized invoice figures into an explicit allowlist, and calls AI Gateway after the outbox transaction commits. Requester-only polling rechecks invoice visibility on every read, while a forced-RLS technical table retains questions only until completion and results only until their one-hour expiry. Lovable implements the `ApiClient.finance` mock/HTTP adapters and invoice dialog inside `apps/web`; the orchestrator owns contracts/API/worker, and the Migrations lane owns SQL, its Drizzle mirror, and database isolation/retention checks.

**Tech Stack:** TypeScript ESM, Node 24, pnpm 12.5.1/Turborepo, Zod 4, NestJS/Fastify, PostgreSQL 18 forced RLS, Drizzle, Redis, existing PostgreSQL outbox dispatcher, AI SDK 7 `generateText`, Vercel AI Gateway, React/TanStack Start, TanStack Query, react-hook-form, shadcn/ui, Vitest and real PostgreSQL integration tests.

---

## Authority, baseline, and execution boundaries

- Approved specification: `docs/superpowers/specs/2026-11-14-invoice-ai-explanation-design.md`. Baseline: `5d9a426ed871af08ca15e616c6d75b6adb6940a7`, clean tree before this plan was added. Worktree: `C:/Users/waleed_Mohamed/.t3/worktrees/eyadex/invoice-ai-explanation`.
- This delivery is **the plan only**. Do not execute its implementation commands during planning. Do not commit, push, migrate, deploy, install packages, or modify any file besides this plan in the planning phase. The implementation checkpoints below are review checkpoints, not permission to publish this planning work.
- Read `AGENTS.md`, `CLAUDE.md`, `CLAUDE.architecture.md`, `docs/PRD-Eyadex-MVP.md`, `.lovable/plan/marketing-landing.md`, `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, and `packages/db/AGENTS.md`. The approved feature spec supplies this slice's product scope. Marketing files are read-only context.
- Keep implementation files at most 300 lines, with Arabic JSDoc on exported domain functions and port methods. Split tests by behavior when needed. Do not refactor unrelated billing code. This single requested planning document contains the whole cross-lane sequence.
- No new permission, public invoice route, platform invoice access, patient sending, clinical advice, chat history, streaming, tools, HTML renderer, blob storage, or long-term explanation history.
- Commands below run from the named worktree root. PowerShell is the local shell; migration commands run in the approved PostgreSQL test/release environment with `sh` and `psql`. Database URLs are already injected by that environment, never written into this document or echoed.
- Each numbered task is a review unit. Execute each checkbox as a small action, targeting 2–5 minutes; a case matrix means one RED/GREEN iteration per named case, not one large batch of untested implementation. Preserve the explicit RED result before changing behavior, then run the task's exact command for GREEN.

## Verified patterns and decisions

| Concern | Existing source to reuse | Application to this slice |
| --- | --- | --- |
| Invoice authorization | `apps/api/src/modules/billing/use-cases/reads/reads.ts`, `domain/invoice-reach.ts`, `use-cases/invoice-visible.ts` | Call `InvoiceReads.get()` before admission and every status read. Clinic takes precedence over branch, then own; own means a patient with a non-cancelled appointment or any visit with this provider, even across branches. |
| Thin guarded route | `apps/api/src/modules/billing/http/invoice-send.controller.ts`, `http/billing-request.ts` | Both routes declare `@Require("view:invoices:own")` and `@RequiresFeature("finance")`; reuse `actorOf`, `idOf`, `keyOf`. |
| Atomic admission | `apps/api/src/modules/billing/use-cases/report-exports/report-exports.ts`, `shared/clinic-idempotency.ts`, `shared/outbox.ts` | Request, idempotency completion, and outbox insert commit together. Store only admission metadata in the idempotency response, never the question or answer. |
| Live worker access | `apps/worker/src/finance-exports/persistence/pg-export-access.ts` | Read current membership/role/clinic/finance/permissions/active branches without cached authorization. Do not import the API application into the worker. |
| Post-commit execution | `packages/db/src/dispatcher.ts`, `apps/worker/src/shared/outbox-poller.ts`, `finance-exports/handle-export-requested.ts`, `export-handoff-queue.ts` | `claimNext()` invokes its handler **inside the dispatcher transaction**. The handler only records an identity and returns `deferred`; AI starts from `afterClaim`, never inside that handler. |
| Settlement | `db/sql/0068_finance_reports_core.sql`, `finance_invoice_balances` | Read this security-invoker view for paid/owed; do not invent another settlement formula. Compare it with invoice GET in integration tests. |
| Retention | `db/sql/0040_retention.sql`, `packages/db/src/dispatcher.ts`, `apps/worker/src/retention/` | NOLOGIN/NOBYPASSRLS owner, bounded SECURITY DEFINER purge, dispatcher EXECUTE only. No general runtime DELETE. |
| HTTP/mock boundary | `apps/web/src/shared/api/finance-client.ts`, `http/http-invoices.ts`, `mock/mock-finance.ts` | Add two finance methods; screens call `useApi()` only. Keep explanation state out of persisted mock state. |

Implementation choices resolving the spec's mechanical details:

1. Admission always returns the strict metadata shape, initially `queued`; replay returns that original metadata with HTTP 200 even if the worker has since completed. Polling is the sole source of current status. Replay is guaranteed only while the existing clinic idempotency ledger retains the entry (30 days); an expired request returns `not_found` on polling. Clients use a fresh key for later/new work, and no permanent replay is claimed after the ledger purge.
2. Scope the ledger to `invoice:explain:<membershipId>` and hash `{ invoiceId, question, language }` after trimming. Reusing a key for another invoice conflicts too. Replay occurs before busy/rate consumption, but only after current invoice authorization.
3. Use one live request per membership across **all invoices**, protected by a membership advisory lock and a partial unique index. Before checking capacity, terminalize expired queued/running rows with cleared content; retention deletes them separately.
4. Use a dedicated Redis rate rule: five new requests per membership per fixed ten-minute window, HMAC key containing clinic+membership, shared across replicas. Busy refusals and replays do not increment. A Redis failure refuses admission with the existing 503 `ServiceUnavailableError`; an exhausted window returns `ai_rate_limited`. A later SQL rollback can conservatively consume a limiter hit, but cannot leave a request, outbox event, or claimed idempotency key.
5. Use `updated_at` as a durable running-attempt token, preserving its PostgreSQL microseconds as text. A running attempt has a 60-second recovery deadline; the model deadline is 30 seconds. Duplicate deliveries defer until that deadline. A stale running attempt fails `ai_generation_failed` and never calls the model again. Completion compares both status and token, so a late result cannot overwrite recovery.
6. Recheck live access immediately before constructing model input and again before publishing the answer. A job whose access is lost becomes `ai_access_revoked`, with no answer and no question. Every poll independently rechecks access; an HTTP guard can return `forbidden`/`module_disabled`/`subscription_blocked` before the job result is readable.
7. Expiry is exactly creation + one hour. Reads and publication enforce expiry immediately; deletion occurs in bounded periodic batches. Run this purge every minute separately from the legacy hourly ledger purge. A stopped worker delays physical purge but never extends visibility; the runbook must distinguish these facts.
8. Staff questions and line descriptions are intentionally free text. An explicit allowlist prevents accidental inclusion of identity columns; it cannot prove that someone did not type an identifier into an allowed field. Add translated guidance not to enter identity/clinical data; do not claim automatic anonymization or introduce an unapproved content classifier.

Official references verified for this plan: [AI SDK integration and v7 compatibility](https://vercel.com/docs/ai-gateway/sdks-and-apis/ai-sdk), [generateText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text), [Gateway authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok). In SDK 7 use `instructions`, not SDK 6's `system`; use a plain configured model ID, `maxRetries: 0`, a bounded output, and an abort signal. No runtime default model is permitted.

## File map and ownership

All paths below are repository-relative. Test files belong beside their implementation unless explicitly named otherwise.

| Owner | Create | Modify |
| --- | --- | --- |
| Orchestrator: contracts | `packages/contracts/src/invoice-explanation.ts`; `packages/contracts/src/__tests__/invoice-explanation.spec.ts` | `packages/contracts/src/common.ts`; `packages/contracts/src/__tests__/finance-settlement.spec.ts` if its exhaustive catalogue assertion needs the new codes |
| Migrations lane | `db/sql/0077_invoice_explanation_requests.sql`; `db/tests/invoice-explanations.sql`; `packages/db/src/schema/invoice-explanations.ts` | `db/tests/rls-isolation.sql`; `packages/db/src/schema/index.ts` |
| Orchestrator: API | `apps/api/src/modules/billing/ports/invoice-explanation-store.ts`; `ports/invoice-explanation-limit.ts`; `persistence/pg-invoice-explanation-store.ts`; `use-cases/explain-invoice/explain-invoice.ts`; `queries/invoice-explanation-status.ts`; `http/invoice-explanations.controller.ts`; `invoice-explanation-providers.ts`; `apps/api/src/modules/identity/auth/invoice-explanation-limit.ts`; `apps/api/src/shared/invoice-explanation-messages.ts` | `apps/api/src/modules/billing/billing.module.ts`; `ports/tokens.ts`; `events/published.ts`; `apps/api/src/modules/identity/index.ts`; `apps/api/src/shared/errors.ts`; `api-error-messages.ts`; `__tests__/billing-relations.ts`; `CLAUDE.architecture.md` |
| Orchestrator: API tests | `apps/api/src/modules/billing/__tests__/invoice-explanation-fixtures.ts`; `invoice-explanation-admission.db.spec.ts`; `invoice-explanation-access.db.spec.ts`; `invoice-explanation-rollback.db.spec.ts`; `apps/api/src/modules/identity/auth/__tests__/invoice-explanation-limit.spec.ts` | Existing harness only if a narrowly typed injectable limit override is needed; prefer replacing the new limit token before application initialization. |
| Orchestrator: worker | `apps/worker/src/invoice-explanations/domain/explanation-input.ts`; `domain/explanation-event.ts`; `domain/explanation-access.ts`; `domain/explanation-failure.ts`; `ports/invoice-explanation-generator.ts`; `ports/invoice-explanation-jobs.ts`; `gateway-generator.ts`; `explanation-config.ts`; `persistence/pg-explanation-access.ts`; `persistence/pg-explanation-input.ts`; `persistence/pg-explanation-jobs.ts`; `explanation-runner.ts`; `explanation-handoff.ts`; `handle-explanation-requested.ts`; `invoice-explanations.ts`; `purge-explanations.ts` | `apps/worker/src/main.ts`; `apps/worker/package.json`; `pnpm-lock.yaml`; `.env.example`; `packages/db/src/dispatcher.ts`; worker retention count types/fixtures affected by the new `RetentionTarget` |
| Orchestrator: worker tests | `apps/worker/src/invoice-explanations/domain/explanation-input.spec.ts`; `domain/explanation-access.spec.ts`; `gateway-generator.spec.ts`; `explanation-handoff.spec.ts`; `explanation-runner.spec.ts`; `__tests__/explanation-jobs.db.spec.ts`; `__tests__/explanation-access.db.spec.ts`; `purge-explanations.spec.ts` | `apps/worker/src/retention/purge-expired-rows.ts`; `apps/worker/src/retention/__tests__/retention.spec.ts`; `retention.db.spec.ts` for exhaustive target records |
| Lovable: web adapters | `apps/web/src/shared/api/http/http-invoice-explanations.ts`; `http/__tests__/invoice-explanations.test.ts`; `mock/mock-invoice-explanations.ts`; `mock/mock-invoice-explanation-state.ts`; `mock/mock-invoice-explanations.test.ts` | `apps/web/src/shared/api/finance-client.ts`; `http/http-finance.ts`; `mock/mock-finance.ts` |
| Lovable: web UI | `apps/web/src/invoices/invoice-explanation-action.tsx`; `invoice-explanation-dialog.tsx`; `use-invoice-explanation.ts`; `invoice-explanation-dialog.test.tsx`; `use-invoice-explanation.test.tsx`; `apps/web/src/shared/i18n/ar-invoice-explanation.ts`; `en-invoice-explanation.ts` | `apps/web/src/invoices/invoice-page.tsx`; `apps/web/src/shared/i18n/ar.ts`; `en.ts` |
| Orchestrator: release evidence | `docs/runbooks/invoice-ai-explanation.md` | `roadmap.md`; `docs/PRD-Eyadex-MVP.md` §5.6; `CLAUDE.architecture.md` technical-retention exception |

`0077` is the next unused number at this baseline. Migrations lane reserves it before coding; if another migration lands first, that lane renumbers the **unapplied** file and updates references before review. Never rename or edit an applied migration.


## Lane plans

- [Contracts](2026-11-14-invoice-ai-explanation-contracts.md)
- [Database and retention](2026-11-14-invoice-ai-explanation-database.md)
- [API admission and status](2026-11-14-invoice-ai-explanation-api.md)
- [Worker input and AI Gateway](2026-11-14-invoice-ai-explanation-worker-input.md)
- [Worker lifecycle](2026-11-14-invoice-ai-explanation-worker-lifecycle.md)
- [Web adapters and UI](2026-11-14-invoice-ai-explanation-web.md)
- [Acceptance and release](2026-11-14-invoice-ai-explanation-release.md)

## Final coverage and handoff checklist

- [ ] Strict Zod request/admission/status, all six stable codes: Tasks 1, 4, 15, 17.
- [ ] 202 new / 200 replay, normalized conflicts, no claimed key on failed admission, one live membership request and fail-closed limiter: Tasks 5–7.
- [ ] Requester-only current-access polling, unknown/expired/cross-clinic not_found and no-store: Task 8.
- [ ] Forced RLS, composite FKs, status CHECKs, no platform grant, dispatcher-only bounded retention, mirror and negative tests in the same migration PR: Tasks 2–3, 14.
- [ ] Current worker membership/role/clinic/module/branch/own recheck; authoritative settlement, exact decimal strings; no identity in prompt: Tasks 9–10, 12, 20.
- [ ] ID-only outbox, post-commit dispatch, 30-second call, duplicate/crash-safe recovery and fenced publication: Tasks 11–14.
- [ ] AI SDK 7 worker-only, explicit model/key, no fallback, safe failures, disabled content telemetry: Task 11.
- [ ] Mock and HTTP parity; no persistent mock/question/answer storage; close/reopen/copy/fresh retry; Lovable web-only implementation: Tasks 15–19.
- [ ] No invoice attachment, long-term history, public/platform endpoint, or automatic sending: Tasks 19–20.
- [ ] Migration before staging code; staging before merge; production migration before auto-deployment; configured/unconfigured acceptance reported accurately: Task 21.

The next implementation owner follows this ordered plan and its lane boundaries. The planning handoff contains only this document; implementation, tests, migration application, commit, push and deployment have not been performed by the design sub-agent.

## Independent plan review — round 1

OpenCode Zai GLM 5.3 was selected, but repeated `delegate_task` attempts failed with `parent_not_active` after the provider handoff. MergePilot reviewed head `57d4066a933ca1d8ef317a418e5e58b8c257aff2` as the disclosed independent substitute; Codex completed the same head with no major issues. The 1149-line plan was split into the linked lane documents above, each below the 300-line file limit.

| # | Finding | Sev | Verdict | Reason |
|---|---------|-----|---------|--------|
| 1 | Secret detected in worker handoff example | P1 | reject | The cited value is the synthetic timestamp `2026-11-14T00:00:00.000001Z`, not a credential; no secret is present. |
| 2 | Plan exceeded the 300-line file limit | P2 | accept | Split contracts, database, API, worker input/lifecycle, web and release into linked files, each below 300 lines. |
| 3 | Replay conflicted with bounded ledger retention | P2 | accept | Replay is now guaranteed only during the existing 30-day ledger retention; later/new work requires a fresh key and expired jobs return `not_found`. |
| 4 | Void status was absent from model input | P2 | accept | Added `status` to the allowlisted DTO; void uses no settlement and the prompt explicitly says cancelled/no payment due, without sending void reason. |
| 5 | Hook conflicted with the error-helper contract | P2 | reject | `errorKeyOf(error)` exists and returns the catalogued code at `apps/web/src/shared/api/api-error.ts:49`; the contract change adds the new codes to that catalogue. |

Implementation may proceed on the corrected linked plans. Runtime code, migration rehearsal, staging evidence and deployment checks remain required.
