# ADR-0032 — The clinic's WhatsApp channel (phase 3 N2, API)

- Status: accepted (owner decisions N-6, N-7, 2026-10-12; `docs/specs/notifications-design.md` §7.1)
- Date: 2026-10-13

## Context

N2 lets a clinic send the N1 messages over WhatsApp through its own number: an unofficial link by QR
through Evolution API (the number can be banned, so an admin accepts that risk first), or Meta's
Business Platform in coexistence mode through Evolution's Business integration (N-6). Evolution runs as
a dedicated container on the internal network (N-7). SQL 0057 adds `clinic_whatsapp_channels`; 0058 adds
`clinic_notification_settings.whatsapp_enabled` and widens the ledger's route and skip-reason checks.

## Decision

1. **The notifications module owns the channel table** (its third): the queue step and the settings rule
   read it, and no new arrow is needed.
2. **Evolution through a port.** `EvolutionApi` (create, connect, connection state, the owner's last four
   digits, logout, delete), implemented by `HttpEvolutionApi` (global key in the `apikey` header, 5 s
   timeout, redirects refused) and bound by `NotificationsModule.forRoot` — a test injects a fake there.
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
   A linked coexistence number refuses an Evolution link (`validation`, `["transport"]`,
   `coexistence_linked`).
5. **Unlinking** (`POST /v1/clinic/whatsapp/disconnect`) logs the Evolution number out (the instance is
   kept for the next link) or deletes the coexistence instance, then sets `disconnected`
   (`clinic.whatsapp_disconnected`, `{ transport }`). Without Evolution configured it only clears the row.
   `whatsapp_enabled` is left as saved; the worker skips with `whatsapp_disconnected`.
6. **Coexistence** (`PUT /v1/clinic/whatsapp/coexistence`): the access token is write-only, sealed with
   `MAIL_PROVIDER_SEAL_KEY` bound to the channel row id, kept when omitted (refused on a first save:
   `["accessToken"]`, `required`). The API deletes any instance of the clinic and creates the Business one
   (`WHATSAPP-BUSINESS`, `token`, `number` = phone number id, `businessId`) when the transport, the token or
   the Meta ids change; templates alone change the row only. The channel is then `connected`. An Evolution
   number being linked or linked refuses it (`["transport"]`, `evolution_linked`). The audit
   (`clinic.whatsapp_coexistence_updated`) holds `tokenChanged` and the status and templates before and
   after — no token, no Meta id.
7. **Settings and queueing.** `PUT /v1/clinic/notification-settings` refuses `whatsappEnabled: true` while
   the channel is not `connected` (`validation`, `["whatsappEnabled"]`, `whatsapp_not_connected`), also
   when it was on before and the channel dropped since. The N1 queue step adds one `whatsapp` ledger row and
   its `patient.notification_requested` event per message when WhatsApp is on, the message is on and the
   channel is `connected` — a plain read, so the ADR-0027 lock order is unchanged.

## Consequences

- A clinic can show WhatsApp switched on while its number is unlinked; its messages are skipped
  (`whatsapp_disconnected`) until it links again or switches WhatsApp off.
- Changing the coexistence token re-creates the Evolution instance (Evolution keeps the token as the
  instance's own key), so a send in flight at that moment may fail once and retry.
- The worker opens the token with `SecretSealer(MAIL_PROVIDER_SEAL_KEY).open(sealed, <channel row id>)`
  and keeps the pace in `next_send_at`, the one column the API never writes.
