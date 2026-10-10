# ADR-0026 — Appointments model, the provider lock and the `own` scope

- Status: accepted for slice A1 (design owner-approved 2026-10-09, `docs/specs/appointments-design.md`,
  decisions D-1..D-17); amended for slice A2 (§11, owner decisions 2026-10-10) and slice A3 (§12)
- Date: 2026-10-09

## Context

Post-MVP phase 1 adds appointments (PRD §8.3 item 1). The owner settled D-1..D-17. Slice A1 ships the
configuration the bookings of A2 will read: the module flag, its permission keys, the services list, a
member's booking profile, weekly schedules and time off. This record fixes what A1 decides and what A2–A4
inherit.

## Decision

### 1. Module, tables, flag

- `appointments` is a clinic module (D-9) like `patients`. It joins `CLINIC_MODULES` (ADR-0020 amendment: the
  one module list), so a clinic's features, a new clinic's `modules`, the platform clinic detail and the
  platform's `defaultModules` all carry it with no reshaping. 0042 follows that amendment's recipe:
  `clinic_features` and `permissions.module` accept the value, and `platform_settings.default_module_appointments`
  (NOT NULL, seeded **true** — D-9 "it joins the new-clinic default modules", temporary DEFAULT dropped in the same
  file, `UPDATE` granted to `eyadex_platform` only).
- Existing clinics get no `appointments` row, so the module stays off for them until the platform switches it on
  (ADR-0010). A new clinic gets one `clinic_features` row per module, each as the create request sent it; the
  create form pre-fills the request from the platform default (ADR-0020 amendment), so the server never picks a
  module.
- 0042 adds `clinic_services`, `provider_schedules`, `provider_time_off` (forced RLS, PK `(clinic_id, id)`,
  indexes leading with `clinic_id`, every FK indexed, `eyadex_app` only, `REVOKE ALL` from `eyadex_platform`) and
  `memberships.accepts_appointments`, `memberships.default_duration_minutes` (D-1, D-15). The `appointments`
  table is A2's.

### 2. Module boundaries

`apps/api/src/modules/appointments` owns services, schedules and time off. It reads members only through its
`ProviderDirectory` port (identity's `PgProviderDirectory`) and branches through `SchedulingBranchReader`
(tenancy's `PgFilingBranches`); both are bound in `appointments.module.ts`, the exception
CLAUDE.architecture.md §2.2 already grants platform and audit. A test pins the module's SQL to its own three
tables. The booking profile lives on the membership, so identity owns `GET/PUT /v1/users/:id/booking-profile`;
the routes are gated by the `appointments` flag.

### 3. The provider lock (D-13)

Every write about one provider runs in one transaction holding
`pg_advisory_xact_lock(hashtextextended('appointments:' || clinic_id || ':' || membership_id, 0))`
(`apps/api/src/shared/provider-lock.ts`): in A1 the booking profile, the weekly schedule and time off; from A2
the booking, reschedule and status changes. The check (overlap, coverage) and the write happen under it, so
two writes for one provider can never both pass. A path that also needs the clinic's `roles:` / `users:`
locks takes them first (the booking profile does). No PostgreSQL extension (no `btree_gist`).

### 4. Weekly schedules (D-6, D-14)

- Rows hold clinic wall-clock `time` values per weekday (0 = Sunday), `ends_at` may be `24:00`, one row never
  crosses midnight. A branch's week is saved whole: the use case deletes that provider's rows in that branch and
  inserts the new ones. `provider_schedules` is therefore the first entity table `eyadex_app` may `DELETE` from —
  configuration, not history; every save writes one `schedule.replaced` audit row with the old and new rows.
  It has no `UPDATE` grant.
- The replace unit is (provider, branch), so `update:schedules:branch` can never touch a branch outside the
  editor's reach.
- One invariant, no exceptions (one person, one place): a provider's rows never overlap, across **all**
  branches. Rows of an inactive branch or of a branch the provider no longer works in are _dormant_: they are
  never working hours (coverage reads one live branch only), but the save-time overlap check, under the provider
  lock, counts them like any other row. Neither reactivating a branch nor reassigning the provider re-checks
  schedules (those writes belong to tenancy and identity and stay as they are), so this is what keeps a dormant
  row from ever coming back as a double booking. Only pairs involving the wanted week count, so an old clash
  between two stored rows never blocks an unrelated branch.
- A blocked save always has a way out. The schedule read returns `dormantBranches` — dormant branches inside the
  caller's reach that still hold rows — and their rows in `shifts`; the Work schedules tab lists them read-only
  with "Remove these hours". Removing is the ordinary replace with an **empty** week, which the route accepts for
  an inactive branch or one the provider left (same `update:schedules` reach check, module on, one
  `schedule.replaced` row); a non-empty week there is still `branch_inactive` / `provider_not_in_branch`.
  A provider is visible (providers list, schedule read, replace route) when it works in a branch inside the
  caller's reach **or** still holds rows in one; seen only through such dormant rows, the caller gets just those
  branches and rows (no other branch, no time off unless its view keys reach the provider) and may only clear
  them with an empty week. Anyone else stays `not_found`.
- `schedule_overlap` carries `details.branchId` (the branch of the conflicting row, or the saved branch for a
  clash inside the week) only when the caller's **view** keys reach that branch; otherwise the error is unnamed, as
  the PR #63 rule hides other branches. A branch-scope editor blocked by such a row needs a clinic-scope editor
  to clear it.
- Every schedules write (week, time off) answers `{ schedule }`: the schedule clipped to the caller's view keys
  (`view:schedules:clinic` = every branch, `view:schedules:branch` = its own, none = no branch), never to the
  write key's reach: a role may hold `update:schedules:clinic` with only `view:schedules:branch`, and a `PUT` must
  not show what a `GET` hides. Time off is not per branch, so it is returned only when those view keys reach the
  provider at all. When the view keys cannot see the provider (the same rule as `GET`, dormant rows included),
  the answer is `{ schedule: null }`: not even its name or default duration. The web refetches after a write.
- The branch-scope keys reach the member's **active** branches only (`ClinicRequestContext.branchScope`); the
  mock builds the same reach. The web enables the weekly editor and the dormant-hours "clear" per branch: an
  `update:schedules:clinic` key everywhere, an `update:schedules:branch` key only in the session's branches
  (`/v1/me` `allBranches` / `branchIds`). UX only: the API refuses too.
- D-14 lives in `coversWallInterval` (`@eyadex/contracts/schedules`): back-to-back rows of one branch join, also
  across midnight and from Saturday 24:00 into Sunday 00:00. A2's booking check calls it.
- The drift test maps Drizzle's `time` to `time without time zone` (information_schema's spelling).

### 5. Booking profile (D-1, D-15)

`accepts_appointments` (default false) and `default_duration_minutes` (5–480, default 20) on the membership,
changed under `update:users:clinic` with the users path's locks, then the provider lock, then the membership row
(a schedule save holds the provider lock and then needs that row through its foreign key); one `user.booking_changed`
row (entity `user`). Only a clinic admin may change an admin's settings (ADR-0012 §15). Only an active member
with the flag on has a schedule to edit (`provider_not_bookable`). The users keys are core keys, so the web shows
the action only when the module is on as well (the API answers `module_disabled` otherwise).

### 6. Permissions

- Catalogue (spec §3): `view|create|update|overbook:appointments` (view also `own`), `view|create|update|deactivate:services:clinic`,
  `view|update:schedules` (clinic, branch) — 17 keys, module `appointments`. A role holds one scope per action on
  every resource (it was checked on patients only).
- `own` is the narrowest scope: `grantFor` grants it from `own`, `branch` or `clinic` keys, and an `own` key grants
  nothing wider. A3 evaluates it in the appointments and patients queries; `view:patients:own` is added in A3 with
  that query, so no A1 role can hold a key that would silently narrow patient access before it works.
- The locked Clinic Admin holds every clinic-scope key (PRD §5.3 "everything"). New clinics get them from
  `SYSTEM_ROLES` (now derived from the catalogue). Existing clinics' locked admin roles get the module's 10 clinic
  keys from 0042's backfill (D-16, owner-confirmed 2026-10-09): a locked role refuses every write (ADR-0017), so
  otherwise no existing clinic could ever open services or schedules. No other existing role changes. The backfill
  refuses to run unless the migration role is a superuser or bypasses RLS.
- Doctor and receptionist defaults for new clinics: the receptionist's moved to A2 (owner decision 2026-10-10, §11);
  the doctor's (`own`) stay with A3 and its queries.

### 7. Time off (D-6)

Instants with an offset, stored UTC. Never deleted: a mistaken period is cancelled (`cancelled_at`) — TODO(spec):
the spec names no removal for time off; cancel is the no-hard-delete reading. Adding or cancelling needs
`update:schedules:clinic`: a period blocks the provider in every branch, so a branch-scope editor may not set it
(TODO(spec), conservative). The note is free text about a person's absence and is never written to an audit row.

### 8. Audit

Entities `clinic_service`, `provider_schedule`, `provider_time_off` with allowlisted snapshots; actions
`service.*`, `schedule.replaced`, `time_off.added|cancelled`, `user.booking_changed`. The three new entities are
clinic-log only: they are not in `platformAuditEntitySchema`, so the platform audit API and the mock never return
them. The `platform_clinic_admin_audit` view (0013) still returns these administrative rows at the database level
(they hold no patient data, so the platform grants are unchanged). TODO(spec): the platform sees other
administrative clinic rows; whether staff absence should also be kept from the view itself is open.

### 9. Services (D-12)

Clinic-level list, names unique per language ignoring case and spaces (inactive ones included, like roles), 5–480
minutes, deactivated never deleted, create takes an `Idempotency-Key` (as branches, roles, patients).

### 10. Screens (D-17)

Services and work schedules are tabs of the clinic Settings page: `/clinic/settings` (General),
`/clinic/settings/services`, `/clinic/settings/schedules`. Each tab shows only to users who can view its resource
(`clinic_settings`, `services`, `schedules`); the Settings menu entry shows when the user can view any of the
three (`NavItem.anyOf`) and lands on the first tab they can see. No new top-level menu entries. The mock adapter
applies the API's check order (access before validation) and rules.

### 11. Slice A2 — appointments (owner decisions 2026-10-10)

- **Table (0043).** `appointments` exactly as spec §2: forced RLS, PK `(clinic_id, id)`, indexes leading with
  `clinic_id` (provider + start, branch + start, patient, service, and the `own` partial index on non-cancelled
  rows), every FK indexed, D-15 and D-11 as CHECKs, `eyadex_app` without `DELETE`, `REVOKE ALL` from
  `eyadex_platform`. `created_by` is the actor's user id with **no** foreign key: a foreign key to the actor's
  membership would take a second membership row lock at insert time, after the branch row (ADR-0027).
- **Platform view.** Appointment audit rows are administrative (rule 9) but record a patient's booking, so 0043
  re-creates `platform_clinic_admin_audit` without `entity_type = 'appointment'` rows, as it leaves out
  `patient` rows; the contract's platform filter drops `appointment.*` too.
- **Boundaries.** A new arrow appointments → patients: the `BookingPatientReader` port (name, file number, status;
  never phone, birth date or civil ID), implemented by patients' `PgBookingPatients`, bound in
  `appointments.module.ts`. The quick file (D-10) is **not** a cross-module write: the dialog calls the existing
  `POST /v1/patients` (its own `Idempotency-Key`, `create:patients:*`) and then books.
- **Routes** (`@RequiresFeature("appointments")` on each): `GET /v1/appointments/branches`, `GET
/v1/appointments/day?branchId&date` (`view:appointments:branch`), `POST /v1/appointments` (Idempotency-Key,
  `create:…`), `PUT /v1/appointments/:id` (reschedule), `POST …/:id/status`, `POST …/:id/cancel`
  (`update:…`). `own` keys reach nothing until A3.
- **Check order of a booking** (API and mock): guard → the action's reach covers the branch (`forbidden`) and,
  when `overbook` is asked, the overbook reach does too (`forbidden`) → idempotency claim → provider lock →
  membership row (`not_found`, `provider_not_bookable`) → patient row (`not_found`, `patient_inactive`) → branch
  row (`not_found`, `branch_inactive`, `provider_not_in_branch`) → service row (`not_found`, `service_inactive`)
  → the end (rule 4, D-15) → rule 2 in order: coverage on that branch's rows (D-6, D-14), time off, live
  appointments of the provider in **every** branch → insert, one `appointment.booked` row, key completed.
- **Overbook (D-3)** lifts exactly rule 2's three checks; `overbooked` is set only when one was lifted, and is
  recomputed on a reschedule. Asking for it without `overbook:appointments:*` at that branch is `forbidden`.
- **Reschedule** locks the old and new providers (sorted), then the row `FOR UPDATE`; when a concurrent
  reschedule moved it to another provider meanwhile, the transaction rolls back and starts over (at most three
  times) rather than take that provider's lock while holding the row. It runs the same checks (the file must
  still be active, rule 7) excluding itself, and audits old and new times; the same values write nothing.
- **Statuses** follow D-5 (`invalid_transition` otherwise); the same status again is a no-op without an audit row.
  A cancel needs a reason (`patient_cancelled|provider_cancelled|other`); the note is stored on the appointment
  but never in an audit row.
- **Audit (rule 9).** Entity `appointment`, actions `appointment.booked|rescheduled|status_changed|cancelled`,
  allowlist: provider name, branch, service names, times, status, overbooked, cancel reason — no patient name,
  phone, id or note.
- **Answers.** Every write answers `{ appointment }` clipped to the caller's `view:appointments` reach (`null`
  outside it), as the schedule writes of §4.
- **Receptionist (owner).** New clinics' receptionist gets `view|create|update:appointments:branch`,
  `view:schedules:branch`, `view:services:clinic` (`SYSTEM_ROLES`, web `ROLE_TEMPLATES`). Existing clinics' roles
  are not changed by a migration.
- **Owner-confirmed (2026-10-10):** (1) D-10 names "name, mobile, branch", but the patients use case D-10 reuses
  also requires birth date and gender (`NOT NULL` since 0010): the quick file asks for them too and leaves the
  civil ID for later; relaxing the patient file is a separate decision if ever needed. (3) A booking in the past is
  accepted (walk-ins recorded after the fact); every booking is audited.
- **Known gap, fixed in A3 (§12.1):** the day bounds and the grid assumed local midnight exists (Codex, PR #64).
- **TODO(spec), conservative choices:** (2) Only a `booked` appointment is rescheduled. (4) The provider
  must work in the branch and the branch be active; `overbook` lifts neither. (5) The patient search in the
  dialog uses `view:patients` (a booker without it can only make a quick file).

### 12. Slice A3 — the clinic day bounds and the `own` scope (owner 2026-10-10)

#### 12.1 The clinic day starts at its first real instant

- `clinicDayBounds(date, tz)` (`@eyadex/contracts/clinic-time`) is the day from the first instant whose clinic wall
  date is `date` to the first instant of the next date: its midnight, the **earlier** reading when the clock repeats
  midnight, or the clock change itself when the clock skips midnight. It reads every offset the zone uses within a
  day and a half of the date and halves whole minutes across a skipped midnight, so any gap or overlap of a few
  hours in any IANA zone is handled. The API's `clinicDay`, the web grid (`dayStartMs`, `dayLength`) and the
  mock's day all use it.
- What was actually broken: `wallToInstant(date, "00:00")` (two passes) resolves a skipped midnight with the
  offset **before** the change. East of UTC (`Africa/Cairo`, `Asia/Beirut`) that lands exactly on the change, so
  the Cairo day of 2027-04-30 already started at 01:00 and lasted 1380 minutes; the Cairo case named by Codex did
  not reproduce. West of UTC (`America/Havana`, `America/Santiago`, `Atlantic/Azores`) it lands an hour
  **before** the change, so the day started at 23:00 of the previous date and lasted 1440 minutes, and the evening
  before showed on the wrong day. The tests pin both (Cairo, Havana, Santiago, Azores, a repeated midnight in
  Havana, Kuwait every day of a year).

#### 12.2 The `own` scope (spec §3, D-4, D-8)

- **Wider wins** (`grantFor`, PRD §4.7): a caller holding `clinic` or `branch` on the same action keeps that reach;
  `own` applies only when it is the caller's widest key. `own` exists for `view` only.
- **Appointments `own`**: rows whose `provider_membership_id` is the caller's membership
  (`ClinicRequestContext.membershipId`). `GET /v1/appointments/branches` and `/day` now `@Require`
  `view:appointments:own` (the guard admits own, branch and clinic holders); the queries narrow
  (`appointmentViewReach`, `dayBranches`, `viewSees`). Writes keep their `:branch` requirement.
- **Patients `own`** (D-4): files with at least one appointment with the caller that is not cancelled, past or
  future, in any branch:
  `EXISTS (SELECT 1 FROM appointments a WHERE a.clinic_id = p.clinic_id AND a.patient_id = p.id
AND a.provider_membership_id = $m AND a.status <> 'cancelled')`, on 0043's partial index
  `appointments_clinic_provider_patient_live_idx` (no new index). It applies to the list page and its total, to
  `GET :id` (which still writes `patient.opened`; a file that is not own is `not_found`, like an unknown id) and to
  the visibility of a write's answer. `POST /v1/patients/search`, `GET /v1/patients/branch-options/view` and
  `GET /v1/patients/:id` now `@Require` `view:patients:own`; writes are unchanged.
- **Cross-module read.** `appointments` already binds patients' `PgBookingPatients`; a patients port implemented
  by appointments would close an import cycle. So the patients module's own SQL names the `appointments`
  relation read-only, in that one `EXISTS` predicate, in `modules/patients/queries/own-patients.ts` only, and
  imports nothing of appointments. `module-boundaries.spec.ts` pins it: the patients module's SQL names only
  `patients`, `clinic_counters` (and the `jsonb_array_elements_text` set function of its scope filter), plus
  `appointments` in that one file (CLAUDE.architecture.md §2.2).
- **Catalogue (0044).** `view:patients:own` (module `patients`) joins the catalogue (41 keys). The locked admin does
  not get it (D-16 covers clinic-scope keys; `view:patients:clinic` is wider); no existing role changes.
- **New clinics' doctor** (D-8): `view:appointments:own` + `view:patients:own` (`SYSTEM_ROLES`, the web
  `ROLE_TEMPLATES`, the landing's keyring sample). Existing clinics' doctor roles are not changed by a migration.
- **Granting `view:patients:own` (Codex A3 r1).** A file is own by its appointments, in any branch, so a branch
  key does not bound it: a branch-scoped user manager could otherwise give a member of its branches the doctor
  role and reach files registered in every branch. When granting or defining a role (`uncoveredKeys`, ADR-0017
  §6), only `view:patients:clinic` covers `view:patients:own` (not a branch key, not the own key itself); the
  route guard's `grantFor` is unchanged. `view:appointments:own` stays covered by a branch key: its day is
  bounded by the member's own branches, which the granting bound already keeps inside the actor's. So inviting
  or moving a member into the new doctor role needs `view:patients:clinic` and a `view:appointments` key; the
  clinic admin holds both.
- **Web.** `view:appointments:own` shows the Appointments entry and the branch day (inverting the PR #64 rule that
  hid them while own reached nothing), read-only: the day's `can` is false, so no slot or status control shows.
  An own-only user's empty day and empty patients list say so in plain words. The roles editor offers
  `view:patients:own` as a scope of the patients view, as it does for appointments. The mock follows the same
  rules (`mock-own-scope.ts`).
- **TODO(spec), conservative choices:**
  1. Patients `own` ignores the appointments module flag: with the module off the rows still exist and say who
     the provider saw, so the doctor keeps seeing its files.
  2. With only `own`, `GET /v1/appointments/branches` lists the active branches of the caller's own membership
     (all of them for "all branches"), even with no appointments there. The day of such a branch shows only the
     caller's column (its shifts and time off there, its live appointments there), or no column at all when the
     caller would not have one; a branch outside the membership is `not_found`. `can` is all false unless a
     wider key says otherwise.
  3. With only `own`, `GET /v1/patients/branch-options/view` returns the active branches of the caller's own
     membership; the list's branch filter narrows only within the caller's own files, and an own file registered
     in another branch stays visible.
  4. The `own` predicate lives in the patients module's SQL (above), not behind a port.
  5. A write's answer under `view:appointments:own` (a caller who also holds a branch-scope create or update) is
     `{ appointment }` only when its provider is the caller, otherwise `null`. A patients write answer under an
     own-only view carries `detail` only when the written file is own in the same transaction, so a file the caller
     just created (no appointment yet) answers `detail: null`.
  6. Granting `view:patients:own` needs `view:patients:clinic`, even for an all-branch actor holding
     `view:patients:branch` (which reaches every branch too): one rule, no reach arithmetic.
  7. A duplicate phone or civil ID is never disclosed under an own-only view (`validation`), even when the
     existing file is the caller's own: disclosure would need a database read inside the duplicate check, and the
     plain error leaks nothing.

### 13. Slice A4 — provider week, month, today's queue (2026-10-10)

No SQL. Two reads, both per branch like the day, because every appointments key is branch-scoped
(`packages/contracts/src/appointment-calendar.ts`, `apps/api/src/modules/appointments/queries/appointment-calendar.ts`):

- `GET /v1/appointments/week?branchId&providerMembershipId&weekStart`: one provider, seven clinic days from
  `weekStart` — that weekday's rows of this branch, time off touching each day, and the live appointments touching
  the week. A provider unknown to the clinic is `not_found`; a provider with no rows in the branch is an empty week
  with `bookable` computed exactly as a day column.
- `GET /v1/appointments/month?branchId&month=YYYY-MM[&providerMembershipId]`: every day of the month with the live
  (not `cancelled`) appointments of the branch counted on the clinic day they **start** (one `GROUP BY`).
- Both follow the day's branch rule (`reachableBranch`, now shared with the day). Under `view:appointments:own`
  only the caller's own provider is readable: another provider is `not_found`, and the month always counts the
  caller's own. A wider key held beside `own` wins.
- Today's queue has no read of its own: it is the branch day for the clinic's today with the A2 status and cancel
  routes, actions only when `can.update` (UX only).
- The web (Lovable, `.lovable/plan/appointments-a4-web-2026-10-10.md`) shows Day / Week / Month / Today tabs kept in
  the URL as `view=`; weeks and month grids start on Sunday (Kuwait).

Conservative picks recorded on the owner's decisions page (batch 5, A4-1…A4-4), open to change: the week is one
branch, the week starts on Sunday, the queue is per branch, the month counts live appointments on their start day.
TODO(spec): a clinic-level first weekday setting if a non-Sunday market needs it; Arabic plural forms for the
month's count badge.

## Consequences

- A2 books against these tables under the same lock and calls `coversWallInterval` for D-6/D-14.
- CLAUDE.architecture.md §2.2 lists the module; §3 lists `provider_schedules` as the one deletable configuration table.
- Deployment: 0042 is additive for the code before it (old code drops catalogue keys it does not know, names only the
  old `platform_settings` columns, and never inserts the new ones), so it is applied right before this code ships;
  the new code needs it (new columns, tables, the widened CHECK). A clinic created by the old code between the two
  steps gets no appointments keys on its locked admin (Codex, PR #63). After every deploy of this code,
  `db/tests/appointments-admin-keys.sql` is run on the live database (read-only, as the migration owner); it names
  any such clinic, and 0042's final `INSERT … ON CONFLICT DO NOTHING` (idempotent) is then re-run.
- A2 (§11): 0043 is additive (a new table and the platform view without appointment rows; no catalogue or role
  change), so it can be applied before the A2 code ships; the A2 code needs it. Old code never reads the table.
- A3 (§12): 0044 is additive (one catalogue row, no role change) and is a hard prerequisite of the A3 code: new
  clinics' onboarding seeds the doctor role with `view:patients:own` and stops on a key the catalogue lacks. Apply
  it on staging, then production, before the A3 deploy. The old code is unaffected by it: no role holds the key,
  its role writes accept only its own catalogue's keys, and its `effectivePermissions` drops a stored key it does
  not know.
