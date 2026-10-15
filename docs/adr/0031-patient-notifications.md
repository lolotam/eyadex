# ADR-0031 — Patient notifications (phase 3 N1: email)

- Status: accepted (owner decisions N-1..N-7, 2026-10-12; `docs/specs/notifications-design.md`)
- Date: 2026-10-13

## Context

Phase 3 lets a clinic email its patients: a booking confirmation, a reschedule, a cancellation, a
reminder the day before and 2 hours before, and the doctor's prescription when a visit is signed (N-1,
N-5). The patient is not a user: the email is an address the clinic writes to, never a login or a reply
channel. The clinic picks a primary and an optional fallback mail provider; when both fail, Eyadex sends
on the clinic's behalf (N-3). Messages must never carry anything medical except the prescription lines
themselves (N-4, N-5), and the platform must never see any of it (CLAUDE.md §8).

The data layer is SQL 0053–0056: the patient file's `email`, `message_language` and
`notifications_opt_out`; `clinic_notification_settings` (one row per clinic, no row = every message on);
`clinic_mail_providers.slot`; and the `patient_notifications` ledger, unique per
`(clinic_id, subject_id, kind, channel, subject_at)` `NULLS NOT DISTINCT`.

## Decision

1. **A `notifications` API module owns the two new tables** (`clinic_notification_settings`,
   `patient_notifications`) and nothing else: `/v1/clinic/notification-settings` (view / update
   `clinic_settings:clinic`, one audited upsert, action `clinic.notification_settings_updated` on the
   `clinic` entity with the settings before and after), and the queue and history adapters
   `PgAppointmentNotifications` and `PgVisitNotifications`, exported from its `index.ts`.
2. **Appointments and medical queue through their own ports** (`AppointmentNotifications`,
   `VisitNotifications`), bound in `appointments.module.ts` / `medical.module.ts` to those adapters —
   the `PgBookingPatients` pattern. Their SQL never names the new tables (`module-boundaries.spec.ts`).
   New arrows: appointments → notifications, medical → notifications (index.ts, module file only).
3. **Queueing happens in the use case's own transaction, last**, after every lock it already takes:
   book → `booked`, a reschedule that changes something → `rescheduled`, a cancellation → `cancelled`,
   and a sign of a visit with active prescription lines → `prescription`. The step reads the clinic's
   settings with a plain `SELECT` (no lock); when the channel and the message are on it inserts one
   `queued` email row (`subject_at` = the appointment's start after the change, the start it had for a
   cancellation, `NULL` for the prescription; `requested_by` = the actor's membership) with
   `ON CONFLICT ON CONSTRAINT patient_notifications_once DO NOTHING` (2026-10-15 note: SQL 0062 turned the
   constraint into a partial unique index without invoices, so the writers now name its target —
   `ON CONFLICT (clinic_id, subject_id, kind, channel, subject_at) WHERE subject_type <> 'invoice'`; an
   invoice send is unique on `(clinic_id, send_request_id)`, finance spec R2-5), and only when a row was inserted it
   appends the outbox event `patient.notification_requested`. The ledger's patient foreign key takes its
   key-share lock on the patient row there, after the appointment or visit row — already its place in
   the ADR-0027 order — so no step is added to the lock order.
4. **No personal data in the outbox**: the event payload is exactly `{ "notificationId": "<uuid>" }`.
   The ledger holds no address and no text either. The worker reads the patient's current email,
   language and opt-out, the clinic's settings and the appointment or visit at send time, under the
   row's lock, and skips with a reason (`setting_off`, `no_email`, `opted_out`, `not_booked`, `moved`).
   The API does not check the opt-out or the email presence: both can change before the send.
5. **Mail provider slots** (`/v1/clinic/mail-providers`, `GET` both, `GET/PUT/DELETE /:slot`,
   `POST /:slot/test`): same bodies, permissions, idempotency, per-clinic test cooldown and audit as the
   single-provider routes, which stay as the primary's alias. Every write holds the per-clinic
   `mail_provider:` advisory lock, under which two refusals (`validation`, `details: [{ path: ["slot"],
code }]`) are decided: a fallback while no primary exists (`fallback_without_primary`), and removing
   the primary while a fallback exists (`primary_has_fallback`). The audit details and the test event
   name the `slot`. The primary keeps its old idempotency scope; the fallback has its own, so one key
   sent to both slots never replays the other's answer.
6. **The SMTP fallback rule** (spec §3.3, worker): a message moves from the primary to the fallback, then
   to the platform on the clinic's behalf, only when it was certainly not accepted — Resend unreachable,
   a timeout before any response, or a 5xx; SMTP a DNS, connect, TLS or authentication failure, or a
   4xx/5xx reply before the DATA command was accepted. A timeout or a dropped connection after DATA was
   sent retries the same route, because SMTP has no idempotency key and moving on could send twice. A
   provider is used only when verified and not degraded (ADR-0014). Staff invitations keep the primary
   route only.
7. **The patient file** stores the email trimmed and lower-cased (`""` → `NULL`), the message language
   (`""` → `NULL` = the clinic's default) and the opt-out. The email is personal data: the patient audit
   snapshot records `hasEmail` (plus the language and the opt-out), never the address, and logs redact
   addresses wherever they appear (`@eyadex/observability`).
8. **History reads** (`GET /v1/appointments/:id/notifications`, `GET /v1/visits/:id/notifications`) answer
   `patientNotificationListSchema` newest first, under the parent's view rules and module flag: an
   appointment the caller's `view:appointments` keys do not see, a visit outside its visits reach, and
   another clinic's id are all `not_found`. A message's status is metadata, so the read writes no
   patient-access row.

## Consequences

- A switched-off message or channel queues nothing at all; the worker's `setting_off` skip covers only a
  switch turned off between the queueing and the send.
- The uniqueness constraint makes every trigger idempotent (a replayed booking, a cancel repeated). It
  also means a reschedule back and forth (A → B → A → B) gets no second `rescheduled` row for start B,
  and a move that changes only the provider or branch at the same start gets no new one: the patient is
  not told about such a move again. Changing that needs a schema change, not an API change.
- The new audit action `clinic.notification_settings_updated` is not yet in
  `packages/contracts/src/audit.ts` (`CLINIC_AUDIT_ACTIONS`) and has no web label yet (the web's sync
  test pins the labels to that list), so the contract line and the ar/en labels must land together.
- The worker's invitation route must read the primary slot only (`slot = 'primary'`): a clinic can now
  hold two provider rows.
