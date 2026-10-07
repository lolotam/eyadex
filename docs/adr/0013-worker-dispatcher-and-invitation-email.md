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
   covers the Resend timeout (15 s).
4. **Send-time check** (ADR-0012 §8). Open `sealedToken` with the event id; read the invitation under
   its clinic; read the clock after that read; send only when `status = 'pending'`,
   `expires_at > now` and `sha256(token) = token_hash` (constant-time compare). Otherwise the event is
   done as **skipped** with no email (missing, accepted, cancelled, expired, superseded). Only the two
   invitation types are claimed; any other type stays untouched for later slices.
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

## Consequences

- An email can arrive late (backoff) but never with a dead link, and never twice for one event.
- A clinic that is suspended still gets its pending invitation mailed; acceptance refuses it (ADR-0008).
- Auto-cancel of invitations on a deactivated branch is 7b-2; SMTP and per-clinic providers are 7c.
- TODO(spec): retention of dispatched and failed outbox rows.
