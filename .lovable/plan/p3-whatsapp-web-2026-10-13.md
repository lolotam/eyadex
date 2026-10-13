# Phase 3 N2 — web: WhatsApp notifications

Branch: `lovable`. Spec: `docs/specs/notifications-design.md` §7 and §7.1. Rules: `CLAUDE.md` (read fully first),
`CLAUDE.architecture.md`. Builds on N1 (the Notifications and Email settings tabs you already made).

Frozen contracts (do not edit; if one looks wrong, stop and say so):

- `packages/contracts/src/whatsapp.ts` — transport (`evolution` / `coexistence`), status, `WHATSAPP_RISK_VERSION`,
  `whatsappTemplateSchema`, `whatsappChannelViewSchema`, `whatsappConnectRequestSchema`,
  `whatsappQrResponseSchema`, `whatsappCoexistenceRequestSchema`.
- `packages/contracts/src/notifications.ts` — `notificationSettingsSchema` gained `whatsappEnabled`
  (default `false`); channel `whatsapp`; skip reasons `whatsapp_disconnected`, `template_missing`; routes
  `evolution`, `coexistence`.

Do not edit `packages/contracts`, `apps/api`, `apps/worker`, `db/`, `docs/adr`. Every string ar + en; logical
CSS; shadcn/ui only; the mock refuses exactly what the API refuses.

## 0. Type errors first

`notificationSettingsSchema` now requires `whatsappEnabled`: fix the mock state/seed (default `false`), forms,
fixtures and tests so `pnpm --filter @eyadex/web typecheck` passes.

## 1. Settings → new tab "WhatsApp"

Shown with `view:clinic_settings:clinic`; actions need `update:clinic_settings:clinic`.

- `GET /v1/clinic/whatsapp` → `whatsappChannelViewSchema`. Status badge (disconnected / waiting for scan /
  connected …1234), the transport, connected time, last error code in words.
- Two choices (cards), one active at a time:
  1. **Link by QR (Evolution)** — a red/amber warning box, verbatim meaning (ar + en):
     "This links the clinic's WhatsApp number through an unofficial connection. WhatsApp may ban the
     number at any time, permanently. Use a number you can afford to lose, keep sending low, and never use
     it for marketing." Checkbox "I understand and accept this risk" (required) → **Connect** →
     `POST /v1/clinic/whatsapp/connect` `{ acceptRisk: true, riskVersion: WHATSAPP_RISK_VERSION }` →
     `whatsappQrResponseSchema`. Show the QR image (`qrDataUrl`) with steps: open WhatsApp on the clinic's
     phone → Linked devices → Link a device → scan. Poll `GET /v1/clinic/whatsapp/qr` every 3 s while
     `pending` (stop when `connected`, when the dialog closes, or after 2 minutes with a "refresh QR"
     button). Once accepted, the risk box shows "Accepted on <date>" instead of the checkbox.
  2. **WhatsApp Business (coexistence)** — form: access token (write-only, "stored" hint when
     `hasCredentials`), phone number id, business account id, and one template per message kind
     (name + language, optional; empty = that kind is not sent on WhatsApp). Help text explains Meta must
     approve each template (utility category, charged by Meta per message) and the parameter order from
     `whatsappTemplateSchema`'s JSDoc. `PUT /v1/clinic/whatsapp/coexistence`.
- **Disconnect** (confirm dialog) → `POST /v1/clinic/whatsapp/disconnect`.
- When the server answers `unavailable` (WhatsApp not configured on this server), show a calm empty state.

## 2. Notifications tab

Add the switch "Send WhatsApp messages" (`whatsappEnabled`) next to the email one. It is disabled with the
hint "Link WhatsApp first" while the channel is not `connected`; the server refuses it too
(`validation`, path `["whatsappEnabled"]`, code `whatsapp_not_connected`).

## 3. Message history

The existing history lists (appointment, signed visit) show the channel (email / WhatsApp icon + label),
the new routes (Evolution, WhatsApp Business) and skip reasons (WhatsApp not connected, no template).

## 4. Mock

Mirror §7.1: a mock channel per clinic; connect records the risk once and moves to `pending` with a fixed
placeholder QR (a tiny valid PNG data URL), then `connected` with `phoneLast4: "0000"` after 6 s; disconnect;
coexistence save (token write-only, kept when omitted); the settings refusal; when booking/rescheduling/
cancelling/signing, also queue `whatsapp` rows when enabled and connected (sent with route `evolution`
or `coexistence`, or skipped `template_missing` for coexistence without a template).

## 5. Done when

`pnpm typecheck`, `pnpm lint` (0 errors), `pnpm test` pass; vitest for: risk gate, QR polling stop
conditions, disconnect, coexistence token write-only, the WhatsApp switch refusal, history labels, mock
queueing. Arabic and English at 1440 px and 390 px. «المراجع», never «المريض». Small conventional commits;
list the files you touched.
