# ADR-0014 — Mail providers: platform SMTP fallback (7c-1) and clinic providers (7c-2)

Status: accepted for 7c-1 (2026-10-07); 7c-2 proposed, next slice.

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
   (≤ 120 chars) as `last_error`, and the existing retry schedule applies.
4. **SMTP adapter.** nodemailer, one transporter for the process, closed in the worker's `release`.
   Port 465 is implicit TLS; any other port sets `requireTLS` (STARTTLS), never plain text. Connection,
   greeting and socket timeouts plus an overall 5 s cap keep the send inside the same budget as Resend,
   because the invitation row is locked during the send (ADR-0013 §4). Errors map to short codes
   (`smtp_auth`, `smtp_timeout`, `smtp_econnrefused`, `smtp_<responseCode>`, `smtp_<code>`,
   `smtp_error`); nothing from the error object reaches a log or `last_error`.
5. **Config.** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`: all or none (an empty value is
   unset). A partial set stops startup naming the keys only. None means no fallback — the 7b behaviour.
   `MAIL_FROM` is shared.
6. **Logging.** `"outbox event handled"` with `{ outcome: "sent", provider, fallback }`.

## Proposed — 7c-2: clinic mail providers (next slice)

- Table `clinic_mail_providers` (clinic-owned: `clinic_id`, PK `(clinic_id, id)`, RLS enabled and
  forced, negative isolation test): `kind` (`resend` | `smtp`), one active row per clinic,
  display name, reply-to, sealed credentials (a dedicated env key, not `OUTBOX_SEAL_KEY`), `verified_at`
  from a test send, `consecutive_failures`, `degraded_at`.
- A clinic picks one provider. It sends `clinic.user_invited` and future patient-facing mail;
  `clinic.admin_invited`, password reset, TOTP/security, billing and platform-account mail always go
  through the platform.
- After repeated failures the platform sends instead, with the clinic's display name and reply-to, and
  the admin sees a warning in settings. No provider configured → the platform sends everything.
- Only `update:clinic_settings:clinic` may change credentials; they are write-only, a test send runs
  before enabling, and every change is audited without the secret. A subscription feature flag is
  optional.

## Consequences

- An ambiguous Resend failure delays mail by the retry schedule rather than risk a duplicate.
- SMTP sends are not idempotent: a crash between an SMTP accept and the commit can mail twice. This is
  accepted because SMTP is reached only after a definitive Resend refusal.
