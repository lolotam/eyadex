---
name: eyadex-delivery-loop
description: The orchestrator's standing loop for Eyadex Phase B. Send one slice to Lovable, review it locally, open the lovable → main PR, drive Codex review and CI to green (up to 5 fix rounds, fixes made by the orchestrator), merge, then send the next slice. Use when asked to continue the loop, send the next slice, review a finished Lovable slice, drive or babysit a lovable → main PR, or "follow up on the workflow".
---

# Eyadex delivery loop (orchestrator)

The owner set this loop on 2026-10-06. It refines `CLAUDE.md` §2.1: the orchestrator fixes review findings itself instead of sending them back to Lovable. Everything else in `CLAUDE.md`, `CLAUDE.architecture.md` and `apps/api/AGENTS.md` still applies. Report to the owner in Arabic, briefly, with headings and bullets, and only when something changed.

## The loop

1. **Send one slice to Lovable.** Take the next item of PRD §5.5 (`docs/PRD-Eyadex-MVP.md`).
   - Tool: `mcp__Lovable__send_message` with `wait=false`.
   - Project id: `9e7608f6-156f-498e-b16f-25bd02b66925` (workspace `35ed546d57713f3e7a5c`).
   - Prompt sections, in this order: **Read first** (files, ADRs, PRD sections), **Scope** (numbered), **Tests** (real PostgreSQL + Redis, the PRD §6.3 codes, every negative test must fail with its guard removed), **Hard rules**:
     - next free `db/sql/00NN_*.sql`, never edit applied files;
     - RLS + negative isolation test for every clinic table;
     - no lockfile change;
     - Arabic JSDoc on domain/ports;
     - max 300 lines per file;
     - Prettier on every touched file;
     - `pnpm build:all`, not root `pnpm build`.
   - Backend only unless the slice says otherwise.
   - Tell Lovable about any orchestrator fix since its last slice, so it keeps it.
2. **Review locally when Lovable finishes.** Lovable may say it "couldn't push", but its commit lands on branch `lovable`. Fetch `origin/lovable` into a worktree and read the diff. Run everything with Node ≥ 24:
   - `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint` (0 errors).
   - Per package, one at a time: `pnpm --filter @eyadex/<pkg> test` for **every** package with a `test` script (today `observability`, `db`, `api`, `web`, `auth`, `ids`, `worker`; list them with `grep -l '"test":' apps/*/package.json packages/*/package.json`). A fully parallel `pnpm test` can trip timing tests.
   - `pnpm build:all`.
   - Prettier `--check` on changed non-SQL files.
   - Database: apply `sh db/migrate.sh` to a local PostgreSQL, then run every `db/tests/*.sql` with `psql -v ON_ERROR_STOP=1`. Then `pnpm --filter "@eyadex/api^..." build` and `test:db` for `db`, `api`, `auth`. The `EYADEX_TEST_*_URL` values match `.github/workflows/ci.yml`, with the `ci-only-<role>` passwords: a one-character password breaks the "secret never in the error" assertions.
3. **Open the PR** `lovable → main`.
   - Body: Summary, Local verification (exact counts), Open items, and the PR attribution footer from the session.
   - Comment `@codex review`, then subscribe to the PR's activity.
4. **Drive it to green.** Treat every Codex (`chatgpt-codex-connector[bot]`) finding and every CI failure as a claim to verify.
   - Fix valid ones on branch `lovable`, with merge commits only and never a force-push.
   - Each fix needs a test that fails on the old code; prove it by reverting the source files and running the test.
   - Before the push, reply on each thread with the fix and the commit. Resolve the thread, then comment `@codex review` again.
   - **At most 5 fix rounds per PR.**
   - A finding that is far-fetched or not worth its code gets a reply explaining why, and the owner decides.
   - CodeRabbit (free plan) often posts only a rate-limit notice. That notice is not a finding, but any CodeRabbit inline comment is a claim to verify like Codex's.
5. **Merge.** Merge only when all of these hold:
   - Codex reports no new valid finding;
   - every CodeRabbit inline comment is answered;
   - CI (`verify`, `db`, `api-image`) and both Socket checks are green;
   - the PR is mergeable.

   After 5 rounds:
   - Merge only if what remains is non-blocking (P2 or below, answered on its thread).
   - A valid P1 or security finding still open after 5 rounds: **stop and ask the owner**; never merge it.

   How to merge:
   - Use `merge_method: "merge"`, never squash or rebase, because it breaks Lovable's sync.
   - Then `git fetch origin main lovable`.
   - Check that `origin/lovable` is an ancestor of `origin/main`.
   - Push `git push origin origin/main:lovable` (fast-forward). The fetch matters: the merge happened on GitHub, so the local `origin/main` is stale until fetched.
   - Unsubscribe from the PR.

6. **Loop.** Send the next slice (step 1).

## Stop and ask the owner

- A product decision: `TODO(spec)`, or anything the PRD doesn't settle. Get an independent read-only advisor (a Plan subagent) first and bring its recommendation.
- An architectural change, or a security finding you can't fix confidently.
- Lovable paused on `awaiting_input`.
- A valid P1 or security finding still open after 5 fix rounds.
- Any production action, for example applying `db/sql` to the production database over SSH. Back up first (`pg_dump -Fc` plus roles), run read-only pre-checks, then `migrate.sh --status` / `--dry-run` / apply / `--status`, then the `db/tests` files.

## Before opening each PR, check what Codex usually flags

- A phone number, token or civil ID in an audit snapshot, a log or a test, including inside free-text fields (`apps/api/AGENTS.md` review rules).
- A response field that isn't in its Zod contract.
- A non-idempotent retry: a relative input such as `durationDays`, or a create without `Idempotency-Key`.
- A PRD story that the slice claims but no endpoint serves.
- A count or limit read outside the writing transaction.
