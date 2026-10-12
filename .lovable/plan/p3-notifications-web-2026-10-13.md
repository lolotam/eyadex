# Phase 3 N1 — web: patient email notifications

Branch: `lovable`. Spec: `docs/specs/notifications-design.md` (§1 owner decisions, §6 web). Rules: `CLAUDE.md`
(read it fully first) and `CLAUDE.architecture.md`.

The contracts are frozen by the orchestrator; the API is built in parallel to the same contracts:

- `packages/contracts/src/notifications.ts` — notification kinds, statuses, skip reasons, routes,
  `notificationSettingsSchema` + `DEFAULT_NOTIFICATION_SETTINGS`, `patientNotificationListSchema`,
  `messageLanguageSchema`, `mailProviderSlotSchema`.
- `packages/contracts/src/patients.ts` — `patientSchema` and `patientInputSchema` gained `email`,
  `messageLanguage`, `notificationsOptOut`.
- `packages/contracts/src/mail-provider.ts` — existing single-provider request/view, plus
  `mailProvidersResponseSchema` (both slots).
- `packages/contracts/src/onboarding.ts` — `moduleDependencyGap` / `MODULE_REQUIRES` (medical needs patients).

Do not edit `packages/contracts`, `apps/api`, `apps/worker`, `db/`, `docs/adr`. If a contract looks wrong,
stop and say so instead of changing it. Every string through i18n (ar + en); logical CSS only; shadcn/ui only;
the mock adapter must reject exactly what the API rejects (hiding a control is not protection).

## 0. Fix the type errors first

The patient contract gained three required input fields. Make `pnpm --filter @eyadex/web typecheck` pass:
patient form defaults (`email: ""`, `messageLanguage: ""`, `notificationsOptOut: false`), the quick-file form in
the booking dialog (same defaults, fields not shown there), mock seed data (`email: null`,
`messageLanguage: null`, `notificationsOptOut: false` — never a real address; use `@example.invalid`
if a seed needs one), fixtures and tests.

## 1. Patient file

Patient create/edit form gets a "Messages" section:

- Email (optional) — `validation.email` on a bad address.
- Message language — select: "Clinic default" (`""`), العربية (`ar`), English (`en`).
- Switch "Does not receive reminders" (`notificationsOptOut`), hint: "Confirmation, change and cancellation
  messages and the prescription are still sent."
- Patient details page shows the email (or "—") and the two settings.
- Mock: store and return the three fields; email is lower-cased and trimmed by the contract.

## 2. Clinic settings — two new tabs (`apps/web/src/settings/settings-tabs.ts`)

Both tabs are shown when the user holds `view:clinic_settings:clinic`; editing needs
`update:clinic_settings:clinic` (read-only otherwise).

### 2a. "Notifications" tab

- `GET/PUT /v1/clinic/notification-settings` (`notificationSettingsSchema`); a clinic that never saved gets
  `DEFAULT_NOTIFICATION_SETTINGS` from the server.
- One switch "Send email notifications" (`emailEnabled`), then one switch per message kind, in this order with
  a one-line hint each: booking confirmation, appointment changed, appointment cancelled, reminder the day
  before, reminder 2 hours before, the doctor's prescription after signing ("lists the medicines only, never the
  diagnosis"). When `emailEnabled` is off the six switches are shown disabled (values kept).
- A note under the list: messages never include the service name or medical details, except the prescription.

### 2b. "Email" tab (mail providers)

- `GET /v1/clinic/mail-providers` → `{ primary, fallback }` (each `mailProviderViewSchema | null`).
- Two cards, "Primary sender" and "Fallback sender". Each: empty state ("Not set — Eyadex sends on the clinic's
  behalf") or the provider summary (kind Resend/SMTP, from name/email, reply-to, SMTP host:port/user, status
  badge: verified / not verified / degraded + `lastError` text and the time).
- Set/replace: a side sheet with a kind switch (Resend: API key; SMTP: host, port select from `SMTP_PORTS`,
  user, password) plus from name, from email, reply-to — `PUT /v1/clinic/mail-providers/:slot` with
  `mailProviderRequestSchema`. Secrets are write-only: the form never shows a stored key/password; replacing
  needs it typed again.
- Remove: confirm dialog → `DELETE /v1/clinic/mail-providers/:slot` (204). Removing the primary while a
  fallback exists is refused by the server (`validation`); the UI disables it with a hint.
- Setting a fallback with no primary is refused (`validation`); the fallback card's button is disabled with a
  hint until a primary exists.
- "Send test email" → `POST /v1/clinic/mail-providers/:slot/test` with an `Idempotency-Key` header (202). Show
  "Test sent to your email; the status updates when the worker reports" and refetch after a few seconds. The
  server answers `rate_limited` during the cooldown — show its message.
- A help line under the cards: "Order: primary → fallback (only when the primary certainly did not accept the
  message) → Eyadex on the clinic's behalf, replies going to the clinic's email."
- Mock: store both slots in the mock state, never return credentials (`hasCredentials: true`), mark a new
  provider not verified; the mock test marks it verified after 2 s. Same validation and refusals as above.

## 3. Message history

- Appointment details (where status/cancel actions are): a "Messages" list from
  `GET /v1/appointments/:id/notifications` (`patientNotificationListSchema`): kind, status badge
  (queued/sent/skipped/failed), the skip reason in words (setting off, no email, opted out, not booked any more,
  appointment moved), route (primary/fallback/Eyadex), time. Empty state: "No messages yet".
- Visit page (signed visits): one line for the prescription email from `GET /v1/visits/:id/notifications`.
- Mock: when the mock books, reschedules or cancels an appointment, or signs a visit with prescription lines,
  append a queued row for each enabled kind (respecting the clinic settings) and mark it `sent` (route
  `platform` when no provider, else `primary`) or `skipped` (`no_email` when the patient has no email,
  `opted_out` only for reminders) after 1 s. Reminders are not simulated in the mock.

## 4. PR #70 follow-up — module switches

Platform clinic page, create-clinic form and platform settings: disable the medical switch while patients is
off, and the patients switch while medical is on, with the hint `validation.moduleRequires` (already in i18n).

## 5. Done when

- `pnpm typecheck`, `pnpm lint` (0 errors), `pnpm test` pass; vitest for: the patient form fields + mock
  persistence; notification settings save + read-only for a user without update; mail providers set/replace/
  remove/test + the two refusals; the history list rendering every status/skip reason; module switches.
- Arabic and English at 1440px and 390px. Use the vocabulary rules: «المراجع» (never «المريض»).
- Commit on `lovable` in small conventional commits; say which files you touched.
