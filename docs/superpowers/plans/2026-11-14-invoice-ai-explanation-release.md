# Invoice AI Explanation — Acceptance and release

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Approved spec: `docs/superpowers/specs/2026-11-14-invoice-ai-explanation-design.md`. Parent plan: `docs/superpowers/plans/2026-11-14-invoice-ai-explanation.md`.

## Task 20: Add end-to-end privacy, lifecycle, and regression coverage

**Owner:** Orchestrator (Lovable fixes its own web scope). **Files:** the API/worker/web tests already listed; no live gateway in automated tests.

- [ ] Add an integration scenario admitting through the real HTTP API, delivering its ID-only outbox event through the real dispatcher and worker with a deterministic injected generator, then polling through HTTP. Assert 202 → queued/running → succeeded, trimmed answer, NULL stored question, and no invoice/payment/notification changes. The generator receives only the Task 9 DTO and runs after both dispatcher and prepare transactions finish.
- [ ] Add a second scenario with permission revoked after admission but before prepare. Assert zero generator calls and stored `ai_access_revoked`; normal GET/status endpoints refuse under the revoked authorization. Regrant access and verify the requester may see only the failed status while another member still gets 404.
- [ ] Add a third scenario with the fake generator blocked on a promise, revoke access, resolve the promise, and assert completion discards the answer. Then test duplicate outbox events, interrupted worker after running claim, retry at the 60-second deadline, malformed event, stale completion, and expiry/purge. Use injected clocks/fake timers or explicit fixture timestamps, not long sleeps.
- [ ] Add log-leak assertions to existing `h.logs` and a worker logger spy. Synthetic sentinels occupy question, model output, SDK error body, patient/branch names, descriptions, reasons and fake credential input. Expected `JSON.stringify(logs)` contains none of them. Inspect outbox payloads and clinic idempotency responses too. Audit snapshots contain no question/prompt/answer; do not add an administrative audit event that would expose this patient-related activity to the platform.
- [ ] Add a source-boundary check ensuring `from "ai"` and `AI_GATEWAY_` occur only in worker integration/config, the documented environment/runbook, and integration tests. API/web never read the key or call the provider. Assert requests and responses set `Cache-Control: no-store`; web does not persist content. Do not claim this controls the external provider's retention policy: deployment config and owner approval govern that processor.
- [ ] Run the focused checks below in order, with migrated PostgreSQL 18 and Redis supplied by the test environment. Expected: every command exits 0, no tests skipped for missing roles, no unexpected content in logs.

```powershell
pnpm --filter @eyadex/contracts test src/__tests__/invoice-explanation.spec.ts
pnpm --filter @eyadex/db... --filter @eyadex/auth... --filter "@eyadex/api^..." --filter @eyadex/worker... build
pnpm --filter @eyadex/db test:db src/__tests__/schema-drift.db.spec.ts
pnpm --filter @eyadex/api test:db src/modules/billing/__tests__/invoice-explanation-admission.db.spec.ts src/modules/billing/__tests__/invoice-explanation-access.db.spec.ts src/modules/billing/__tests__/invoice-explanation-rollback.db.spec.ts
pnpm --filter @eyadex/worker test src/invoice-explanations
pnpm --filter @eyadex/worker test:db src/invoice-explanations
pnpm --filter @eyadex/web test src/shared/api/http/__tests__/invoice-explanations.test.ts src/shared/api/mock/mock-invoice-explanations.test.ts src/invoices/invoice-explanation-dialog.test.tsx src/invoices/use-invoice-explanation.test.tsx
```

Required database test variables: `EYADEX_TEST_OWNER_URL`, `EYADEX_TEST_APP_URL`, `EYADEX_TEST_AUTH_URL`, `EYADEX_TEST_PLATFORM_URL`, `EYADEX_TEST_DISPATCHER_URL`, `EYADEX_TEST_REDIS_URL`. Use the existing CI `db` job's environment and fixture secrets; no copied production URLs or checked-in credentials.

- [ ] Run the full required gates once the focused checks pass:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @eyadex/db test:db
pnpm --filter @eyadex/api test:db
pnpm --filter @eyadex/worker test:db
$env:NITRO_PRESET = 'node-server'
pnpm build:all
docker build -f apps/api/Dockerfile -t eyadex-api:invoice-ai .
docker build -f apps/worker/Dockerfile -t eyadex-worker:invoice-ai .
git diff --check
```

Expected: typecheck/lint/tests/build/images pass; no whitespace errors. `pnpm build:all` is the workspace build (root `build` builds/copies web output only). Do not run repository-wide formatting to fix this slice. Missing environment/dependency/image capability is a reported unverified gate, not a pass.


## Task 21: Release runbook, migration sequencing, and staged activation

**Owner:** Orchestrator; **Migrations lane owns application/verification of the reviewed migration**. **Files:** `docs/runbooks/invoice-ai-explanation.md`, `CLAUDE.architecture.md`, `roadmap.md`, PRD status. These are future implementation artifacts, not additional files created during planning.

- [ ] Write the runbook with the exact routes, scope/order, five-per-ten-minute and one-active limits, 30-second model timeout, 60-second recovery deadline, one-hour visibility, minute purge cadence/bounded backlog behavior, and stable failures. Document app/worker `eyadex_app` access and dispatcher-only purge. Update the architecture retention exception to include this technical table; it does not authorize deletion of invoices or patient records.
- [ ] Document worker-only `AI_GATEWAY_API_KEY` and `AI_GATEWAY_MODEL`, no default/fallback, no frontend/API key, and no startup failure without configuration. A documented supported example is `openai/gpt-6-astra` from the verified official Gateway integration page; it is **an example for owner selection, not a hard-coded choice or deployment approval**. Owner chooses the actual enabled model, supplies the key through the supported secret channel/Dokploy, approves external processing and budget, and owns Gateway spend/rate alerts. Verify the configured model's language-model support before activation.
- [ ] Document that the input contains allowed invoice-item text/question and exact financial figures, excludes identity/clinical columns, and can still include sensitive text deliberately typed into allowed fields. SDK telemetry is disabled. Confirm the owner's selected Gateway/provider data handling and budget configuration before real-patient activation; never state that the application can guarantee external-provider zero retention.
- [ ] Assemble reviewable patches in dependency order: (A) contracts; (B) Migrations lane schema+mirror+negative tests; (C) API+worker+retention; (D) Lovable web; (E) evidence/runbook. Keep each delivery slice within repository review limits; split if implementation exceeds 5000 changed lines or 100 files. Each schema PR includes its negative tests and remains unpublished until the task's review/PR process authorizes publication. No forced push, amend/rebase/squash of pushed history.
- [ ] **Local/CI first:** run all new migrations on an isolated fresh PostgreSQL 18 database, the existing SQL suite, schema drift, runtime-role API/worker integration tests, and mock/HTTP/UI tests. Prove unconfigured behavior without contacting Gateway.
- [ ] **Staging migration before dependent code:** Migrations lane reviews checksum/status, then runs the following on the approved staging environment. The owner/orchestrator records the exact commit, migration checksum and test result. No app startup migrations.

```sh
sh db/migrate.sh --status
sh db/migrate.sh --dry-run
sh db/migrate.sh
sh db/migrate.sh --status
psql -v ON_ERROR_STOP=1 -f db/tests/rls-isolation.sql
psql -v ON_ERROR_STOP=1 -f db/tests/invoice-explanations.sql
```

Expected: no CHANGED file, only reviewed pending SQL applies, both negative suites roll back successfully, platform has no new grant. If status/permissions fail, stop dependent rollout and report the precise gate; do not retry through another host/connector.

- [ ] **Staging code next:** deploy the worker with handler/purge first, then API with admission/polling, then the HTTP-mode web build at the reviewed head. Worker-before-API prevents accepted jobs waiting on an unavailable handler. Check `/health`, `/health/ready`, and `/v1/health`. Missing Gateway config must yield a completed failed request with `ai_not_configured` while ordinary invoice read/payment/send behavior remains available.
- [ ] **Staging acceptance before merge:** check Arabic and English at 1440px and 390px with clinic/branch/own/no-permission/platform personas. Verify keyboard focus, form validation, active-job disable, closing while queued/running, reopening empty, fresh retry, plain-text result, clipboard feedback, access revocation, and expiry. Use synthetic invoices. With owner-supplied config, run one bounded real generation per language and verify correct configured model/figures. Without it, explicitly record “safe unconfigured path passed; real generation activation unverified.” Do not label that as a successful real AI generation.
- [ ] **Merge/deploy gates remain separate:** resolve blocking reviews/CI and complete real-API staging checks before merging with a merge commit. Because main auto-deploys, Migrations lane must apply/verify the reviewed additive production migration **before** merging code that queries it, or use the deployment hold mechanism already approved for this project. Never merge first and race the production migration against auto-deployment.
- [ ] **Production order:** reviewed migration and negative tests; worker image/retention; API image; HTTP web image; then optional owner-configured activation. Verify health/readiness, one synthetic requester-only flow, worker-only config placement, absence of content in logs/outbox/audit, and expired-row purge counts. No real key in command arguments, reports, chat or screenshots.
- [ ] **Rollback:** disable admission by rolling back API/web to the previous working images, stop new AI work, allow/abort current jobs safely, and retain the additive table/function for cleanup. Do not reverse SQL or delete invoice data; keep a compatible retention worker until expired content is purged. A recovery must never requeue an already-running request for a second provider charge.
- [ ] Remote server work is a later authorized release action. If that host is SSH-Musalam-2, discover the exact `mcp__waleed_mcp_hub__ssh_musalam_2_mcp__*` tools, read `hub://guide` on `waleed-mcp-hub`, and honor its permissions/refresh rules; no standalone/direct SSH fallback. Planning performs no remote calls.
- [ ] Record actual checks, exact implementation head, remaining activation gates and migration receipt; update roadmap/PRD only to the achieved status. Report completion to the owning task manager through the authorized orchestration channel; this plan itself does not authorize sending an unrelated message.

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
