# ADR-0032 — The clinic's WhatsApp channel (phase 3 N2, API)

- Status: accepted (owner decisions N-6, N-7, 2026-10-12; `docs/specs/notifications-design.md` §7.1)
- Date: 2026-10-13

## Context

N2 lets a clinic send the N1 messages over WhatsApp through its own number: an unofficial link by QR
through Evolution API (the number can be banned, so an admin accepts that risk first), or Meta's
Business Platform in coexistence mode directly through Graph v22.0 (owner revision, 2026-10-13). Evolution runs as
a dedicated container on the internal network (N-7). SQL 0057 adds `clinic_whatsapp_channels`; 0058 adds
`clinic_notification_settings.whatsapp_enabled` and widens the ledger's route and skip-reason checks.

## Decision

1. **The notifications module owns the channel table** (its third): the queue step and the settings rule
   read it, and no new arrow is needed.
2. **Evolution through a port.** `EvolutionApi` (create, connect, connection state, the owner's last four
   digits, logout, delete), implemented by `HttpEvolutionApi` (global key in the `apikey` header, 5 s
   timeout (10 s on create), redirects refused) and bound by `NotificationsModule.forRoot` — a test injects a fake there.
   `EVOLUTION_API_URL` + `EVOLUTION_API_KEY`: both or neither; neither = linking answers 503 (`unknown`,
   with `details: { code: "unavailable" }` when unconfigured; the contract has no `unavailable` code); one
   without the other, or a URL that is not a plain http(s) origin, stops the start naming the variable.
   Unreachable, a timeout, a 5xx, a refused key or an unknown answer are one 503; nothing of the request or
   the reply (key, QR, number) is chained, kept or logged.
3. **No lock across the network.** Every link write is: a decision under the per-clinic
   `whatsapp_channel:` advisory lock → Evolution → a write under the lock again on the row as it is then.
   A 60-second `operation_id` / `operation_expires_at` reservation spans those transactions so concurrent
   link, refresh, unlink and credential changes cannot race on the shared instance. Busy requests answer
   a generic 503; the worker defers sends during the reservation. Release checks the operation id, and a
   crashed process's reservation expires. Database locks are released before every network request.
4. **Linking by QR** (`POST /v1/clinic/whatsapp/connect`): the risk acceptance is recorded once per risk
   text version (`clinic.whatsapp_risk_accepted`, `{ riskVersion }`); the instance `eyadex-<clinic id>` is
   created once (integration `WHATSAPP-BAILEYS`, **`qrcode: false`**, because Evolution waits 5 s before
   answering a create with `qrcode: true`), then `instance/connect` answers the QR. `instance_name` is set
   only while an Evolution instance exists for the row's transport. `GET /v1/clinic/whatsapp/qr` reads the
   connection state and, once open, turns `pending` into `connected` with the last four digits of the
   owner (`clinic.whatsapp_connected`); it needs the update key, since a scanned QR links a number.
   Missing base64 (only code/count) stays pending with null QR; bare base64 gains the PNG data-URL prefix.
   A linked coexistence number refuses an Evolution link (`validation`, `["transport"]`,
   `coexistence_linked`).
5. **Unlinking** (`POST /v1/clinic/whatsapp/disconnect`) logs the Evolution number out (the instance is
   kept for the next link); coexistence unlinking makes no external call. It sets `disconnected`
   (`clinic.whatsapp_disconnected`, `{ transport }`). Without Evolution configured it only clears the row.
   `whatsapp_enabled` is left as saved; the worker skips with `whatsapp_disconnected`.
6. **Coexistence** (`PUT /v1/clinic/whatsapp/coexistence`): token write-only, sealed with
   `MAIL_PROVIDER_SEAL_KEY` bound to the channel row id, kept when omitted (required on first save).
   `MetaApi` / `HttpMetaApi` verifies with Graph v22.0 whenever transport, token or either id changes:
   GET phone number (`display_phone_number,verified_name`, last four digits retained), then POST business
   account `subscribed_apps`. No `/register`, no Evolution Business instance, no Evolution configuration
   requirement. Templates-only edits touch the row only. Every request has a 10 s timeout and refuses
   redirects; invalid credentials (400/401/403/190) are a token-field validation error
   `meta_credentials_invalid`; network/5xx/timeout are 503. The channel becomes connected with no
   `instance_name`. An Evolution number pending or linked refuses the switch (`evolution_linked`).
   Audit retains tokenChanged, status and templates only, never token or Meta ids.
7. **Settings and queueing.** `PUT /v1/clinic/notification-settings` refuses `whatsappEnabled: true` while
   the channel is not `connected` (`validation`, `["whatsappEnabled"]`, `whatsapp_not_connected`), also
   when it was on before and the channel dropped since. The N1 queue step adds one `whatsapp` ledger row and
   its `patient.notification_requested` event per message when WhatsApp is on, the message is on and the
   channel is `connected` — a plain read, so the ADR-0027 lock order is unchanged.

8. **Evolution webhook:** API-only `EVOLUTION_WEBHOOK_URL` and `EVOLUTION_WEBHOOK_SECRET` (at least 32 chars)
   are required with Evolution and forbidden without it. Docker's API listens on port 3000 (local API:
   default 3001). Create registers a nested webhook using v2.3.7 request fields `byEvents` and `base64`,
   both false, secret in `x-eyadex-webhook`, events MESSAGES_UPDATE and CONNECTION_UPDATE. Existing
   connects also POST `/webhook/set/:instance`. The exact fields are verified in
   [InstanceDto 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/dto/instance.dto.ts).
   `POST /v1/hooks/evolution` uses the shared Public declaration, an independent constant-time secret
   guard and the public Redis limiter. Only that exact POST permits an internal host; browser session,
   CSRF and origin checks do not apply. Wrong header is the existing bilingual 401 `unauthorized`
   (the brief's "unauthenticated" maps to the existing contract); unconfigured is 404. Unknown events,
   malformed input and unknown clinics are ignored with 200. Never log the body.
   Under withTenant from `eyadex-<uuid>`, message ERROR/0 with keyId/key.id changes matching sent
   WhatsApp/Evolution rows to failed (`evolution:evo_delivery_rejected`). Connection close disconnects
   only Evolution, clears connected_at, stores evo_connection_closed and audits with a system actor.
9. **Worker and ledger:** direct Meta templates use the row-bound SecretSealer, Graph v22.0, 15 s
   timeout and no redirects. Every successful WhatsApp send stores provider_message_id (at most 200):
   Evolution key.id / Meta messages[0].id; 0058 adds the tenant-prefixed partial index.
   The sent CHECK allows acceptance route/time on a failed row only for Evolution delivery rejection;
   all other unsent rows keep neither. History maps last_error to the coarse failureReason contract.
   Evolution timeout, rejected, unauthorized, not-on-WhatsApp, other 4xx and not-connected are final.
   Not-connected or a 5xx "Connection Closed" in either message field also disconnects the channel;
   later rows skip. Other 5xx and unreachable retry the N1 schedule. Meta unauthorized (401/190/10/
   200-299), template (132000-132015/132068/132069), not-on-WhatsApp (131026), timeout and other 4xx
   are final; rate-limited (4/80007/130429/131048/131056), 5xx and unreachable retry.

## Consequences

- Coexistence works independently of Evolution; a template edit needs no provider verification.
- No provider text, secret or full phone number is retained in logs, audit or the ledger.
- Evolution acceptance may later turn into failure; the original send timestamp remains evidence.
- Timeouts are final because retrying an ambiguously accepted WhatsApp message can send it twice.
- The worker app transaction budget is 30 s so Meta's 15 s deadline can finish and settle the ledger.
- 0057 and 0058 are still unapplied; this revision edits them without adding 0059 or touching applied SQL.
