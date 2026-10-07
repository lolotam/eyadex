# ADR-0014 — Mail providers: platform SMTP fallback (7c-1) and clinic providers (7c-2)

Status: accepted for 7c-1 (2026-10-07) and 7c-2a (2026-10-08); 7c-2b next.

## Context

The worker mails invitations through Resend (ADR-0013). The owner decided on 2026-10-07
(handoff §10) how platform and clinic mail providers combine. SMTP has no idempotency key: a message
handed to SMTP after Resend may already have accepted it is mailed twice.

## Decision — 7c-1: platform SMTP fallback

1. **Resend is primary.** Platform SMTP is used automatically, and only when Resend definitively did
   not accept the message.
2. **Decision table** (`domain/fallback-decision.ts`, pure):

   | Resend result                                                       | Decision        |
   | ------------------------------------------------------------------- | --------------- |
   | `resend_5xx` (any 500–599, with or without an error name)           | `try_secondary` |
   | `resend_unreachable` (cause `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`) | `try_secondary` |
   | `resend_timeout`                                                    | `retry_primary` |
   | `resend_network` (reset, socket error, anything ambiguous)          | `retry_primary` |
   | any 4xx, including 429                                              | `retry_primary` |

   A timeout or ambiguous network error may mean Resend accepted the message and the reply was lost.
   Retrying Resend with the same `Idempotency-Key` cannot mail twice; falling back to SMTP could. A 4xx
   is a problem with the request or the rate, which SMTP would not fix for the platform's own sending.

3. **Composition.** `FallbackMailSender(primary, secondary, decide)` implements the one `MailSender`
   port. A success reports `provider` and `fallback`; both failing gives `"<primary>;<secondary>"`
   (≤ 120 chars) as `last_error`, and the existing retry schedule applies. Both providers share one
   7 s deadline (`SEND_BUDGET_MS`): the send runs inside a tenant transaction capped at 10 s that
   holds the invitation row, and the read before and the commit after need headroom. SMTP gets only
   what Resend left. Under 1 s left means no SMTP attempt (`<primary>;fallback_no_time`, retried
   later), and an SMTP send past the deadline is `smtp_timeout`.
4. **SMTP adapter.** nodemailer, one transporter for the process, closed in the worker's `release`.
   Port 465 is implicit TLS; any other port sets `requireTLS` (STARTTLS), never plain text. Connection,
   greeting and socket timeouts plus an overall 5 s cap, and the shared deadline above, bound the send,
   because the invitation row is locked during the send (ADR-0013 §4). Errors map to short codes
   (`smtp_auth`, `smtp_timeout`, `smtp_econnrefused`, `smtp_<responseCode>`, `smtp_<code>`,
   `smtp_error`); nothing from the error object reaches a log or `last_error`.
5. **Config.** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`: all or none (an empty value is
   unset). A partial set stops startup naming the keys only. None means no fallback — the 7b behaviour.
   `MAIL_FROM` is shared.
6. **Logging.** `"outbox event handled"` with `{ outcome: "sent", provider, fallback }`.

## Decision — 7c-2a: a clinic configures and verifies its own provider

1. **Table `clinic_mail_providers` (`db/sql/0030`).** Clinic-owned, PK `(clinic_id, id)`, `UNIQUE (clinic_id)`,
   RLS enabled and forced. `kind` is `resend` or `smtp`; an `smtp` row has host, port and user, a `resend` row
   none. `sealed_credentials` holds the Resend key or the SMTP password. `consecutive_failures` and
   `degraded_at` are reserved for 7c-2b. Grants: `eyadex_app` SELECT, INSERT, UPDATE and **DELETE**; nothing
   for `eyadex_platform`, `eyadex_dispatcher` or `eyadex_auth`.
2. **DELETE is allowed here.** The row is configuration, not business data: removing it sends the clinic
   back to platform mail and loses nothing a person entered as a record. The no-hard-delete rule covers
   users, branches, roles and patient files. The removal is audited (`clinic.mail_provider_removed`).
3. **Write-only credentials.** Sealed with `MAIL_PROVIDER_SEAL_KEY` (not `OUTBOX_SEAL_KEY`), AAD = the row
   id, so a sealed value copied to another row never opens. Replacing keeps the row id, writes a new seal and
   clears `verified_at`, `last_error`, `consecutive_failures` and `degraded_at`. The view
   (`@eyadex/contracts/mail-provider`) has `hasCredentials: true` and never the secret; audit snapshots are
   that view.
4. **Idempotency fingerprint.** `PUT` carries a secret, so its `request_hash` is an HMAC keyed by
   `MAIL_PROVIDER_SEAL_KEY`, not the plain SHA-256 other routes use: an unkeyed hash in
   `clinic_idempotency_keys` would let anyone who reads that table guess a weak password offline.
5. **Test send is a worker job.** The use case appends `clinic.mail_provider_test_requested`
   `{ clinicId, providerId, actorUserId }` (ids only) and an audit row. The worker
   (`apps/worker/src/mail-provider-test`), in one `withTenant` transaction on `eyadex_app`: locks the row
   `FOR UPDATE`, reads the actor's **active** membership email (never an address from a request), skips with
   no write if the row is gone or `updated_at` is later than the event (replaced since), opens the seal
   (`seal_unreadable` on failure), sends one fixed bilingual message from `fromName <fromEmail>` with
   `replyTo` and `Idempotency-Key` = event id through the clinic's own Resend key or a fresh SMTP transporter
   closed after the send — **no platform fallback** — and writes `verified_at` or a short `last_error`. The
   outbox outcome is `dispatched` either way; a DB error retries on the shared schedule.
6. **Mail port.** `MailMessage` gained optional `from` and `replyTo`; without them both adapters use
   `MAIL_FROM`, so invitations are unchanged. Display names are stripped of line breaks (no header injection).

### Open: the HTTP routes are not mounted (import arrow)

The `settings` module holds the domain, use cases (`MailProviderChanges`: `put`, `remove`, `requestTest`),
query (`getMailProvider`), persistence and published event, and imports only `tenancy` and `shared`. The
four routes under `/v1/clinic/mail-provider` are **not** added, because every way to declare their access
needs an arrow §2.2 does not allow:

- a controller inside `settings` must import `@Require` and `ClinicRequest` from `identity` (settings →
  identity);
- a controller inside `identity`, like `BranchesController`, must import the use case from `settings`
  (identity → settings).

`platform` controllers already import `identity`'s decorators, which is the same gap. Options for the
owner: (a) allow `identity → settings` and host the controller in `identity/http` as branches do;
(b) move the access decorators and `ClinicRequest` to `shared/access` so any module's controller can declare
access. Until then `MAIL_PROVIDER_SEAL_KEY` is required by the worker only; the API reads it when the routes
are mounted.

## Next — 7c-2b

Route `clinic.user_invited` (and future patient-facing mail) through a verified clinic provider; count
consecutive failures; after 3 the platform sends instead with the clinic's display name and reply-to, sets
`degraded_at`, and settings shows a warning. `clinic.admin_invited`, password reset, TOTP/security, billing and
platform-account mail always go through the platform.

## Consequences

- An ambiguous Resend failure delays mail by the retry schedule rather than risk a duplicate.
- SMTP sends are not idempotent: a crash between an SMTP accept and the commit can mail twice. This is
  accepted because SMTP is reached only after a definitive Resend refusal.
- An SMTP send cut off by the 5 s cap (`smtp_timeout`) may still be delivered after the event is
  rescheduled, and the retry can then mail a second copy through Resend. This is accepted too: it
  needs a Resend 5xx and an SMTP timeout on the same event, and the cap must hold because the
  invitation row is locked during the send.
