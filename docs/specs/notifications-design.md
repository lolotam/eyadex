# Patient notifications — design (post-MVP phase 3)

- Status: owner decisions recorded 2026-10-12 (below). Slices N1 (email) and N2 (WhatsApp).
- PRD: §8.3 item 3 ("notifications: email, then WhatsApp"), §4.11 (audit), §5 (database rules),
  §7 (patients are not users). Builds on ADR-0006 (outbox), ADR-0013 (worker dispatcher),
  ADR-0014 (mail providers), ADR-0020 (settings), ADR-0026 (appointments), ADR-0028 (encryption).
- Decision record to write with N1: ADR-0031 (patient notifications). N2 adds ADR-0032 (WhatsApp).

## 1. Owner decisions (2026-10-12)

| #   | Question                    | Decision                                                                                                                                                                                                                                                                                         |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N-1 | Which messages              | Booking confirmation, reschedule, cancellation, a reminder the day before, a reminder 2 hours before, and the doctor's prescription. The clinic can switch each one off.                                                                                                                         |
| N-2 | What the patient file gains | An optional email, a message language (ar/en, empty = the clinic's default language) and "does not receive reminders" (opt-out, set by staff on the patient's request). The opt-out stops the two reminders only; confirmation, reschedule, cancellation and prescription messages still go out. |
| N-3 | Which mail provider sends   | The clinic picks a **primary** and an optional **fallback** provider (each SMTP or Resend, ADR-0014 rules). If both fail, **Eyadex sends on the clinic's behalf**: platform Resend, the clinic's name as display name, replies to the clinic's email.                                            |
| N-4 | Privacy of the message text | No service name, no diagnosis, nothing medical in appointment messages: clinic, branch, date, time (clinic time zone) and provider name only.                                                                                                                                                    |
| N-5 | Prescription                | Sent automatically when the doctor signs a visit that has prescription lines (the clinic can switch it off). The email lists the medicine lines only, never the diagnosis or notes. Each send is a patient-access audit row.                                                                     |
| N-6 | WhatsApp transports         | (a) Evolution API (unofficial, linked by QR) with a written warning the admin must accept: the number can be banned by WhatsApp. (b) Coexistence (Meta's Business API on a number that keeps the WhatsApp Business app). No plain Cloud API mode.                                                |
| N-7 | Where Evolution runs        | A dedicated Evolution container in the Eyadex Dokploy project, on the internal network only. The URL and API key are settings, so a test against another Evolution server needs no code change.                                                                                                  |

## 2. Data model (clinic tables: `clinic_id`, PK `(clinic_id, id)`, RLS enabled + forced, CLAUDE.md §5)

| Change                                      | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patients` (new columns)                    | `email text NULL` (lower case, shape check, ≤254), `message_language text NULL` (`ar`/`en`), `notifications_opt_out boolean NOT NULL DEFAULT false`.                                                                                                                                                                                                                                                                                                                                                           |
| `clinic_notification_settings` (new, 1 row) | `email_enabled`, `whatsapp_enabled`, and one boolean per message: `booked`, `rescheduled`, `cancelled`, `reminder_day`, `reminder_2h`, `prescription`. A clinic without a row uses the defaults: email on, every message on.                                                                                                                                                                                                                                                                                   |
| `clinic_mail_providers` (change)            | `slot text NOT NULL DEFAULT 'primary'` (`primary`/`fallback`); uniqueness moves from `(clinic_id)` to `(clinic_id, slot)`. Existing rows become `primary`.                                                                                                                                                                                                                                                                                                                                                     |
| `patient_notifications` (new, the ledger)   | `patient_id`, `kind`, `channel` (`email`/`whatsapp`), `subject_type` (`appointment`/`visit`), `subject_id`, `subject_at` (the appointment start it was built for), `status` (`queued`/`sent`/`skipped`/`failed`), `skip_reason`, `route` (`primary`/`fallback`/`platform`), `requested_by` (membership, null for the scanner), `sent_at`. Unique `(clinic_id, subject_id, kind, channel, subject_at)` so a retry or a second scan never sends twice, and a reschedule (new `subject_at`) gets fresh reminders. |

The ledger holds no address and no text: the worker reads the patient's current email and the
appointment at send time. Outbox payloads carry the ledger id only (no personal data in the outbox).

## 3. Flows

1. **Booked / rescheduled / cancelled** — the appointment use case (same transaction, after its locks,
   ADR-0027) inserts a ledger row per enabled channel and appends `patient.notification_requested`
   with `{ notificationId }`. Nothing is queued when the module setting is off; the patient's
   opt-out and missing email are decided at send time (they can change in between).
2. **Reminders** — a worker `PeriodicJob` (`REMINDER_SCAN_INTERVAL_MS`, default 5 min) walks clinics
   with the `appointments` module on (platform pool: clinics + features only), then per clinic inside
   `withTenant` (eyadex_app) finds `booked` appointments due:
   - day reminder when `starts_at − 24h ≤ now < starts_at − 2h` and the appointment was created more
     than 24 h before its start (a same-day booking already got its confirmation);
   - 2 h reminder when `starts_at − 2h ≤ now < starts_at` and it was created more than 2 h before.
     It inserts ledger rows `ON CONFLICT DO NOTHING` and appends the outbox event in the same transaction.
3. **Send (worker handler)** — claims the event, locks the ledger row, re-reads under `FOR SHARE`:
   skip (`skipped` + reason) when the clinic setting is now off, the patient has no email, or it is a
   reminder and the patient opted out,
   the appointment is no longer `booked` (except for the cancellation message) or its start moved
   (`subject_at` differs). Otherwise renders the template and sends:
   primary provider → fallback provider → platform on behalf (N-3). A provider is used only when
   verified and not degraded (ADR-0014). The move to the next route happens only when the message was
   certainly not accepted (connection failure, timeout before connect, 5xx) — the existing
   `decideFallback` rule — because SMTP has no idempotency key. Other failures retry the same route
   with the 1 m / 5 m / 30 m / 2 h / 6 h schedule. "Certainly not accepted" per transport:
   - Resend: unreachable / timeout before a response / 5xx (today's `decideFallback`).
   - SMTP: DNS, connect, TLS or authentication failure, or a 4xx/5xx reply before the DATA command is
     accepted. A timeout or a dropped connection **after** DATA was sent retries the same route
     (the message may have been accepted; moving on could send it twice).
     the 5th failure marks the row `failed`.
     Definitive clinic-provider failures count toward degradation as today.
4. **Prescription** — the sign-visit use case (same transaction) queues one ledger row + event when
   the setting is on and the visit has prescription lines. The send writes a patient-access audit row
   (`patient.prescription_sent`, actor = the signing doctor). An addendum never re-sends.

## 4. Templates

Bilingual (ar RTL / en), in the patient's message language or the clinic default. Plain HTML + text,
no images, no tracking. Subject and body name the clinic; times use the clinic time zone
(`packages/contracts/src/clinic-time.ts`). Appointment messages: clinic, branch (name, address if
set), date, time, provider name, and "contact the clinic to change it". Prescription: the medicine
lines (name, dose, frequency, duration, notes) and the doctor's name; no diagnosis, no notes.

## 5. API (N1)

| Route                                            | Permission                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `GET/PUT /v1/clinic/notification-settings`       | `view` / `update:clinic_settings:clinic`                                                                          |
| `GET/PUT/DELETE /v1/clinic/mail-providers/:slot` | same as today's mail provider (slot primary/fallback; the old `/clinic/mail-provider` stays as the primary alias) |
| `POST /v1/clinic/mail-providers/:slot/test`      | `update:clinic_settings:clinic`                                                                                   |
| `GET /v1/appointments/:id/notifications`         | the appointment's view scope                                                                                      |
| patients create/update                           | gains `email`, `messageLanguage`, `notificationsOptOut`                                                           |

## 6. Web (N1, Lovable — mock adapter mirrors every rule)

Patient form: the three fields. Settings: a "Notifications" tab (channel + per-message switches) and
an "Email" tab (primary and fallback provider forms, test send, status: verified / degraded / last
error). Appointment details: the message history (kind, channel, status, time). Visit page: a line
showing whether the prescription email was sent, skipped (why) or failed.

## 7. WhatsApp (N2)

- `clinic_whatsapp_channels` (1 row per clinic): `transport` (`evolution`/`coexistence`), `status`
  (`disconnected`/`pending`/`connected`), `instance_name`, `phone_last4`, `risk_accepted_at`,
  `risk_accepted_by`, sealed coexistence credentials (`MAIL_PROVIDER_SEAL_KEY`-style sealing).
- Evolution: env `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` (API + worker). Connect = create the
  clinic's instance and return its QR; the screen polls the state. Sends go out with a per-clinic
  pace (at least a few seconds apart, jitter) to lower the ban risk. The risk text is accepted by an
  admin before the first connect and audited.
- Coexistence: the clinic's Meta Business credentials directly through Meta Graph v22.0;
  reminder templates must be approved by Meta (utility category, charged per message by Meta).
- The ledger, scanner and send handler are shared with N1: `channel = 'whatsapp'`, the patient's
  mobile as the address, and no fallback to email unless the clinic enables both channels.

### 7.1 N2 details (orchestrator, 2026-10-13; contracts in `packages/contracts/src/whatsapp.ts`)

- **Table `clinic_whatsapp_channels`** (one row per clinic, `UNIQUE (clinic_id)`; no row = not linked):
  `transport text NULL` (`evolution`/`coexistence`), `status text NOT NULL` (`disconnected`/`pending`/
  `connected`), `instance_name text NULL` (Evolution instance, `eyadex-<clinic id>`), `phone_last4 text
NULL` (`^[0-9]{4}$`), `risk_accepted_at timestamptz NULL`, `risk_accepted_by uuid NULL` (user id, no
  FK), `risk_version int NULL`, `sealed_credentials text NULL` (coexistence access token, sealed with
  `MAIL_PROVIDER_SEAL_KEY`, AAD = row id), `phone_number_id text NULL`, `business_account_id text NULL`,
  `templates jsonb NOT NULL DEFAULT '{}'` (kind → `{name, language}`), `connected_at timestamptz NULL`,
  `last_error text NULL` (≤120, a code), `next_send_at timestamptz NULL` (the pace), `created_at`,
  `updated_at`, `operation_id uuid NULL`, `operation_expires_at timestamptz NULL` (a 60-second API
  reservation across network calls; sends wait while it is active). RLS forced; `eyadex_app`
  SELECT/INSERT/UPDATE; no platform grant.
- **`clinic_notification_settings.whatsapp_enabled boolean NOT NULL DEFAULT false`**;
  `patient_notifications.route` CHECK gains `evolution` and `coexistence`, `skip_reason` gains
  `whatsapp_disconnected` and `template_missing`.
- **Env (API + worker):** `EVOLUTION_API_URL` (internal `http://<app>:8080`) and `EVOLUTION_API_KEY`.
  Both unset = QR unavailable (connect answers `unavailable`, Evolution sends skip `whatsapp_disconnected`);
  coexistence save, view and sends still work.
  One set without the other stops the start (`ConfigurationError`).
- **API** (`view`/`update:clinic_settings:clinic`): `GET /v1/clinic/whatsapp`;
  `POST /v1/clinic/whatsapp/connect` (`whatsappConnectRequestSchema`; records the risk acceptance once,
  audit `clinic.whatsapp_risk_accepted`; creates the Evolution instance with integration
  `WHATSAPP-BAILEYS` if missing; answers `whatsappQrResponseSchema`); `GET /v1/clinic/whatsapp/qr`
  (refresh; reads `connectionState` and turns `pending` into `connected` with `phone_last4` when open);
  `POST /v1/clinic/whatsapp/disconnect` (logs the instance out; `status = disconnected`; audit);
  `PUT /v1/clinic/whatsapp/coexistence` (`whatsappCoexistenceRequestSchema`; token write-only, kept
  when omitted on an update; audit without the token). Queueing (N1 flow) adds a `whatsapp` ledger row
  per kind when `whatsappEnabled` and the channel is `connected` at queue time.
- **Worker:** same handler, `channel = 'whatsapp'`: the patient's mobile (`+965…` → `965…`);
  skips as N1 plus `whatsapp_disconnected` (not connected now) and `template_missing` (coexistence kind
  without a template). Evolution: `POST /message/sendText/<instance>` with the same text as the email's
  plain part (ar/en). Coexistence: direct `POST https://graph.facebook.com/v22.0/{phone_number_id}/messages`
  with `Authorization: Bearer <token>`, `messaging_product: "whatsapp"`, `type: "template"`,
  `template.language: {code}`, and body text parameters in the fixed
  parameter order in `whatsappTemplateSchema`. Pace: one message per clinic at least 8 s apart (+0–4 s
  jitter) via `next_send_at` under the channel row lock; too early = retry at that time without an
  attempt. Safe failures retry with the N1 schedule; ambiguous timeouts are final. No cross-channel fallback.

- **Coexistence verification (API):** injectable `MetaApi` / `HttpMetaApi`, 10 s timeout per request,
  redirects refused. Verify when the token, transport or either Meta id changes: first
  `GET /v22.0/{phone_number_id}?fields=display_phone_number,verified_name`, retaining only
  `phone_last4`, then `POST /v22.0/{business_account_id}/subscribed_apps`. Never `/register` and never
  create a Business instance in Evolution. Templates-only edits make no Meta call. The token is sealed
  with `MAIL_PROVIDER_SEAL_KEY`, AAD = channel row id; the worker opens it with that same id.
  HTTP 400/401/403 or numeric error 190 gives `validation`, token field `meta_credentials_invalid`;
  network, 5xx, timeout and malformed answers give 503. Unlinking coexistence updates the row only.
- **API-only env:** `EVOLUTION_WEBHOOK_URL` and `EVOLUTION_WEBHOOK_SECRET` (at least 32 chars) are
  required with Evolution, and must both be unset without it. The URL is the internal API origin plus
  `/v1/hooks/evolution`: Docker's API listens on `0.0.0.0:3000`; the local process defaults to 3001.
  The worker does not require the webhook variables.
- **Webhook registration (Evolution v2.3.7):** create uses nested `webhook: {enabled: true, url,
byEvents: false, base64: false, headers: {"x-eyadex-webhook": <secret>},
events: ["MESSAGES_UPDATE", "CONNECTION_UPDATE"]}`. These request field names are confirmed by
  [the versioned InstanceDto](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/dto/instance.dto.ts);
  `webhookByEvents` / `webhookBase64` are storage names. Connecting an existing instance also calls
  `POST /webhook/set/:instance` with `{webhook: {...}}`. Create timeout is 10 s; other API calls remain 5 s.
- **QR robustness:** prefixed or bare PNG base64, top-level or `qrcode.base64`, is normalized to a data
  URL. Only `code` or `count: 0` is pending with null QR. Owner digits come from `ownerJid`, then `owner`,
  stripping `:device` and `@...` before taking the last four.
- **`POST /v1/hooks/evolution`:** no browser session, CSRF or origin requirement; a constant-time
  digest comparison authenticates `x-eyadex-webhook` before the public rate limiter. Wrong header gives
  the existing bilingual 401 `unauthorized` envelope; Evolution unset gives 404. Internal-host access
  is exempt only on this exact POST route; other browser routes retain their guards. Zod strips unknown
  body fields; unknown/malformed events and unknown clinic UUIDs are ignored with 200. The body is never
  logged. Both uppercase events and Evolution's dotted lowercase event names are accepted, including
  arrays of message updates. `eyadex-<uuid>` selects `withTenant`.
  `MESSAGES_UPDATE` with status `ERROR` or numeric 0 and `keyId` or `key.id` changes only matching
  WhatsApp/Evolution `sent` rows to `failed`, `last_error = evolution:evo_delivery_rejected`.
  `CONNECTION_UPDATE` state `close` disconnects only an Evolution channel, clears `connected_at`, sets
  `evo_connection_closed`, and writes one `clinic.whatsapp_disconnected` administrative audit with
  system/null actor and `{transport: "evolution", reason: "connection_closed"}`. Replays are idempotent.
- **Ledger (0058):** `provider_message_id text NULL`, at most 200 chars; partial index on
  `(clinic_id, provider_message_id) WHERE provider_message_id IS NOT NULL`. Successful WhatsApp sends
  retain Evolution's `key.id` or Meta's `messages[0].id`. `sent_check` permits route + sent_at on a
  failed row only for a WhatsApp/Evolution delivery rejection; other unsent rows retain neither.
  History returns the contract's coarse `failureReason` only for failed rows, never provider text.
- **Evolution retry:** `evo_timeout`, `evo_rejected`, `evo_unauthorized`, `evo_not_on_whatsapp`, other
  4xx and `evo_not_connected` are final. No idempotency key means timeout retries could duplicate a send.
  `evo_not_connected`, including a 5xx with "Connection Closed" in top-level `message` or
  `response.message` (string or array), also disconnects the channel with `evo_not_connected` and clears
  `connected_at`; later messages skip `whatsapp_disconnected`. Other `evo_5xx` and `evo_unreachable` retry.
- **Meta worker:** 15 s timeout, injected fetch, redirects refused. Only numeric provider error codes
  are inspected; provider message/subcode text never reaches errors, logs, audit or the ledger.
  HTTP 401, codes 190/10/200-299 -> final `meta_unauthorized`; 132000-132015/132068/132069 -> final
  `meta_template`; 131026 -> final `meta_not_on_whatsapp`; 4/80007/130429/131048/131056 -> retry
  `meta_rate_limited`; HTTP 5xx -> retry `meta_5xx`; timeout -> final `meta_timeout`; unreachable -> retry
  `meta_unreachable`; other 4xx or invalid acceptance responses -> final `meta_rejected`.
  The worker's app transaction budget is 30 s to encompass the 15 s Meta request and ledger settlement.

## 8. Checklist for every N slice

- Each new clinic table (`clinic_notification_settings`, `patient_notifications`, N2's
  `clinic_whatsapp_channels`): RLS enabled + forced, the policy, the negative isolation test and its
  entry in `db/tests/rls-isolation.sql`, all in the same PR.
- Drizzle mirror updated (schema-drift test), contracts first, mock adapter mirrors the API rules.
- Invitation emails (`clinic.user_invited`) keep today's single clinic route; only patient
  notifications use the fallback slot.

## 9. Out of this phase

Patient replies (two-way chat), SMS, custom message templates per clinic, marketing messages,
an unsubscribe link (opt-out is staff-managed), read receipts.
