# Handoff: Eyadex Phase B orchestration (after slice 6)

Written 2026-10-06, updated 23:45 UTC (final state of this session). Repo `lolotam/eyadex`. The user writes in Arabic and wants replies in Arabic: short, honest, headings and bullets. Ask when something is unclear.

## 1. Your role and the delivery loop the user set

You orchestrate Phase B of the PRD (`docs/PRD-Eyadex-MVP.md` §5.5 slice order). Lovable writes each slice; you review, open the PR, fix review findings and merge. The user's standing rule:

1. Send one slice to Lovable (`mcp__Lovable__send_message`, `wait=false`). The prompt has sections **Read first / Scope / Tests / Hard rules**. Slices are backend only unless the slice says otherwise. Copy the style of the slice 4–6 prompts in the Lovable chat (`list_messages`).
2. When Lovable finishes (it reports "couldn't push", but its commit does land on branch `lovable`), fetch `origin/lovable`, review the diff, and run all checks locally (see §5).
3. Open the PR `lovable → main` with three sections: summary, local verification, open items. End the body with the PR attribution footer. Comment `@codex review`, then call `subscribe_pr_activity`.
4. Verify every Codex (`chatgpt-codex-connector[bot]`) finding and every CI failure. Fix the valid ones **yourself** on branch `lovable`, validated locally first, with a test that fails on the old code. Reply on each thread and resolve it, then comment `@codex review` again. **Max 5 fix rounds per PR.** The user chose this over sending fixes back to Lovable, which CLAUDE.md §2.1 suggests.
5. Merge when Codex has no new valid findings (or 5 rounds are used) AND CI is green AND the PR is mergeable. Use `merge_method: "merge"`, never squash or rebase. Then `git push origin origin/main:lovable` (fast-forward) and unsubscribe from the PR.
6. Send the next slice and loop.

Stop and ask the user on a product decision (`TODO(spec)`), an architectural change, a security finding you can't fix confidently, or Lovable `awaiting_input`. The user also likes an independent "advisor" (a Plan subagent that only reads files) before production actions and product decisions.

Watcher: in the old session a CronCreate job ran this loop every 5 minutes. It dies with that session. Recreate one (`/loop 5m …` or CronCreate) if the user wants it. Report only when something changes, Eyadex only.

## 2. Where things stand

**The loop is now in the repo:** `.claude/skills/eyadex-delivery-loop/SKILL.md`, with `CLAUDE.md` §2.1 pointing to it (V1.1). Load that skill first; it supersedes §1 above wherever they differ.

| Slice (PRD §5.5)                                                                                                                         | PR                                                                                   | State  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| 1–3b (tenancy, identity/Better Auth, rate limit, outbox, create clinic, accept invitation)                                               | ≤ #32                                                                                | merged |
| 4: AccessGuard + access declarations, versioned Redis cache, `/v1/me`, `/v1/roles`, catalogue (ADR-0009, SQL 0027)                       | https://github.com/lolotam/eyadex/pull/33                                            | merged |
| 5: feature flags, platform subscription/limits/detail, `ClinicLimits` (ADR-0010)                                                         | https://github.com/lolotam/eyadex/pull/34                                            | merged |
| 6: branches CRUD, advisory-lock limit, OD-7, `clinic_idempotency_keys`, audit phone masking, platform branches read (ADR-0011, SQL 0028) | https://github.com/lolotam/eyadex/pull/35                                            | merged |
| Workflow skill + follow-up                                                                                                               | https://github.com/lolotam/eyadex/pull/36, https://github.com/lolotam/eyadex/pull/37 | merged |

- `main` = `lovable` = `a726682`. There are no open PRs and no Lovable task in flight.
- **Production DB:** 0001–0028 are applied and verified (`membership-lookup`, `branch-contact` and `rls-isolation` pass on production).
  - Backup: `/root/backups/eyadex-pre0027-2026-10-06_2323.dump` plus `roles-pre0027-2026-10-06_2323.sql` on server `musalam-2`.
  - The `db/` folder used was Dokploy's checkout at `/etc/dokploy/applications/app-parse-virtual-system-ayw2vk/code/db` (commit `203ad90`). It was copied into the Postgres container at `/tmp/eyadex-db-203ad90`.
  - Lessons from the SSH MCP:
    - Commands with `rm -rf` and `sftp-upload` hit an approval gate and time out after 60 s, so avoid them.
    - Keep each command under 60 s; run the long SQL tests one per call.
- **Codex quirk:** don't write `@codex review` inside a review-thread reply. Codex treats it as a task and answers "create an environment". Request reviews only in a top-level PR comment.

## 3. Pending one-offs, in order

### 3a. DONE: SQL 0027 + 0028 applied to PRODUCTION (kept for reference on the next migration)

The user approved this. Production facts:

- Server: SSH MCP `ssh-musalam-2-mcp`, profile `musalam-2`.
- Postgres 18 container: name starts with `eyadexcom-eyadex-dn2tcg`. Find it with `docker ps`.
- DB `eyadex`, owner user `eyadex`. Ledger table: `public.schema_migrations`. 0001–0026 should be applied.
- The **API/worker are NOT deployed in production**; only the web container (`eyadexcom-eyadex-v907db…`) runs. So the migration is not urgent.
- The old session's auto-mode classifier once refused "production reads". The user has since approved explicitly. Still confirm before running writes if a tool asks.

Advisor procedure:

1. **Backup:**
   - `docker exec <ctr> pg_dump -U eyadex -Fc eyadex > ~/backups/eyadex-pre0027-<ts>.dump`
   - `pg_dumpall -U eyadex --roles-only > ~/backups/roles-pre0027.sql`
   - Verify the dump with `pg_restore -l`.
2. **Read-only pre-checks:**
   - The migrate user is a superuser: `rolsuper` in `pg_roles`. If it is not, FORCE RLS hides rows and the duplicate check below lies.
   - The ledger holds exactly 0001–0026.
   - `SELECT user_id, count(*) FROM memberships GROUP BY 1 HAVING count(*)>1` → 0 rows. 0027 adds a unique index on `memberships(user_id)`.
   - `eyadex_app`, `eyadex_auth` and `eyadex_platform` exist.
   - Role `eyadex_membership_lookup_owner` is absent, or NOLOGIN with no members.
   - These are all NULL or absent: `to_regclass('public.memberships_user_unique')`, `to_regprocedure('public.membership_clinic_for_user(uuid)')`, columns `branches.address`/`branches.phone`, table `clinic_idempotency_keys`, policy `clinic_idempotency_keys_tenant_isolation`.
   - `pg_default_acl` is empty.
3. **Apply:**
   - Copy the reviewed `db/` folder at `main` into the container: `docker cp db <ctr>:/tmp/eyadex-db`.
   - `PGUSER=eyadex PGDATABASE=eyadex sh migrate.sh --status`, then `--dry-run`. Expect only 0027 and 0028 pending.
   - Apply with `PGOPTIONS='-c lock_timeout=5s'`, then run `--status` again.
4. **Test:** run `db/tests/membership-lookup.sql`, `db/tests/branch-contact.sql` and `db/tests/rls-isolation.sql` with `psql -v ON_ERROR_STOP=1`. They roll back.
5. **Report** to the user.

Each file plus its ledger row is one transaction. If 0028 fails, 0027 stays applied: fix the cause and rerun.

### 3b. Slice 7 prompt: users and invitations (PRD stories 35–44, ADM-01, SUB-03 users, INV)

Besides the normal scope (invite with role and branches, resend/cancel, list with filters, change role and branches, deactivate/reactivate with immediate session revoke via the `MemberSessionRevoker` port, the last-admin rule ADM-01, the user limit checked **inside** the transaction under the clinic advisory lock the way slice 6 does it), include:

- **ADR-0011 `TODO(spec)` resolved as option (b)** (user and advisor agreed):
  - Branches expose `exclusiveMemberCount`: active, non-`all_branches` members whose only active branch is this one.
  - `POST /v1/branches/:id/deactivate` returns 409 `branch_has_exclusive_members {count, members:[{id,name}]}` unless the body has `confirmStrandedMembers: true`.
  - The count runs in the same transaction under the clinic lock.
  - The OD-7 `last_active_branch` check comes first, and a no-op still returns 200.
  - The audit row records `strandedMemberCount`.
- **Close the slice-6 test gap:** a role holding only `view:branches:clinic` must be refused `reactivate` (and the other writes).
- **Invitation email sending** (worker dispatch of `clinic.admin_invited` / invite events) is still not built. **The user has not answered** whether it belongs to slice 7 or a separate worker slice. Ask before sending slice 7.

### 3c. After slice 7: the "web wiring" slice (user agreed)

- Add an HTTP `ApiClient` adapter **next to** the in-memory mock, chosen by env. **Do not delete the mock**: tests and the Lovable preview need it (PRD §5.4).
- Deploy `apps/api` (and the worker) on Dokploy (ADR-0007 image).
- Route `/api` from `app.` and `platform.` to the API (open roadmap item).
- Then switch screens whose API is ready: session/`me`, roles read, platform flags/subscription/limits/branches, clinic branches.
- Then continue §5.5: 8 custom roles → 9 patients → 10 audit read → 11 settings and expiry alert → 12 staging.

## 4. Decisions and facts to keep

- **Lovable:**
  - Project `9e7608f6-156f-498e-b16f-25bd02b66925`, now in workspace **"DR's Lovable"**, id `35ed546d57713f3e7a5c`. The user moved it from `waleed's#MAIN#`.
  - Lovable syncs both ways with branch `lovable`. Its own sandbox runs Node 22 and PG17, so it can't run `build:all` and never runs PG18.
- **Product decisions taken:**
  - `durationDays` on the subscription PATCH needs `Idempotency-Key`.
  - Branch create requires `Idempotency-Key`.
  - Clinic idempotency lives in its own RLS table `clinic_idempotency_keys`, not the platform `idempotency_keys`.
  - The branch lock is `pg_advisory_xact_lock`, not `clinics FOR UPDATE`, because `eyadex_app` has no UPDATE on `clinics`.
  - Audit snapshots never hold a full phone (AGENTS.md review rule).
- **Codex review style:** Codex reliably flags phones/secrets in audit snapshots, contract drift (undeclared response fields), non-idempotent retries and missing PRD stories. Check those yourself before opening each PR.
- **Prettier:** run it on every touched file, including Markdown ADRs. CI doesn't enforce it, but the repo rule does.

## 5. Local environment (cloud container, may be gone in a new session)

- **Node 24 is required** (`engines`). The old session put it at `/tmp/claude-0/n24/node-v24.21.0-linux-x64/bin`. In a fresh container:
  - Download `latest-v24.x` linux-x64 from nodejs.org and verify the SHA256.
  - Put it on PATH, then `corepack enable`. pnpm pin is 12.x (CI uses 12.5.1).
- **Review worktree:** `git worktree add ../eyadex-review origin/lovable`, then `pnpm install --frozen-lockfile`.
- **Local DB for `test:db`:**
  - Use the PG16 binaries in `/usr/lib/postgresql/16/bin`. initdb as user `postgres` into `/var/tmp/eyadex-pg` (not under `/tmp/claude-0`, which `postgres` can't access), `-U eyadex_owner --auth=trust`, port 5432.
  - `CREATE DATABASE eyadex`.
  - Create roles `eyadex_{app,auth,platform,dispatcher}` LOGIN NOBYPASSRLS, the same as the CI step in `.github/workflows/ci.yml`.
  - `sh db/migrate.sh`.
  - Start Redis with `redis-server --daemonize yes`, then `config set dir /var/tmp` and `save ""`, or a `dump.rdb` lands in the repo and trips the stop hook.
- **Test env:**
  - `EYADEX_TEST_{OWNER,APP,AUTH,PLATFORM}_URL=postgres://eyadex_<role>:ci-only-<role>@localhost:5432/eyadex`
  - `EYADEX_TEST_REDIS_URL=redis://localhost:6379/0`
  - Use the `ci-only-*` passwords. A one-character password like `x` makes three `packages/db` tests fail because they assert the password never appears in error text.
- **Build first:** `pnpm --filter "@eyadex/api^..." build` before `pnpm --filter @eyadex/api test:db`. The API consumes workspace packages from dist.
- **Full check list:**
  - `pnpm typecheck`, `pnpm lint` (10 web warnings are pre-existing), `pnpm build:all`. Root `pnpm build` is web only.
  - Per-package `pnpm --filter @eyadex/<p> test` for observability/db/api/web.
  - `test:db` for db/api/auth.
  - `psql -f` for every `db/tests/*.sql`.
  - Prettier check on changed files.
- **Flaky warning:** a fully parallel `pnpm test` can fail observability timing tests. Hardened in PR #33 with best-of-3. Run packages one at a time if it reappears.
- **Git:**
  - Commits end with the attribution lines from the session system prompt.
  - Never force-push `lovable`/`main`.
  - The session's own branch `claude/clever-wozniak-r0o1nm` was not used for slice work. Fixes go on `lovable`, as the user authorised.

## 6. Open questions for the user

- Should invitation email sending go into slice 7 or a separate worker slice?
- Recreate the 5-minute watcher in the new session? The old one was cancelled when this session stopped.

## 7. Suggested skills

- `loop`: recreate the 5-minute watcher/delivery loop.
- `anthropic-skills:pospay-code-rules` and `anthropic-skills:pospay-api-endpoint`: PosPay is the engineering reference (PRD §4.2). Use them for endpoint shape (one access declaration, idempotency, one transaction + outbox, cursor pagination) when writing slice prompts or fixing findings. **This repo wins where they disagree.**
- `anthropic-skills:pospay-drizzle-tenant-table`: any new clinic table, which needs RLS, the Drizzle mirror and a negative isolation test in the same PR.
- `code-review` / `security-review`: pre-review a slice before opening its PR, to catch what Codex usually flags.
- `anthropic-skills:grilling`: pressure-test a product `TODO(spec)` with the user before deciding.

## 8. Update 2026-10-07 (local Windows session took over)

- The §6 questions are answered: invitation email sending is its **own worker/notifications slice
  right after slice 7** (slice 7 only writes outbox events), and the local session now runs the loop.
- Slice 7 was sent to Lovable on 2026-10-07 with the §3b items (ADR-0011 option (b), the slice-6
  test gap) and the dispatcher send-time rule (send only a pending, unexpired invitation whose
  `token_hash` matches the opened token).
- §5 no longer applies: the review now runs on Windows in Docker with the CI images
  (`postgres:18-alpine`, `redis:8-alpine`, `node:24-bookworm`). Export `db/` with
  `git -c core.autocrlf=false archive`, or the shell scripts arrive with CRLF and fail.

## 9. Update 2026-10-07 (after PR #40)

**Merged since §8** (each through the full loop: local Docker review, Codex until clean, merge
commit, `lovable` fast-forwarded to `main`):

- #38 slice 7, users and invitations. 6 review rounds; round 6 was an advisor-approved extra.
  The owner's rules: only an active clinic admin grants or touches the clinic-admin role; every
  time-based decision (expiry, seats, clinic access, a new link's expiry) reads the clock after the
  last lock (ADR-0012 §16); acceptance takes the branches lock.
- #39 slice 7a, copy invitation link: `POST /v1/invitations/:id/link` rotates like resend, returns
  the token once, audits `invitation.link_copied`, sends no email (ADR-0012 §6).
- #40 slice 7b-1, the worker dispatches invitation emails through Resend (ADR-0013):
  - migration 0029 adds the retry columns;
  - the `eyadex_dispatcher` pool touches the outbox only;
  - the send-time check reads the invitation through `eyadex_app` under `withTenant` and keeps the
    row `FOR SHARE` until the send returns;
  - `@eyadex/secrets` now holds `SecretSealer`.

  **Production has NOT had 0029 applied**, and the worker is not deployed.

**Owner decisions (2026-10-07):**

- **Pending invitations whose branches all get deactivated are auto-cancelled** by a worker job
  (slice 7b-2). Branch deactivation emits an outbox event and the worker cancels, releases the email
  hold and audits.
  - `audit_log.actor_user_id` is NOT NULL and there is no system actor.
  - Proposed: audit as the admin who deactivated the branch, with the reason.
- **Mail providers:** the platform and each clinic will have both Resend and SMTP. Slice 7c adds
  platform SMTP and per-clinic providers behind the `MailSender` port, with encrypted credentials
  and its own ADR. Before that, ask the owner how Resend and SMTP relate (fallback or choice) and
  which emails use a clinic's provider.
- **After a PR's 5 fix rounds, the `advisor` decides** what to do with remaining findings; never
  merge an open P1 without it.

**Next, in order:**

1. 7b-2 auto-cancel.
2. 7c SMTP / per-clinic providers.
3. Web-wiring + deploy slice: HTTP `ApiClient`, Dokploy services for api and worker, apply 0029 on
   production with a backup first, the worker's secrets.
4. Resend webhook `POST /v1/webhooks/resend`, after the deploy; secret `RESEND_WEBHOOK_SECRET`.
5. PRD §5.5 items 8–12.

**Local state:**

- The owner's keys are in the gitignored `.env` (`RESEND_API_KEY`, `MAIL_FROM`, `SMTP_*`; the SMTP
  password is still missing). Never copy key values into chat or the repo.
- The owner pastes secrets into Dokploy themselves.
- `eyadex.com` in Resend is still verifying: DKIM is published; `send.` points at `rmta.net`; DMARC
  is missing; the root MX points at Resend inbound.
- **Review helpers:**
  - Docker containers `eyx-pg` and `eyx-redis` run on network `eyadex-review`.
  - The worker `test:db` needs `psql`; install `postgresql-client` in `node:24-bookworm` (CI
    runners have it).
- Lovable's sandbox re-adds `bun.lock`; it is now gitignored.

## 10. Update 2026-10-07 (after PR #41)

**Merged:** #41, slice 7b-2 (`4e4e1da`).

What it does:
- Branch deactivation emits `clinic.branch_deactivated`.
- The worker cancels pending invitations on that branch that have no active branch left. It releases the email hold and audits the cancellation as `invitation.auto_cancelled`, with the deactivating admin as actor (ADR-0013 §12).

Five fix rounds:
1. The audit catalogue and the labels for the new action.
2. A send-time check that the invitation still has an active branch, so a backlog never mails a dying link.
3. The invitation's branch rows held `FOR SHARE` through the send.
4. A superseded deactivation (reactivated afterwards) is skipped, and cancellation is scoped to the event's branch.
5. `deactivatedAt` read after the branches lock.

A 6th P2 was waived by the advisor and recorded in ADR-0013 §12 as a known limitation: multi-branch attribution in a backlog.

**Owner decisions on mail providers (2026-10-07):**
- **Platform mail:**
  - Resend is primary.
  - Platform SMTP is the automatic fallback, only on a definitive Resend failure (a 5xx, or no connection).
  - On a timeout, retry Resend rather than fall back: SMTP has no idempotency key, so a fallback could mail twice.
- **Clinic mail:**
  - A clinic picks ONE provider: its own Resend, or its own SMTP.
  - After repeated failures, the platform sends instead, with the clinic's display name and reply-to, and the admin sees a warning in settings.
  - With no provider configured, the platform sends everything.
- **Which emails a clinic's provider sends:** `clinic.user_invited`, and future patient-facing mail.
- **Always sent by the platform:** `clinic.admin_invited`, password reset, TOTP and security mail, billing, and platform accounts.
- **Credentials:**
  - Only `update:clinic_settings:clinic` may change them.
  - Encrypted with their own env key, and write-only.
  - A test send runs before enabling.
  - Every change is audited without the secret.
  - A subscription feature flag is optional.
- **The auto-cancel audit actor stays the deactivating admin.** No real rows exist yet, so this can still change before the deploy.

**Slice 7c is split in two:**
- **7c-1:** platform SMTP fallback, worker only, no schema change. `nodemailer@10.0.15` is added by the orchestrator (`fa84028`).
- **7c-2:** per-clinic providers. The proposed shape, to settle in its own PR:
  - table `clinic_mail_providers` with PK `(clinic_id, id)`, unique `clinic_id`, `kind IN ('resend','smtp')`;
  - sealed credentials under a new `MAIL_PROVIDER_SEAL_KEY`;
  - `verified_at`, failure count, `disabled_at`;
  - RLS and its negative test;
  - grants: `eyadex_app` only, none for the platform or dispatcher roles.

**Next:** 7c-1, 7c-2, then the web-wiring + deploy slice, then the Resend webhook.

## 11. Update 2026-10-07 (after PRs #42–#44: slice 7c complete)

**Merged:**
- **#42, slice 7c-1:** platform SMTP fallback.
  - Resend is primary. SMTP is used only after a definitive Resend failure (5xx, or `resend_unreachable`).
  - Resend and SMTP share one 7 s send deadline.
  - `nodemailer@10.0.15` was added by the orchestrator.
  - Docs: ADR-0014.
- **#43, slice 7c-2a:** a clinic configures, seals and verifies its own provider.
  - New `settings` API module. Owner decision: `settings → identity`, imported only through `identity/index.ts`; CLAUDE.architecture.md §2.2 is updated.
  - Migration 0030 `clinic_mail_providers`, sealed with `MAIL_PROVIDER_SEAL_KEY`. The test send runs in the worker.
  - Hardening from 3 fix rounds:
    - SSRF guard: public addresses only; IPv6 limited to `2000::/3`; ports 25/465/587/2525; DNS answers pinned, IPv4 tried first, at most 4.
    - A 60 s test cooldown, ledgered in the audit.
    - A per-clinic advisory lock on provider writes.
    - A `version` column on the provider row.
    - Masking of every clinic-typed field in the audit.
- **#44, slice 7c-2b:** `clinic.user_invited` goes through a verified, non-degraded clinic provider.
  - After 3 definitive failures in a row, the provider degrades and the platform sends on the clinic's behalf (the clinic's display name, the platform address, the clinic's reply-to).
  - Timeouts do not count toward degradation.
  - Recovery happens only through a successful re-test or a replacement.
  - The degradation audit row names the inviter as the actor.
  - Fixes from review: suffixed Resend 401/403 count as definitive; an event degraded on its last attempt keeps one platform try; `clinic_mail_provider` is accepted as an audit entity.
  - Accepted limitation (ADR-0014): if an admin changes the provider between ambiguous retries, the invitee may get a second copy.

**Deploy needs, not done yet:**
- **Migrations:** 0029 and 0030 are not on production.
- **Worker:** it has no Dockerfile, image or Dokploy service.
- **Shared secrets:** the API and the worker must share `OUTBOX_SEAL_KEY` and `MAIL_PROVIDER_SEAL_KEY`.
- **Worker env:** `RESEND_API_KEY`, `MAIL_FROM`, the optional `SMTP_*` set, and `DISPATCHER_DATABASE_URL`.
- **Owner:**
  - pastes the secrets into Dokploy;
  - must remove the spaces from the Gmail app password.

**Next:** the deploy slice (worker image, Dokploy services, production migrations with a backup first), then wiring the web app to the HTTP API, then the Resend webhook, then PRD §5.5 items 8–12.
