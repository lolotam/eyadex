# ADR-0026 — Appointments model, the provider lock and the `own` scope

- Status: accepted for slice A1 (design owner-approved 2026-10-09, `docs/specs/appointments-design.md`,
  decisions D-1..D-17)
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
- Doctor and receptionist defaults for new clinics change in A3 (spec §3), together with the `own` queries; A1 has
  no screen either role needs. TODO(spec): if A2 ships before A3, decide whether the receptionist defaults move to A2.

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

## Consequences

- A2 books against these tables under the same lock and calls `coversWallInterval` for D-6/D-14.
- CLAUDE.architecture.md §2.2 lists the module; §3 lists `provider_schedules` as the one deletable configuration table.
- Deployment: 0042 is additive for the code before it (old code drops catalogue keys it does not know, names only the
  old `platform_settings` columns, and never inserts the new ones), so it is applied right before this code ships;
  the new code needs it (new columns, tables, the widened CHECK). A clinic created by the old code between the two
  steps gets no appointments keys on its locked admin (Codex, PR #63). After every deploy of this code,
  `db/tests/appointments-admin-keys.sql` is run on the live database (read-only, as the migration owner); it names
  any such clinic, and 0042's final `INSERT … ON CONFLICT DO NOTHING` (idempotent) is then re-run.
