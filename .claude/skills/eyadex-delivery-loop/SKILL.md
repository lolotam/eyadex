---
name: eyadex-delivery-loop
description: The orchestrator's standing loop for Eyadex Phase B. Send one small slice to Lovable, review it locally, open the lovable → main PR, drive the review bots and CI until no blocking finding is left (up to 3 fix rounds, fixes made by the orchestrator), merge, then send the next slice. Use when asked to continue the loop, send the next slice, review a finished Lovable slice, drive or babysit a lovable → main PR, or "follow up on the workflow".
---

# Eyadex delivery loop (orchestrator)

The owner set this loop on 2026-10-06 and tightened it on 2026-10-17 (small slices, 3 rounds, blocking-only merges), after PR #78 (F1 finance, +19k lines in 320 files) took nine review rounds and more than a day while Lovable had written its web part in under an hour. It refines `CLAUDE.md` §2.1: the orchestrator fixes review findings itself instead of sending them back to Lovable. Everything else in `CLAUDE.md`, `CLAUDE.architecture.md` and `apps/api/AGENTS.md` still applies. Report to the owner in Arabic, briefly, with headings and bullets, and only when something changed.

## The loop

1. **Send one slice to Lovable.** Take the next item of PRD §5.5 (`docs/PRD-Eyadex-MVP.md`).
   - **Size the slice first.** A module is never one PR. Split it into numbered sub-slices (`F1a`, `F1b`, …), each one user story or one screen group with its own PR to `main`:
     - aim for about 3,000 changed lines and 60 files; above 5,000 lines or 100 files, split again before sending;
     - each sub-slice is vertical in its PR: its contract, SQL, API and web together, not "all the API" then "all the web". Who writes which part follows the brief: the orchestrator (or Codex) lands the contract, SQL and API for the sub-slice on `lovable` first, and Lovable builds only the web part on top of it, as `AGENTS.md` keeps Lovable frontend-only;
     - order the sub-slices so each one merges and deploys on its own (an additive SQL file first, a destructive one only after the code that stops depending on it has shipped).
   - **Settle the product rules before Lovable starts.** Have a read-only Plan subagent list every rule the slice touches that the PRD or spec does not settle (who may see what, which branch scope applies, what happens on a no-show, duplicates, retries). Ask the owner all of them in one batch, write the answers into the spec, then send the brief. A rule question in the middle of review rounds costs a round.
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
   - Tell Lovable to read `.lovable/review-lessons.md` before writing and to tick its checklist before it reports done.
2. **Review locally when Lovable finishes.** Lovable may say it "couldn't push", but its commit lands on branch `lovable`. Fetch `origin/lovable` into a worktree and read the diff. Run everything with Node ≥ 24:
   - `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint` (0 errors).
   - Per package, one at a time: `pnpm --filter @eyadex/<pkg> test` for **every** package with a `test` script (today `observability`, `db`, `api`, `web`, `auth`, `ids`, `worker`; list them with `grep -l '"test":' apps/*/package.json packages/*/package.json`). A fully parallel `pnpm test` can trip timing tests.
   - `NITRO_PRESET=node-server pnpm build:all`: the preset CI and Dokploy build. Without it Nitro builds its default target, not the deployed node server.
   - Prettier `--check` on changed non-SQL files.
   - Database: apply `sh db/migrate.sh` to a local PostgreSQL, then run every `db/tests/*.sql` with `psql -v ON_ERROR_STOP=1` and the runner self-test `sh db/tests/migrate-runner.sh`, as the CI `db` job does. Then `pnpm --filter "@eyadex/api^..." build` and `test:db` for `db`, `api`, `auth`. The `EYADEX_TEST_*_URL` values match `.github/workflows/ci.yml`, with the `ci-only-<role>` passwords: a one-character password breaks the "secret never in the error" assertions.
3. **Open the PR** `lovable → main`.
   - Body: Summary, Local verification (exact counts), Open items, and the PR attribution footer from the session.
   - Comment `@codex review` and `@mergepilot review`, then subscribe to the PR's activity.
   - Before opening it, run a local Codex review of the diff (`codex-delegate` or the Codex CLI) and fix what it finds in one batch, so the PR opens with the obvious findings already gone.
4. **Drive it to green.** Treat every bot finding (Codex `chatgpt-codex-connector[bot]`, MergePilot `mergepilot-review[bot]`, CodeRabbit) and every CI failure as a claim to verify.
   - **Sort each valid finding before fixing anything:**
     - **Blocking** — holds the merge: a P0/P1; anything that lets a user read or change data outside their permission or branch scope; patient data reaching the platform; wrong money, duplicate charges or lost records; a broken migration or release order; a secret in code, logs or tests; a CI failure; a breach of `CLAUDE.md` §11.
     - **Non-blocking** — never holds the merge: P2 or lower UX, wording, structure, docs, mock-only parity that the API already enforces, refactors. Reply on the thread "Deferred to the follow-up PR after merge (owner policy 2026-10-17)" and add it to the PR body's **Follow-ups** list.
     - **Product rule** — the spec does not settle it: answer what the code does today, then ask the owner (see "Stop and ask"); it never starts a fix round by itself.
   - A round fixes every open blocking finding plus any non-blocking one that costs a few lines in a file the round already touches. Nothing else.
   - Fix valid ones on branch `lovable`, with merge commits only and never a force-push.
   - Each fix needs a test that fails on the old code; prove it by reverting the source files and running the test.
   - Order, every round: reply on each thread with the fix and the commit, then **push**, then resolve the threads, then comment `@codex review`. Request the review only after the push, so Codex reads the new head; check the summary's "Reviewed commit" against the head before trusting a clean review.
   - MergePilot is slow (40 minutes to hours). Request it when the PR opens and once more on the merge candidate; do not wait for it between rounds, and do not hold a merge more than 60 minutes for it.
   - Run the local gates on the packages the round touched; leave the full database suites to CI, which runs them on a fresh database.
   - **At most 3 fix rounds per PR.**
   - A finding that is far-fetched or not worth its code gets a reply explaining why; it is non-blocking unless it is a security finding.
   - CodeRabbit (free plan) often posts only a rate-limit notice. That notice is not a finding, but any CodeRabbit inline comment is a claim to verify like Codex's.
5. **Merge.** Merge only when all of these hold:
   - Codex has finished its review of the current head (its summary's "Reviewed commit" is the head), so the last round's fixes were reviewed;
   - no blocking finding is open (non-blocking ones are answered on their threads and listed under **Follow-ups**);
   - every bot inline comment is answered;
   - CI (`verify`, `db`, `api-image`, `worker-image`) and both Socket checks are green;
   - the PR is mergeable.

   A clean bill from every bot is not required: new non-blocking findings on the last round do not hold the merge.

   After 3 rounds:
   - Merge if what remains is non-blocking.
   - A blocking finding still open after 3 rounds: **stop and ask the owner**; never merge it.

   Right after the merge, open one follow-up PR (or a session for it) with the PR's **Follow-ups** list, and add any Lovable-side lesson from this PR to `.lovable/review-lessons.md`.

   A MergePilot review that lands after the merge is still read: stay subscribed to the PR until it arrives and sort its findings with the same rules. A blocking one gets an immediate hotfix PR (or a rollback, ADR-0021), and the owner is told the same hour; non-blocking ones join the follow-up PR.

   How to merge:
   - Use `merge_method: "merge"`, never squash or rebase, because it breaks Lovable's sync.
   - Then `git fetch origin main lovable`.
   - Check that `origin/lovable` is an ancestor of `origin/main`.
   - Push `git push origin origin/main:lovable` (fast-forward). The fetch matters: the merge happened on GitHub, so the local `origin/main` is stale until fetched.
   - Unsubscribe from the PR once every requested bot review of the merged head has arrived and been sorted.

6. **Loop.** Send the next slice (step 1).

## Stop and ask the owner

- A product decision: `TODO(spec)`, or anything the PRD doesn't settle. Get an independent read-only advisor (a Plan subagent) first and bring its recommendation.
- An architectural change, or a security finding you can't fix confidently.
- Lovable paused on `awaiting_input`.
- A blocking finding still open after 3 fix rounds.
- A slice that cannot be split under the size limit (step 1).
- Any production action, for example applying `db/sql` to the production database over SSH. Back up first (`pg_dump -Fc` plus roles), run read-only pre-checks, then `migrate.sh --status` / `--dry-run` / apply / `--status`, then the `db/tests` files.

## Before opening each PR, check what Codex usually flags

- A phone number, token or civil ID in an audit snapshot, a log or a test, including inside free-text fields (`apps/api/AGENTS.md` review rules).
- A response field that isn't in its Zod contract.
- A non-idempotent retry: a relative input such as `durationDays`, or a create without `Idempotency-Key`.
- A PRD story that the slice claims but no endpoint serves.
- A count or limit read outside the writing transaction.
