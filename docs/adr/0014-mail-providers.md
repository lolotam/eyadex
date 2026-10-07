# ADR-0014 — Mail providers: platform SMTP fallback (7c-1) and clinic providers (7c-2)

Status: accepted for 7c-1 (2026-10-07) and 7c-2a (2026-10-07); 7c-2b next.

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
   `{ clinicId, providerId, providerVersion, actorUserId }` (ids and a version only) and an audit row. The worker
   (`apps/worker/src/mail-provider-test`), in one `withTenant` transaction on `eyadex_app`: locks the row
   `FOR UPDATE`, reads the actor's **active** membership email (never an address from a request), skips with
   no write if the row is gone or its `version` differs from the event's (replaced since), opens the seal
   (`seal_unreadable` on failure), sends one fixed bilingual message from `fromName <fromEmail>` with
   `replyTo` and `Idempotency-Key` = event id through the clinic's own Resend key or a fresh SMTP transporter
   closed after the send — **no platform fallback** — and writes `verified_at` or a short `last_error`. The
   outbox outcome is `dispatched` either way; a DB error retries on the shared schedule.
   - **Supersession by version, not clock.** Every replacement bumps `version` in its transaction; the
     event carries the version it was requested for and the worker compares it under the row lock. A
     wall-clock comparison fails across API replicas with skewed clocks or within one millisecond.
   - **One test per clinic per minute.** `requestTest` takes the clinic's `mail_provider:` advisory lock,
     then reads the clinic's last `clinic.mail_provider_test_requested` audit row and refuses a second
     request within 60 s (`rate_limited`, `retryAfterSeconds`). The append-only audit is the ledger, so
     replacing or deleting the provider cannot reset the limit. An SMTP test can hold the worker's single
     poller for 5 s; the cooldown bounds how much one clinic can delay everyone's invitations.
   - **One writer per clinic.** `PUT`, `DELETE` and the test request all take the same advisory lock first,
     so two admins creating the first provider at once serialise instead of hitting `UNIQUE (clinic_id)`.
   - **Public addresses only (SSRF).** A clinic chooses the SMTP host and port, and the worker connects to
     them. The worker allows ports 25/465/587/2525 only, resolves the host (1.5 s cap, inside the 5 s
     budget), refuses it unless every answer is a public address (loopback, private, shared, link-local,
     documentation, multicast and reserved IPv4 ranges blocked; IPv6 must be global unicast `2000::/3`
     outside Teredo/IETF `2001::/23`, documentation and 6to4; IPv4-mapped IPv6 unwrapped first), and
     pins the sender to the checked addresses (IPv4 first, at most 4, tried in turn only when the
     connection itself fails, all inside the 5 s budget and with no fresh DNS) with `tls.servername` =
     the name, so the certificate is
     still verified by name and DNS rebinding cannot swap the target. Codes: `smtp_port_not_allowed`,
     `smtp_dns`, `smtp_blocked_address`. The contract also refuses IP literals, single-label and local-only
     names and other ports at `PUT`; that check is syntax only, and the worker's is the guard.
   - **Audit masking.** Every clinic-typed field in the audit snapshots (`fromName`, `fromEmail`,
     `replyTo`, `smtpHost`, `smtpUser`) goes through `maskPhonesInText`. The view returned to the admin is
     unmasked.
6. **Mail port.** `MailMessage` gained optional `from` and `replyTo`; without them both adapters use
   `MAIL_FROM`, so invitations are unchanged. Display names are stripped of line breaks (no header injection).

### Routes and the identity import (owner decision, 2026-10-07)

The four routes live in `settings/http/mail-provider.controller.ts`: `GET /v1/clinic/mail-provider`
(`view:clinic_settings:clinic`); `PUT` (`update:clinic_settings:clinic`, `Idempotency-Key` required); `DELETE`
(same key, 204); `POST /test` (same key, `Idempotency-Key` required, 202, 404 without a provider).
`settings.module.ts` binds the reader and the use case to port tokens; the controller injects ports only.
The module is mounted with the clinic area (`mountClinic`) and refuses to start without a 32-byte
`MAIL_PROVIDER_SEAL_KEY`, naming the key only.

The controller imports `Require` and `ClinicRequest` from `identity/index.ts`, which is the pattern `platform` already
used. Owner decision 2026-10-07: neither moving the decorators to `shared` nor hosting the controller in
identity; `CLAUDE.architecture.md` §2.2 now lets `settings` and `platform` import `identity` through
`index.ts` for guards and request types only, and any module may do the same. `module-boundaries.spec.ts`
fails if a module other than identity imports any other identity file (test fixtures excepted).

### Accepted with the slice (owner, 2026-10-07)

- **The DELETE grant** to `eyadex_app` (item 2 above): beyond the SELECT/INSERT/UPDATE first listed, because
  removing the provider deletes a configuration row.
- **The keyed idempotency fingerprint** (item 4 above): HMAC with `MAIL_PROVIDER_SEAL_KEY`, never an unkeyed
  hash of a body that carries a secret.
- **Audit labels in `apps/web/src/shared/i18n/{ar,en}-audit.ts`**: the three new actions and the
  `clinic_mail_provider` entity. Dictionary entries only, needed by the audit-format sync test; no screen
  or mock changed.

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
