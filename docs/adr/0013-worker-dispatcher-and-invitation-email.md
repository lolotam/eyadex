# ADR-0013 — Worker dispatcher and invitation email

Status: accepted (2026-10-07, slice 7b-1)

## Context

Onboarding (`clinic.admin_invited`, ADR-0006) and user invitations (`clinic.user_invited`, ADR-0012)
write outbox events that carry the invitation link sealed with the event id. Nothing sent them. The
email must never go to a link that a resend, a copy-link, a cancel or an acceptance has killed, and the
database must not keep a usable link once the event is done.

## Decision

1. **Two pools in the worker.** `eyadex_dispatcher` touches `outbox_events` only (claim, mark, scrub)
   through `createDispatcherOutbox` in `@eyadex/db`: `claimNext`, `ping`, `close` — no general
   transaction, no SQL from the caller. The send-time check reads `invitations` (and the clinic's time
   zone) on an `eyadex_app` pool under `withTenant(event.clinic_id)`. The dispatcher gets no grant on
   any clinic table.
2. **Migration `0029_outbox_dispatch.sql`** adds `attempts`, `next_attempt_at`, `last_error` (≤ 500
   characters) and `failed_at`; the dispatcher's UPDATE grant is exactly
   `(dispatched_at, payload, attempts, next_attempt_at, last_error, failed_at)`; the pending index now
   excludes given-up events. `db/tests/outbox-dispatch.sql` proves the dispatcher cannot read
   `invitations`, `clinics`, `memberships`, `audit_log` or `patients`, nor rewrite or delete an event.
3. **Claim.** One event per transaction:
   `dispatched_at IS NULL AND failed_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= now)
AND event_type IN (…) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`. The row stays locked
   while the email is sent and the outcome is written in the same transaction, so two workers never
   send the same event. `now` is the worker's injected clock. The dispatcher transaction cap (30 s)
   covers the Resend timeout (5 s).
4. **Send-time check** (ADR-0012 §8). Open `sealedToken` with the event id; read the invitation under
   its clinic `FOR SHARE` and keep the row locked until the send returns, so a resend, copy-link,
   cancel or accept that arrives meanwhile waits instead of invalidating a link already being mailed
   (the API takes the same row `FOR UPDATE`). The Resend timeout (5 s) stays under the API's 10 s
   transaction cap, so a waiting API write still completes. Read the clock after the lock; send only when `status = 'pending'`,
   `expires_at > now`, the invitation is `all_branches` or still has an active branch, and
   `sha256(token) = token_hash` (constant-time compare). Otherwise the event is done as **skipped**
   with no email (missing, accepted, cancelled, expired, no_active_branch, superseded). The branch
   check matters because events are claimed by `created_at`: in a backlog, an invitation's mail comes
   before the later `clinic.branch_deactivated` that cancels it (§12), and must not mail a link about to
   die. Only the handled types are claimed; any other type stays untouched for later slices.
5. **Outcome.** Sent or skipped → `dispatched_at` set and `sealedToken` removed in the same UPDATE.
6. **Failures.** `attempts + 1`, `next_attempt_at = now + delay`, `last_error` = provider status and
   Resend's error name only (`resend_500`, `resend_422:validation_error`, `resend_timeout`,
   `resend_network`) — never the token, the link, the address or a response body. Delays after
   failures 1–4: 1 min, 5 min, 30 min, 2 h. The 5th failure sets `failed_at` and scrubs the token; the
   admin resends or copies a new link. The brief's 6 h step would follow the 5th failure, which is the
   give-up point, so it is listed in `RETRY_DELAYS_MS` but never reached. A malformed payload or a seal
   that does not open fails at once (no retry can fix it).
7. **Mail port.** `MailSender.send({ to, subject, html, text, idempotencyKey })` returns
   `{ sent: true } | { sent: false, error }` and never throws for a provider failure. One adapter,
   `ResendMailSender`: `POST https://api.resend.com/emails` with `fetch`, `Idempotency-Key: <event id>`,
   so a crash between the send and the commit does not mail twice. An SMTP adapter (7c) implements the
   same port.
8. **Content.** Arabic (`dir="rtl"`) or English from `payload.language`; clinic name, role name (user
   invites), the expiry in the clinic's language and time zone, and `${APP_URL}/invite/${token}`. Every
   user-entered field is HTML-escaped; CR/LF are stripped from the subject. Brand `Eyadex` in Latin
   letters.
9. **`SecretSealer`** moved to `packages/secrets` (`@eyadex/secrets`), used by the API (seal) and the
   worker (open). The lockfile change is workspace links only.
10. **Config** (zod, the worker refuses to boot without them): `DATABASE_URL`, `DISPATCHER_DATABASE_URL`,
    `OUTBOX_SEAL_KEY`, `APP_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `OUTBOX_POLL_INTERVAL_MS` (default 2 s).
11. **Lifecycle.** Polling starts after `listen`. Shutdown runs `stop` (no new claim; waits for the event
    in flight to write its outcome) then releases both pools, inside the existing 30 s budget.
    `/health` stays pure liveness; `/health/ready` pings both pools (503 when one is down). Log lines
    are catalogued in `log-events.ts` and carry the event id, type, outcome, skip reason or error code
    only.
12. **Second job: auto-cancel on a deactivated branch (slice 7b-2, ADR-0012 §16).**
    - **Event.** Every successful `BranchChanges.deactivate` appends one `clinic.branch_deactivated`
      in the same `withTenant` transaction (`tenancy/events/published.ts`), payload
      `{ clinicId, branchId, actorUserId, deactivatedAt }` and nothing else. No event on a no-op or a
      refusal (`last_active_branch`, `branch_has_exclusive_members`). Tenancy emits unconditionally
      and never reads or writes invitations.
    - **Routing.** One poller claims the union of the handled types through `shared/event-router.ts`
      (type → handler); a type with no handler is never claimed.
    - **Payload.** Zod-validated; malformed, or `clinicId` ≠ the row's `clinic_id` → `failed`
      (`invalid_payload`) at once.
    - **Lock order** on the `eyadex_app` pool under `withTenant(clinicId)`: advisory `users:<clinic>` →
      candidate invitation rows `FOR UPDATE` ordered by id → advisory `branches:<clinic>` → clock read →
      a fresh statement re-evaluates each locked row. The keys and function are the API's, so this job
      serialises with invites, resends, copy-link, cancels, accepts and branch changes. Acceptance takes
      no users lock but locks the invitation row before the branches lock, so the row lock must come
      before the branches lock here too, or the two would deadlock. A mail send that holds the row
      `FOR SHARE` (§4) finishes first.
    - **Decision at handling time.** Cancel every invitation of the clinic that is `pending`, not
      `all_branches`, and has no `invitation_branches` row on an active branch. `branchId` is audit
      detail only: a branch reactivated before the job runs means no cancel, and a replay or retry
      cancels nothing new.
    - **Effect per invitation.** `release_invitation_email`, `status = 'cancelled'`, `responded_at`, and
      one `audit_log` row: actor = the payload's `actorUserId`, action `invitation.auto_cancelled`
      (distinct from the manual `invitation.cancelled`), entity `invitation`, details
      `{ reason: "branch_deactivated", branchId, eventId, before, after }` with the manual cancel's
      snapshot shape and names passed through `maskPhonesInText`. This is a system rule: it applies
      whether or not the deactivating admin could cancel that invitation by hand (for example one on
      the clinic-admin role).
    - **Outcome.** `dispatched` on success (log `outcome: "cancelled"`, `count`). A database error
      rolls the tenant transaction back and retries on the mail schedule with `last_error = db_error`;
      after the 5th failure it is `failed`. No raw error message and no email is logged.

## Consequences

- An email can arrive late (backoff) but never with a dead link, and never twice for one event.
- A clinic that is suspended still gets its pending invitation mailed; acceptance refuses it (ADR-0008).
- Auto-cancel shipped in 7b-2 (§12); SMTP and per-clinic providers are 7c.
- TODO(spec): retention of dispatched and failed outbox rows.
