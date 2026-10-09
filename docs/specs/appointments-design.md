# Appointments and scheduling — design (post-MVP phase 1)

- Status: design approved by the owner (2026-10-09). Not implemented yet.
- PRD: §8.3 item 1 ("appointments and scheduling + the `own` scope"), §4.7 (the `own` scope is reserved
  for this module), §4.8 (feature flags), §4.11 (audit), §5 (database rules), §7 (what stays out).
- Decision records to write with the slices: ADR-0026 (appointments model, overlap lock, `own` scope).
  ADR numbers 0023–0025 are taken by work in flight.

## 1. Owner decisions (2026-10-09)

| #    | Question                                  | Decision                                                                                                                                                                                                  |
| ---- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | Who can be booked                         | A per-user flag "accepts appointments" set by the clinic admin on the membership (a doctor, a laser technician, a therapist…). Never derived from the role name.                                          |
| D-2  | How long an appointment is                | All three, layered: a clinic **service** carries a duration; with no service the **provider's default duration** applies; the start and end stay freely editable on every booking.                        |
| D-3  | Two appointments for one provider at once | **Blocked**, unless the user holds `overbook:appointments:*`; then the appointment is saved with `overbooked = true` and the audit row says so.                                                           |
| D-4  | What `own` means for patients             | A patient is "mine" when they have **at least one appointment with me that is not cancelled** (past or future).                                                                                           |
| D-5  | Statuses                                  | `booked` → `arrived` → `completed`. `no_show` only from `booked`. `cancelled` from `booked` or `arrived`, with a mandatory reason.                                                                        |
| D-6  | Working hours                             | A weekly schedule per provider per branch (clinic wall-clock time) plus time-off periods. Booking outside the schedule or inside time off is **blocked**, with the same `overbook` exception as D-3.      |
| D-7  | Calendar views                            | Branch day (one column per provider), provider week, month, and today's queue.                                                                                                                            |
| D-8  | What the default "doctor" role can do     | See its own appointments and its own patients only (`view:appointments:own`, `view:patients:own`). Booking and editing stay with the front desk; the clinic admin can widen any role on the roles screen. |
| D-9  | Module flag                               | `appointments` is a per-clinic module the platform can switch off, like `patients`, and it joins the new-clinic default modules (platform settings).                                                      |
| D-10 | Booking someone with no file              | A quick file from the booking dialog: name, mobile, branch — same rules as patients (duplicate mobile blocked) and needs `create:patients:*`. The rest of the file is completed later.                    |
| D-11 | Cancel and reschedule                     | Cancel needs a reason from a short list (patient cancelled, provider cancelled, other) and an optional note. Reschedule moves the same appointment; the old time is kept in the audit log.                |
| D-12 | Who manages the services list             | The clinic admin; one clinic-level list (name ar/en, duration, active). No prices — prices come with the finance phase.                                                                                   |
| D-13 | How overlap is prevented                  | A per-provider transaction lock (`pg_advisory_xact_lock`) and the check in the use case, like branches and users today. No new PostgreSQL extension.                                                      |

## 2. Data model (all clinic tables: `clinic_id`, PK `(clinic_id, id)`, RLS enabled + forced, CLAUDE.md §5)

| Table / change              | Columns (besides `clinic_id`, `id`, timestamps)                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clinic_services` (new)     | `name_ar`, `name_en`, `duration_minutes` (5–480), `status` (`active`/`inactive`). Unique names per clinic like roles.                                                                                                          |
| `memberships` (new columns) | `accepts_appointments boolean NOT NULL DEFAULT false`, `default_duration_minutes` (5–480, default 20).                                                                                                                         |
| `provider_schedules` (new)  | `membership_id`, `branch_id`, `weekday` (0–6), `starts_at time`, `ends_at time` (`starts_at < ends_at`). Wall-clock time in the clinic time zone. Several rows per day allowed (split shifts), never overlapping per provider. |
| `provider_time_off` (new)   | `membership_id`, `starts_at timestamptz`, `ends_at timestamptz`, `note` (optional, short).                                                                                                                                     |
| `appointments` (new)        | `branch_id`, `patient_id`, `provider_membership_id`, `service_id` (nullable), `starts_at`, `ends_at` (timestamptz, UTC), `status`, `overbooked`, `cancel_reason`, `cancel_note`, `created_by`.                                 |

- Indexes start with `clinic_id`: `(clinic_id, provider_membership_id, starts_at)`, `(clinic_id, branch_id, starts_at)`,
  `(clinic_id, patient_id)`, and `(clinic_id, provider_membership_id, patient_id) WHERE status <> 'cancelled'` for the
  `own` predicate. Every FK indexed (the `fk-indexes` test).
- Grants: `eyadex_app` only. **No grant to `eyadex_platform`** — appointments name patients, and the platform never
  sees patient data (CLAUDE.md §8).
- No hard deletes: services are deactivated, appointments are cancelled, schedules are replaced (a schedule row is
  configuration, not history; its changes are audited).
- Every new table goes into `db/tests/rls-isolation.sql` (table list + seed) and the Drizzle mirror in the same PR.

## 3. Permissions (catalogue additions)

| Resource       | Actions                          | Scopes                  |
| -------------- | -------------------------------- | ----------------------- |
| `appointments` | view                             | clinic, branch, **own** |
| `appointments` | create, update, overbook         | clinic, branch          |
| `services`     | view, create, update, deactivate | clinic                  |
| `schedules`    | view, update                     | clinic, branch          |
| `patients`     | view (adds a scope)              | clinic, branch, **own** |

- `update:appointments` covers reschedule, status changes and cancel. `overbook` alone grants nothing: it only lifts
  D-3 / D-6 for a user who can already create or update in that scope.
- `own` is evaluated in the query: appointments where `provider_membership_id` = the caller's membership; patients with
  an `EXISTS` on a non-cancelled appointment with the caller (D-4). The guard still runs PRD §4.7 in order; `own`
  is the narrowest scope and a wider scope held on the same action wins.
- New clinics' system roles: doctor = `view:appointments:own` + `view:patients:own` (replacing `view:patients:branch`);
  receptionist = view/create/update appointments `branch`, `view:schedules:branch`, `view:services:clinic`.
  **Existing clinics' roles are not changed** by a migration; their admins adjust roles on the roles screen.

## 4. Rules

1. A provider is bookable only while their membership is active and `accepts_appointments` is on.
2. Booking: the branch is in the user's create scope; the provider has a schedule row in that branch covering the
   whole interval (clinic wall time); no time off overlaps it; no other non-cancelled appointment of that provider
   overlaps it. Any failure → a specific error code, unless the user holds `overbook` (then `overbooked = true`).
3. The overlap check and the insert/update run in one transaction holding
   `pg_advisory_xact_lock(hashtextextended('appointments:' || clinic_id || ':' || provider_membership_id, 0))`.
4. Duration: service duration, else the provider default; the client may send any `ends_at > starts_at` (max 8 h).
5. Status transitions exactly as D-5; anything else → `invalid_transition`. Cancel requires `cancel_reason`.
6. Reschedule = update of `starts_at`/`ends_at` (and optionally provider/branch) through rule 2; the audit row keeps
   the old and new times.
7. The patient must be active (not archived) to be booked. The quick file (D-10) is created through the existing
   patients use case in the same request flow, with its own `Idempotency-Key`.
8. Creating an appointment accepts `Idempotency-Key` (sensitive create, CLAUDE.md §6).
9. Every create, reschedule, status change, cancel, service change, schedule change and flag change writes one clinic
   audit row (administrative category; no phone or civil ID in before/after).
10. The module flag `appointments` off → every appointments, services and schedules route answers `module_disabled`.
11. Times are stored UTC and shown in the clinic time zone; schedules are clinic wall-clock times.

## 5. Screens (clinic area, ar + en, RTL, logical CSS, shadcn/ui)

- **Branch day**: one column per bookable provider in the branch, the schedule shaded, appointments as blocks;
  click an empty slot to book.
- **Provider week** and **month** (month shows counts per day, opens the day).
- **Today's queue**: today's appointments in the user's scope with status actions (arrived, completed, no-show,
  cancel).
- **Booking dialog**: patient search or quick file, provider, service (optional), start, end (pre-filled), with the
  rule-2 errors explained; the overbook switch appears only for users who hold it.
- **Settings**: services list; per-user "accepts appointments" + default duration on the user editor; weekly
  schedule and time off per provider.
- The doctor with `own` sees the same views filtered to themself; buttons they cannot use are hidden (UX only — the
  API rejects as well).

## 6. Slices (each: contract → SQL + RLS + negative test → domain + tests → API → mock + web → tests → Codex → CI → merge → staging → production)

| Slice | Scope                                                                                                  | SQL    |
| ----- | ------------------------------------------------------------------------------------------------------ | ------ |
| A1    | Services, "accepts appointments" + default duration, weekly schedules, time off; catalogue + flag      | 1 file |
| A2    | Appointments: book, reschedule, status, cancel, quick file, overbook; branch day view + booking dialog | 1 file |
| A3    | The `own` scope on appointments and patients (search, list, open), new-clinic doctor role              | 0–1    |
| A4    | Provider week, month, today's queue                                                                    | none   |

## 7. Out of this phase

Patient reminders (notifications phase), prices and payments (finance), online self-booking (landing page builder),
recurring appointments, waiting lists, resources/rooms, video visits.

## 8. Tests that must exist

- Domain: overlap, schedule coverage (incl. split shifts and an interval crossing midnight → rejected), time off,
  transitions table, duration resolution, overbook lifting only rule 2's checks.
- `test:db` as `eyadex_app`: RLS negatives for every new table (cross-clinic read 0 rows, write error); two
  concurrent bookings for one provider → exactly one succeeds; `own` returns only the caller's appointments and
  patients; cancelled appointments do not make a patient "own"; the platform role has no grant.
- Web: views filtered by scope, booking dialog errors, hidden actions, ar/en strings present.
