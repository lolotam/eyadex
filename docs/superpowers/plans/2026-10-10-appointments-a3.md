# Appointments slice A3 — the clinic day without local midnight, and the `own` scope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slice A3 of the appointments design (spec §6 row A3). First fix the gap that ADR-0026 says A3 fixes first: the clinic day starts at its first real instant, even where the clock skips or repeats midnight. Then evaluate the `own` scope on appointments (day view, branch list) and on patients (search, list, branch options, open), and give new clinics' doctor role `view:appointments:own` + `view:patients:own`.

**Spec:** `docs/specs/appointments-design.md` D-4, D-8, §3, §4 rule 11, §5 (last bullet), §8; ADR-0026 "Known gap, fixed first in A3" (owner 2026-10-10); owner 2026-10-10: "A3 … the doctor sees their own appointments and patients; the first task is the Egypt midnight fix".

**Tech stack:** as A2. PostgreSQL 18, NestJS 12 on Fastify, Drizzle 0.45 mirror, postgres.js, Zod 3, TanStack Start + Query, shadcn/ui, vitest 4.

## Global Constraints

- Worktree `/f/Dev/Worktrees/eyadex/a3` (branch `appointments-a3`, base `origin/main` `2a5920f`). Line endings are LF. Never push, open a PR, or touch production, Dokploy or SSH.
- Every shell step starts with `source /f/Dev/Temp/claude/a3/env.sh`. It puts Node 24 on PATH, `cd`s into the worktree, and sets the six `EYADEX_TEST_*` URLs on port **55444**, Redis db **9**.
- Postgres container `eyadex-pg-a3` (port 55444). Create it as in `agent-pipeline.md`. Docker Desktop may still be starting, so retry `docker info`.
  - Check the database with `MSYS_NO_PATHCONV=1 sh /f/Dev/Worktrees/eyadex/dbcheck.sh eyadex-pg-a3 /f/Dev/Worktrees/eyadex/a3`.
- SQL file: `db/sql/0044_patients_own_scope.sql`. Never edit 0001–0043.
- ADR: add an **"A3" section to ADR-0026**, where the spec puts the `own` scope. Replace its "Known gap" bullet with what was fixed. Update `CLAUDE.architecture.md` §2.2 for the patients → `appointments` read below.
- Arabic JSDoc on every exported function in `domain/**` and every method in `ports/**`. Max 300 lines and one React component per file. Every UI string through i18n (ar + en).
  - The people a clinic serves are "المراجع/المراجعون", never "المريض/المرضى", and the word "كاشير/Cashier" must never appear.
  - Logical CSS only; permission strings only, never role names.
- Every new rule gets a test that **fails on the old code**; prove it once (stash, run, restore) and list the proofs in the report.
- Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Out of A3: week, month and today's queue views (A4); any `own` scope on writes; reminders; prices; the mock audit scrub chip.

### `own` semantics (binding)

- **Wider wins** (`grantFor`, PRD §4.7). A caller holding `clinic` or `branch` on the same action keeps that reach and is never narrowed to `own`. `own` applies only when it is the caller's widest key for that action.
- **Appointments `own`** means rows where `provider_membership_id` is the caller's membership (`request.clinicContext.membershipId`).
- **Patients `own`** (D-4) means files with at least one appointment whose `provider_membership_id` is the caller's membership and whose `status <> 'cancelled'`, past or future, in any branch.
  - It is evaluated in SQL as `EXISTS (SELECT 1 FROM appointments a WHERE a.clinic_id = p.clinic_id AND a.patient_id = p.id AND a.provider_membership_id = $m AND a.status <> 'cancelled')`.
  - That predicate uses the existing partial index `appointments_clinic_provider_patient_live_idx` (0043), so no new index is needed.
  - It applies to the list page and its total, `GET :id` (which still writes `patient.opened`), and the visibility of a write's answer.
- **Patients `own` regardless of the appointments flag:** `own` keeps working when the clinic's appointments module is off, because the rows still exist and say who the provider saw. Record this as TODO(spec) 1.

### Cross-module read decision (write it in ADR-0026 A3 and CLAUDE.architecture.md §2.2)

`appointments` already imports patients (`PgBookingPatients` is bound in `appointments.module.ts`). A patients port implemented by appointments would close an import cycle: patients.module → appointments/index → appointments.module → patients/index. So:

- The patients module's own SQL names the `appointments` relation **read-only, in that one `EXISTS` predicate**. It lives in one function in `modules/patients/queries/own-patients.ts`; nothing else is imported from appointments.
- Pin it in `apps/api/src/__tests__/…/module-boundaries.spec.ts` with a new test. The patients module's SQL may name only `patients`, its own idempotency and audit relations as they are today (list them from the code), and `appointments`, and `appointments` may appear only in `own-patients.ts`.

## TODO(spec) decisions (conservative), record them in ADR-0026 A3

1. Patients `own` ignores the appointments module flag (see above).
2. With only `own`, `GET /v1/appointments/branches` lists the active branches of the caller's own membership, all of them if the membership is "all branches", even with no appointments there. The day view of such a branch shows **only the caller's column**: their shifts and time off in that branch, and their live appointments there. `can` is all false unless a wider key says otherwise.
3. With only `own`, `GET /v1/patients/branch-options/view` returns the active branches of the caller's own membership. The list filter by registration branch still narrows only within the caller's own files. A file registered in another branch stays visible when it is "own".
4. The `own` predicate lives in the patients module's SQL (decision above), not behind a port.
5. A write's answer under `view:appointments:own` (a caller who also holds a branch-scope create or update) is `{ appointment }` only when the appointment's provider is the caller, otherwise `null`. This is the same rule as A2's clipping.

---

## Task 1 — The clinic day starts at its first real instant (ADR-0026 known gap)

Three places assume `wallToInstant(date, "00:00", tz)` is the start of the clinic day:

- API `clinicDay` in `apps/api/src/modules/appointments/queries/appointment-day.ts`;
- web `dayStartMs` and `dayLength` in `apps/web/src/appointments/day-grid.ts`;
- the mock in `apps/web/src/shared/api/mock/mock-appointments.ts` (around line 89).

On `Africa/Cairo` 2027-04-30 the clock jumps 00:00 → 01:00, so that "midnight" is an instant of the previous date.

- [ ] **1.1 Failing tests first** in `packages/contracts/src/__tests__/` (or next to `clinic-time.ts` tests, wherever they live):
  - Cairo 2027-04-30: the day's first instant reads `2027-04-30 01:00` in Cairo, and the day lasts **1380** minutes.
  - Cairo 2027-04-29 lasts 1440.
  - Cairo 2027-10-29 (fall back, its own rule; check with `Intl`) lasts 1500, or whatever `Intl` says, asserted from first principles.
  - A zone that **repeats** 00:00 picks the earlier reading. Find a real one with `Intl` before hard-coding it (for example `America/Havana`, `America/Santiago`, `Atlantic/Azores` or `America/Asuncion`). If none exists in the shipped ICU data, test the property with a zone whose fall-back hour is 01:00, and say so.
  - `Asia/Kuwait` (no DST) stays 1440 every day.
  - Add web `day-grid.test.ts` cases: on the Cairo spring day the first `wallRuns` run has `wallFrom: 60`; a `00:00–01:00` shift shades nothing; `labelAt(0)` is `01:00`.
  - Add one API `test:db` case: an appointment at Cairo 2027-04-30 01:10 appears in that day and not in the 29th.
- [ ] **1.2 Implement** one pure helper in `packages/contracts/src/clinic-time.ts`, e.g. `clinicDayBounds(date, tz): { startsAt, endsAt }`.
  - `startsAt` is the smallest instant whose clinic wall date is `date`. `endsAt` is the same for the next date.
  - It must stay correct for any gap or overlap up to a few hours, and for any IANA zone `Intl` knows.
  - Make **all three call sites** use it: API `clinicDay`, web `dayStartMs` and `dayLength`, and the mock. Search for any other `"00:00"` day-start use in `apps/` and `packages/` and fix it too.
- [ ] **1.3** Run the gates, commit `fix(appointments): the clinic day starts at its first real instant, also when midnight is skipped`, and record the failing-first proof.

## Task 2 — `own` on appointments

- [ ] **2.1** Add `membershipId` to `AppointmentActor` (`domain/booking-rules.ts`) and to `actorOf` in `http/appointments.controller.ts`, from `request.clinicContext.membershipId`.
- [ ] **2.2** Give the view reach a third shape:
  - `scheduling-scope.ts` / `booking-rules.ts` gets a view reach `Reach | { own: membershipId }`, decided by the caller's actual keys, wider first.
  - `reachOf` / `actorReach(actor, "view")` and every caller learn it: `listAppointmentBranches`, `readAppointmentDay`, `projectAppointments`, and the write-answer clipping (A2's `{ appointment } | null`).
  - Grep for every `actorReach(` and `"view"` use.
  - Create, update and overbook reaches are unchanged; they have no `own` key.
- [ ] **2.3** Change the routes `GET /v1/appointments/branches` and `GET /v1/appointments/day` to `@Require("view:appointments:own")`. The guard's `grantFor` admits own-only holders and still reports `clinic` or `branch` for wider keys.
  - Update the guard-coverage or route-permission tests that pin these strings.
  - Writes keep their `:branch` requirement.
- [ ] **2.4** Under `own`, the branches and day results follow TODO(spec) 2.
  - The response must carry **no other provider's name or id** and no other provider's appointments, including ones where the caller's column is absent.
  - If the caller is not in that branch and has no appointments there, the day is an empty column list, not `not_found`, as long as the branch is in their membership. A branch outside their membership is `not_found`.
- [ ] **2.5 `test:db`**, as `eyadex_app`, with a doctor role holding only `view:appointments:own`:
  - the doctor sees only their appointments;
  - another provider's appointment in the same branch is absent;
  - another branch outside the membership is 404;
  - a receptionist's (`branch`) and an admin's (`clinic`) day responses are unchanged, as a regression check;
  - a role holding `own` + `branch` gets the `branch` result (wider wins).

## Task 3 — `own` on patients (+ SQL 0044)

- [ ] **3.1 Catalogue.**
  - In `packages/contracts/src/permissions.ts`, set `patients.view` to `["clinic", "branch", "own"]`. Add `"view:patients:own"` to `PERMISSION_KEYS`, and update the doc comment ("joins in slice A3").
  - `db/sql/0044_patients_own_scope.sql` inserts `view:patients:own` (`view`, `patients`, `own`, module `patients`) idempotently (`ON CONFLICT DO NOTHING`), with the next unused id of the `00000000-0000-7000-8000-0000000c00xx` series. Read 0042 to find it.
  - It is **not** added to the locked `clinic_admin` roles. D-16 covers clinic-scope keys, and the admin's `view:patients:clinic` is wider.
  - It changes no existing role. Follow the file header style of 0042/0043. It must be safe to apply before the code ships, because the old code drops keys it does not know; say so in the header.
  - Update the tests that pin catalogue ↔ table ↔ `PERMISSION_KEYS`, and the Drizzle mirror if it lists keys.
- [ ] **3.2 Domain.**
  - In `modules/patients/domain/patient-rules.ts`, `PatientScope` gains `{ own: membershipId }`. `patientScopeFor` returns `clinic`, then `branch`, then `own`, by actual keys. `own` exists for `view` only; other actions keep `null` without a key.
  - `coversBranch` returns `false` for `own`. Visibility under `own` needs the patient, so add a separate DB check.
  - `recordActions` is unchanged in behaviour (`own` gives view only). Update its Arabic JSDoc.
- [ ] **3.3 Queries.**
  - `modules/patients/queries/own-patients.ts` holds the one `EXISTS` predicate.
  - `patient-views.ts` `listFilters`/`inScopeSql` uses it for `own`, for both the page and the count.
  - `open-patient.ts` refuses a file that is not "own" with `not_found` (the same answer as an unknown id), and still writes `patient.opened` for an own file.
  - `patient-actor.ts` `resultOf`/`replayResult`: an own-only viewer gets `detail` only when the written file is "own", judged in the same transaction.
  - `patient-branch-options.ts` follows TODO(spec) 3.
  - `PatientActor` gets `membershipId`, and `actorOf` in `patients.controller.ts` fills it.
- [ ] **3.4 Routes.** Change `POST /v1/patients/search`, `GET /v1/patients/branch-options/view` and `GET /v1/patients/:id` to `@Require("view:patients:own")`. Writes are unchanged.
- [ ] **3.5 Module boundary.** Add the `module-boundaries.spec.ts` test from the decision above, and the CLAUDE.architecture.md §2.2 sentence.
- [ ] **3.6 `test:db`**, as `eyadex_app`, own-only doctor:
  - lists exactly the files with a live appointment with them; the total matches;
  - a file whose only appointment with them is **cancelled** is absent (spec §8);
  - another provider's patient is absent and `GET :id` on it is 404;
  - an own file registered in a branch outside the doctor's membership is visible;
  - opening an own file writes one `patient.opened` row;
  - search by name, phone or file number stays inside own;
  - another clinic's file is 404, as an RLS regression;
  - a `branch` holder's list is unchanged.
- [ ] **3.7** Run the dbcheck. `rls-isolation`, `fk-indexes`, `appointments-admin-keys` and the catalogue tests must all stay green.

## Task 4 — New clinics' doctor role

- [ ] **4.1** In `modules/identity/domain/system-roles.ts`, set the doctor's permissions to `["view:appointments:own", "view:patients:own"]`, replacing `view:patients:branch` (spec §3, D-8). Update its test.
  - Existing clinics' roles are **not** changed: no migration touches them.
  - Check every other place that seeds or asserts the doctor template: the onboarding `test:db`, the `settings-and-team.sql` or other `db/tests`, docs.
- [ ] **4.2** Mirror it in the web mock `apps/web/src/shared/api/mock/seed-roles.ts`, then fix any mock or web test that relied on the doctor persona's `view:patients:branch`.

## Task 5 — Web (mock + HTTP, no screen imports the mock)

- [ ] **5.1 Mock parity.**
  - `mock-appointments.ts`: the branches and day reads follow TODO(spec) 2 for an own-only caller, wider wins.
  - The mock patients search, list, open and branch-options follow D-4 through the mock appointments state: non-cancelled rows with the caller's membership.
  - Reuse the contracts helpers wherever a rule is pure.
  - Add mock tests mirroring Task 2.5 and Task 3.6.
- [ ] **5.2 Navigation and pages.**
  - A2's Codex fix *hid* the appointments entry and page from own-only roles (`nav-items.ts`; test "Codex PR #64: an own-only appointments key shows no branch-day entry"). Invert it: `view:appointments:own` now shows the entry and the branch day page, read-only, with no booking clicks or status actions.
  - Patients nav and page show for `view:patients:own`.
  - Check `can.ts` / `can-at-branch.ts`: `own` is the narrowest tier, and `canAtBranch` never answers true for a branch action from an `own` key.
  - Rewrite the inverted nav test so it asserts the new rule. Do not delete it.
- [ ] **5.3 Roles editor.** The `view:patients:own` checkbox appears with ar + en labels, in the same layout as `view:appointments:own`. Add i18n keys where missing.
- [ ] **5.4 Copy.** Where an own-only user sees an empty day or an empty patients list, the empty state says so in plain words: ar "مفيش مواعيد ليك في اليوم ده" / en "You have no appointments this day", and the same for the patients list ("ليك" = yours).
  - Follow the existing i18n tone; the Arabic in the app is Modern Standard, so match the existing files, not this plan's wording.
- [ ] **5.5 Web tests.**
  - An own-only persona sees only their column and no booking UI.
  - The patients list for that persona shows only own files.
  - The roles editor renders the new key.
  - The ar/en key-parity test passes.

## Task 6 — Docs, gates, Codex

- [ ] **6.1** Write ADR-0026 "A3": the day-bounds fix, `own` semantics, the cross-module read decision, the TODO(spec) list, and deployment ("0044 is additive; apply on staging, then prod, before merge").
  - Update the spec's §6 row A3 status if the spec tracks status.
- [ ] **6.2** All gates from `agent-pipeline.md`:
  - `typecheck`, `lint` with 0 errors, `test`;
  - the build filter;
  - `dbcheck.sh`;
  - `test:db` for db, api, worker and auth (worker and auth may be skipped only with a reason);
  - `NITRO_PRESET=node-server pnpm build:all`.
- [ ] **6.3** Up to 3 local Codex rounds (`codex-a3-r<N>.log`) as in `agent-pipeline.md`. Fix valid findings with a failing-first test, and reject the rest with one line each.
- [ ] **6.4** Final report (≤ 60 lines) as in `agent-pipeline.md`. Leave `eyadex-pg-a3` running.
