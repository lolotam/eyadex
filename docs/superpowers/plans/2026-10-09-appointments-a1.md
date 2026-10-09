# Appointments slice A1 — services, booking profile, weekly schedules, time off — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slice A1 of the appointments design: the `appointments` module flag, its permission keys (with the `own` scope in the catalogue), the clinic services list, a member's booking profile ("accepts appointments" + default duration), weekly provider schedules per branch (back-to-back rows count as one shift, also across midnight) and time off — database, API, mock, HTTP adapter and screens, every change audited.

**Architecture:** One forward-only SQL file (`db/sql/0042_appointments_setup.sql`) adds three RLS-forced clinic tables, two `memberships` columns, the catalogue rows and the module value. A new NestJS module `apps/api/src/modules/appointments` owns services, schedules and time off; it reads memberships only through its `ProviderDirectory` port (implemented by identity's `PgProviderDirectory`, bound in `appointments.module.ts`) and branches through `SchedulingBranchReader` (tenancy's `PgFilingBranches`). The booking profile lives on the membership, so identity owns its route (`/v1/users/:id/booking-profile`). Every schedule and booking-profile write holds the per-provider lock `appointments:<clinicId>:<membershipId>` (D-13) — the same key slice A2's booking will take. The web gets one `ApiClient["scheduling"]` namespace implemented by both adapters, two screens (`/clinic/services`, `/clinic/schedules`) and a booking-profile dialog on the users tab.

**Tech Stack:** PostgreSQL 18 (RLS, `uuidv7()`), NestJS 12 on Fastify, Drizzle 0.45 (schema mirror only), postgres.js, Zod 3 (`@eyadex/contracts`), TanStack Start + Query + Table, react-hook-form, shadcn/ui, lucide, vitest 4.

**Spec:** `docs/specs/appointments-design.md` (owner-approved 2026-10-09, decisions D-1..D-15; this plan covers §6 slice A1 only).

## Global Constraints

- Work only in the worktree `/f/Dev/Worktrees/eyadex/appt-spec` (branch `appointments-spec`); never push; never touch `F:\Dev\Projects\eyadex` or another worktree.
- Every shell step starts with `export PATH="/f/Dev/Runtimes/node24/node-v24.21.0-win-x64:$PATH" && cd /f/Dev/Worktrees/eyadex/appt-spec` (omitted below for brevity, never optional).
- Base is `origin/main` at `d10e8a0`. SQL file number for A1: `db/sql/0042_appointments_setup.sql` (0041 belongs to the in-flight platform default limits/modules work). ADR number: `docs/adr/0026-appointments-model.md`.
- Local Postgres for this slice: container `eyadex-pg-a1` on port `55442` (create it once with the `docker run` + role commands of `/f/Dev/Worktrees/eyadex/agent-pipeline.md`, `<pg>` = `eyadex-pg-a1`, `<port>` = `55442`); Redis `eyadex-redis` db `7`.
- `test:db` environment (export before any `test:db` run): `EYADEX_TEST_OWNER_URL=postgres://eyadex_owner:ci-only-owner@127.0.0.1:55442/eyadex`, `EYADEX_TEST_APP_URL=postgres://eyadex_app:ci-only-app@127.0.0.1:55442/eyadex`, `EYADEX_TEST_AUTH_URL=postgres://eyadex_auth:ci-only-auth@127.0.0.1:55442/eyadex`, `EYADEX_TEST_PLATFORM_URL=postgres://eyadex_platform:ci-only-platform@127.0.0.1:55442/eyadex`, `EYADEX_TEST_DISPATCHER_URL=postgres://eyadex_dispatcher:ci-only-dispatcher@127.0.0.1:55442/eyadex`, `EYADEX_TEST_REDIS_URL=redis://127.0.0.1:56380/7`.
- Clinic tables: `clinic_id uuid NOT NULL`, PK `(clinic_id, id)`, RLS ENABLED + FORCED with `clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid` for USING and WITH CHECK; indexes start with `clinic_id`; every FK has a leading-column plain (non-partial) index.
- IDs are UUID v7 from the app (`ids.newId()`); SQL backfills use PostgreSQL 18 `uuidv7()`; no column default on any `id`.
- Grants: `eyadex_app` only. `eyadex_platform` gets nothing on `clinic_services`, `provider_schedules`, `provider_time_off` (explicit `REVOKE ALL`).
- No hard deletes: services are deactivated, time off is cancelled (`cancelled_at`); the only new deletable table is `provider_schedules` (spec §2: "schedules are replaced").
- Duration bounds (D-15): every service and provider default lasts 5 to 480 minutes; the provider default is 20 until changed.
- Weekday `0` = Sunday … `6` = Saturday; schedule times are clinic wall-clock `HH:MM`; `ends_at` may be `24:00`; one row never crosses midnight on its own.
- Permission strings only (`action:resource:scope`), never role names; the new keys are gated by the module `appointments`.
- Existing clinics: only locked `clinic_admin` roles receive the module's clinic-scope keys (ADR-0026 §6, open question 1 of the final report); no other existing role changes. New clinics: the admin gets them from `SYSTEM_ROLES`; doctor/receptionist defaults stay unchanged until slice A3.
- `view:patients:own` is NOT added in A1 (it lands with its query in A3); `view:appointments:own` IS added (catalogue completeness; no A1 route requires it).
- Every service create/update/deactivate/reactivate, schedule replace, time-off add/cancel and booking-profile change writes exactly one `administrative` clinic audit row; no time-off note, phone or civil ID in any snapshot.
- Module flag `appointments` off ⇒ every `/v1/services*`, `/v1/schedules*` and `/v1/users/:id/booking-profile` route answers `module_disabled` (403).
- UI text: ar + en through i18n keys; Arabic says "المراجع/المراجعون" (never "المريض/المرضى"), never "كاشير"/"Cashier"; brand `Eyadex` in Latin letters; logical CSS only (`ps-`/`pe-`/`ms-`/`me-`/`start`/`end`).
- Max 300 lines per file, one React component per file; no `utils/ helpers/ common/ misc/ managers/ models/` folders and no root `services/` layer folder (the business folder `apps/web/src/services/` is the clinic's services list, named after the business like `patients/`).
- Arabic JSDoc (description + `@param` + `@returns`) on every exported function in `domain/**` and every method in `ports/**`.
- Conventional commits ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

### Database

| File                                                                                   | Responsibility                                                                                                                                             |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db/sql/0042_appointments_setup.sql` (create)                                          | Module value, catalogue keys, `memberships` booking columns, `clinic_services`, `provider_schedules`, `provider_time_off`, RLS, grants, admin-key backfill |
| `db/tests/rls-isolation.sql` (modify)                                                  | Seed + read/write/move probes for the three tables; platform has no grant; cross-clinic DELETE on schedules affects 0 rows                                 |
| `db/tests/admin-keys-backfill.sh` (create)                                             | 0042 gives existing locked admin roles the module's clinic keys and nothing to other roles                                                                 |
| `.github/workflows/ci.yml` (modify, after line 78)                                     | Runs the backfill test in the `db` job                                                                                                                     |
| `packages/db/src/schema/scheduling.ts` (create)                                        | Drizzle mirror of the three tables                                                                                                                         |
| `packages/db/src/schema/memberships.ts`, `clinics.ts`, `roles.ts`, `index.ts` (modify) | Mirror of the new columns and re-created CHECKs; export the new tables                                                                                     |
| `packages/db/src/__tests__/schema-drift.db.spec.ts` (modify)                           | `time` ↔ `time without time zone` normalisation                                                                                                            |
| `packages/db/src/__tests__/schema-surface.spec.ts` (modify)                            | New tables keep the `(clinic_id, id)` PK                                                                                                                   |

### Contracts (`packages/contracts/src`)

| File                                            | Responsibility                                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `permissions.ts` (modify)                       | `overbook` action, `appointments`/`services`/`schedules` resources, `own` scope, per-resource-per-action scope table, `PERMISSION_KEYS` |
| `roles.ts` (modify)                             | One scope per action for every resource, not just patients                                                                              |
| `clinics.ts` (modify)                           | `moduleSchema` + `featuresSchema` gain `appointments`; `NO_FEATURES`                                                                    |
| `onboarding.ts`, `platform-clinics.ts` (modify) | `modules.appointments` on create (default `false`) and on the platform detail                                                           |
| `common.ts` (modify)                            | Error codes `service_name_taken`, `schedule_overlap`, `provider_not_bookable`, `provider_not_in_branch`                                 |
| `organization.ts`, `audit.ts` (modify)          | Audit entities `clinic_service`, `provider_schedule`, `provider_time_off`; new actions; the platform filter excludes them               |
| `services.ts` (create)                          | Duration bounds, service shapes, booking-profile shapes                                                                                 |
| `schedules.ts` (create)                         | Wall-time shift shapes, provider schedule and time-off shapes, `findShiftOverlap`, `coversWallInterval` (D-14)                          |
| `clinic-time.ts` (create)                       | `wallToInstant`, `instantToWall` in a clinic time zone                                                                                  |

### API (`apps/api/src`)

| File                                                                                                                                                                                                                                  | Responsibility                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `shared/provider-lock.ts` (create)                                                                                                                                                                                                    | The per-provider advisory lock (D-13)                                               |
| `shared/errors.ts`, `shared/api-error-messages.ts` (modify)                                                                                                                                                                           | Statuses and bilingual messages of the four new codes                               |
| `modules/identity/domain/permission-check.ts` (modify)                                                                                                                                                                                | `own` as the narrowest grant                                                        |
| `modules/identity/domain/system-roles.ts` (modify)                                                                                                                                                                                    | New clinics' admin holds the module's clinic keys                                   |
| `modules/identity/persistence/pg-provider-directory.ts` (create)                                                                                                                                                                      | Identity's adapter for appointments' `ProviderDirectory` port                       |
| `modules/identity/persistence/pg-booking-profile-store.ts` (create)                                                                                                                                                                   | Read/write the two membership columns                                               |
| `modules/identity/use-cases/booking-profile/booking-profile-changes.ts` (create)                                                                                                                                                      | Read and change a member's booking profile under the roles → users → provider locks |
| `modules/identity/http/booking-profile.controller.ts` (create)                                                                                                                                                                        | `GET`/`PUT /v1/users/:id/booking-profile`                                           |
| `modules/identity/clinic-access.module.ts`, `index.ts` (modify)                                                                                                                                                                       | Register the controller and use case; export `PgProviderDirectory`                  |
| `modules/patients/http/patients.controller.ts:162-176` (modify)                                                                                                                                                                       | The options action type no longer derives from `PermissionAction`                   |
| `modules/tenancy/domain/feature-flags.ts`, `persistence/pg-new-clinic-writer.ts`, `use-cases/create-clinic-with-admin/create-clinic-with-admin.ts:79`, `queries/platform-clinic-detail.ts`, `queries/clinic-access-state.ts` (modify) | The second module everywhere a clinic's modules are written or read                 |
| `modules/audit/domain/audit-snapshot.ts` (modify)                                                                                                                                                                                     | Allowlists of the new entities; booking fields on `user`                            |
| `modules/appointments/domain/service-rules.ts`                                                                                                                                                                                        | Service input normalisation + audit snapshot                                        |
| `modules/appointments/domain/schedule-rules.ts`                                                                                                                                                                                       | Row ↔ shift conversion, replace decision, schedule audit snapshot                   |
| `modules/appointments/domain/time-off-rules.ts`                                                                                                                                                                                       | Time-off validation, note normalisation, audit snapshot                             |
| `modules/appointments/domain/scheduling-scope.ts`                                                                                                                                                                                     | Reach of a route's grant; branch/provider visibility                                |
| `modules/appointments/ports/provider-directory.ts`, `scheduling-branch-reader.ts`, `tokens.ts`                                                                                                                                        | Ports and DI tokens                                                                 |
| `modules/appointments/persistence/pg-service-store.ts`, `pg-schedule-store.ts`                                                                                                                                                        | SQL on the module's own tables                                                      |
| `modules/appointments/queries/service-list.ts`, `provider-schedule.ts`                                                                                                                                                                | Read side                                                                           |
| `modules/appointments/use-cases/service-changes/service-changes.ts`                                                                                                                                                                   | Create / update / deactivate / reactivate a service                                 |
| `modules/appointments/use-cases/schedule-changes/schedule-changes.ts`                                                                                                                                                                 | Replace a branch schedule, add / cancel time off                                    |
| `modules/appointments/http/services.controller.ts`, `schedules.controller.ts`                                                                                                                                                         | Thin controllers                                                                    |
| `modules/appointments/appointments.module.ts`, `index.ts`                                                                                                                                                                             | Wiring; the module's only export                                                    |
| `app.ts:133` (modify)                                                                                                                                                                                                                 | Mount `AppointmentsModule` with the clinic modules                                  |
| `shared/__tests__/module-boundaries.spec.ts` (modify)                                                                                                                                                                                 | The appointments module's SQL names only its own tables                             |

### Web (`apps/web/src`)

| File                                                                                                                                                                                   | Responsibility                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `shared/api/scheduling-client.ts` (create)                                                                                                                                             | `SchedulingApi` interface                                               |
| `shared/api/api-client.ts` (modify)                                                                                                                                                    | `scheduling: SchedulingApi`                                             |
| `shared/api/http/http-scheduling.ts` (create); `http-adapter.ts`, `http-session.ts`, `http-platform.ts` (modify)                                                                       | HTTP side                                                               |
| `shared/api/mock/mock-scheduling-rules.ts`, `mock-services.ts`, `mock-schedules.ts`, `seed-scheduling.ts` (create)                                                                     | Mock side, same rules and check order                                   |
| `shared/api/mock/mock-store.ts`, `seed.ts`, `mock-adapter.ts`, `mock-actor.ts`, `mock-patient-rules.ts`, `mock-platform.ts`, `mock-role-rules.ts`, `mock-session.ts` (modify)          | Store fields (`v14`), seed, `NO_FEATURES`                               |
| `services/*` (create)                                                                                                                                                                  | Services list screen                                                    |
| `schedules/*` (create)                                                                                                                                                                 | Weekly schedule + time-off screen                                       |
| `users/booking-profile-dialog.tsx` (create); `users/use-user-columns.tsx`, `users/users-tab.tsx` (modify)                                                                              | Booking profile on the user editor                                      |
| `roles/permission-matrix.tsx` (modify)                                                                                                                                                 | One group per module; `own` scope label                                 |
| `platform/clinics/clinic-modules-tab.tsx` (modify)                                                                                                                                     | One switch per module                                                   |
| `shared/shell/nav-items.ts`; `routes/clinic.services.tsx`, `routes/clinic.schedules.tsx` (create); `routeTree.gen.ts` (regenerated)                                                    | Navigation                                                              |
| `shared/i18n/en-scheduling.ts`, `ar-scheduling.ts`, `en-branches.ts`, `ar-branches.ts` (create); `en.ts`, `ar.ts`, `en-roles.ts`, `ar-roles.ts`, `en-audit.ts`, `ar-audit.ts` (modify) | Strings (`en.ts` is at 300 lines: the `branches` block moves out first) |
| `audit/audit-format.ts` (modify)                                                                                                                                                       | The permission regex knows `overbook` and `own`                         |

### Docs

| File                                           | Responsibility                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `docs/adr/0026-appointments-model.md` (create) | Model, overlap lock (D-13), `own`, schedule replace + DELETE exception, time-off cancel, admin backfill, merge with 0041 |
| `CLAUDE.architecture.md` §2.2, §3 (modify)     | `appointments` module row and arrows; `provider_schedules` as a deletable configuration table                            |
| `apps/api/AGENTS.md` (modify)                  | One rule line for the appointments module                                                                                |
| `roadmap.md` (modify)                          | Slice A1 entry                                                                                                           |

### Merge point with the 0041 default-modules work

The `clinic-defaults` worktree is still at `d10e8a0`; no 0041 exists on any branch. Whichever PR lands second resolves these in its own merge commit (merge, never rebase pushed history):

- `packages/contracts/src/onboarding.ts` (`createClinicRequestSchema.modules`) and `platform-clinics.ts` (`platformClinicDetailSchema.modules`): the merged shape carries both `patients` and `appointments`.
- The platform-settings contract/form/table that 0041 adds: its default-modules value is typed from `moduleSchema` (A1 makes `appointments` one of the options) and its stored default for `appointments` is `true` (D-9: "it joins the new-clinic default modules"). If 0041 writes a CHECK that lists module names, the PR landing second adds `'appointments'` to it in a SQL file of its own (A1 does it in 0042 if 0041 is already on `main` when A1 is reviewed).
- `apps/api/src/modules/tenancy/persistence/pg-new-clinic-writer.ts`: A1 writes one `clinic_features` row per `moduleSchema` option from `input.modules`; 0041 fills `input.modules` from the platform default when the request leaves it out. Keep A1's loop, take 0041's defaulting.
- `apps/web/src/platform/clinics/clinic-modules-tab.tsx` and the create-clinic page: A1 iterates `moduleSchema.options`; 0041's default-modules form must do the same.

---

## Task 0: Make room in the dictionaries (move `branches` out of `en.ts` / `ar.ts`)

`apps/web/src/shared/i18n/en.ts` is at exactly 300 lines (the CLAUDE.md §4 limit) and later tasks add lines to it. This task only moves the existing `branches` block into its own file, the way `en-users.ts` and `en-roles.ts` were split; no string changes.

**Files:**

- Create: `apps/web/src/shared/i18n/en-branches.ts`, `apps/web/src/shared/i18n/ar-branches.ts`
- Modify: `apps/web/src/shared/i18n/en.ts:1-7` (imports) and `:186-228` (the `branches` block), `apps/web/src/shared/i18n/ar.ts:1-7` and `:185-224`

**Interfaces:**

- Consumes: nothing.
- Produces: `enBranches` / `arBranches` (`{ branches: {...} }`), spread at the place the block used to be. Every `branches.*` translation key is unchanged.

- [ ] **Step 1: Record the baseline**

Run: `wc -l apps/web/src/shared/i18n/en.ts apps/web/src/shared/i18n/ar.ts && pnpm --filter @eyadex/web typecheck`
Expected: `300 …/en.ts`, `291 …/ar.ts`, typecheck exits 0. (No new test: the `Dictionary` type already makes `ar` and `en` structurally identical, and every `t("branches.…")` call is type-checked, so a lost or renamed key fails `typecheck`.)

- [ ] **Step 2: Create `en-branches.ts`**

```ts
// Branches strings, split out to keep each dictionary file small.
export const enBranches = {
  branches: {
    title: "Branches",
    subtitle: "Manage the locations where your clinic operates.",
    new: "New branch",
    usage: "{active} of {limit} active branches",
    searchPlaceholder: "Search branch names",
    anyStatus: "Any status",
    columns: {
      name: "Branch",
      address: "Address",
      phone: "Phone",
      status: "Status",
      actions: "Actions",
    },
    createTitle: "Create branch",
    createSubtitle: "Add another location to this clinic.",
    editTitle: "Edit branch",
    editSubtitle: "Update this location's contact details.",
    fields: {
      nameAr: "Name (Arabic)",
      nameEn: "Name (English)",
      address: "Address (optional)",
      phone: "Phone (optional)",
    },
    created: "Branch created",
    updated: "Branch updated",
    deactivated: "Branch deactivated",
    reactivated: "Branch reactivated",
    deactivate: "Deactivate",
    reactivate: "Reactivate",
    deactivateTitle: "Deactivate branch?",
    deactivateBody:
      "This branch will no longer count toward the active branch limit. Existing records remain available.",
    reactivateTitle: "Reactivate branch?",
    reactivateBody:
      "This branch will become available again and count toward the active branch limit.",
    emptyTitle: "No branches found",
    emptyBody: "Try changing the search or status filter.",
    loadError: "Branches could not be loaded.",
    limitReached:
      "Active branch limit reached ({active} of {limit}). Contact the platform to increase it.",
    lastActive: "The clinic's last active branch cannot be deactivated.",
  },
};
```

- [ ] **Step 3: Create `ar-branches.ts`**

```ts
// نصوص الفروع، مفصولة لإبقاء ملفات القاموس صغيرة.
export const arBranches = {
  branches: {
    title: "الفروع",
    subtitle: "إدارة المواقع التي تعمل فيها العيادة.",
    new: "فرع جديد",
    usage: "{active} من {limit} فروع نشطة",
    searchPlaceholder: "ابحث باسم الفرع",
    anyStatus: "كل الحالات",
    columns: {
      name: "الفرع",
      address: "العنوان",
      phone: "الهاتف",
      status: "الحالة",
      actions: "الإجراءات",
    },
    createTitle: "إنشاء فرع",
    createSubtitle: "أضف موقعًا جديدًا لهذه العيادة.",
    editTitle: "تعديل الفرع",
    editSubtitle: "حدّث بيانات التواصل لهذا الموقع.",
    fields: {
      nameAr: "الاسم (عربي)",
      nameEn: "الاسم (إنجليزي)",
      address: "العنوان (اختياري)",
      phone: "الهاتف (اختياري)",
    },
    created: "تم إنشاء الفرع",
    updated: "تم تحديث الفرع",
    deactivated: "تم إيقاف الفرع",
    reactivated: "تم تفعيل الفرع",
    deactivate: "إيقاف",
    reactivate: "إعادة تفعيل",
    deactivateTitle: "إيقاف الفرع؟",
    deactivateBody: "لن يُحتسب هذا الفرع ضمن حد الفروع النشطة، وستبقى سجلاته الحالية محفوظة.",
    reactivateTitle: "إعادة تفعيل الفرع؟",
    reactivateBody: "سيصبح هذا الفرع متاحًا مجددًا ويُحتسب ضمن حد الفروع النشطة.",
    emptyTitle: "لا توجد فروع",
    emptyBody: "جرّب تغيير البحث أو فلتر الحالة.",
    loadError: "تعذّر تحميل الفروع.",
    limitReached: "تم بلوغ حد الفروع النشطة ({active} من {limit}). تواصل مع المنصة لزيادته.",
    lastActive: "لا يمكن إيقاف آخر فرع نشط للعيادة.",
  },
};
```

- [ ] **Step 4: Replace the blocks with spreads**

In `en.ts`, add `import { enBranches } from "./en-branches";` after `import { enAccess, enAccessErrors } from "./en-access";`, delete lines 186-228 (`  branches: {` … its closing `  },`) and put `  ...enBranches,` on the line before `  ...enUsers,`. In `ar.ts`, add `import { arBranches } from "./ar-branches";` after the `arAccess` import, delete lines 185-224 and put `  ...arBranches,` before `  ...arUsers,`.

- [ ] **Step 5: Verify nothing changed but the line counts**

Run: `wc -l apps/web/src/shared/i18n/en.ts apps/web/src/shared/i18n/ar.ts && pnpm --filter @eyadex/web typecheck && pnpm --filter @eyadex/web test`
Expected: en.ts 259, ar.ts 251 (±1); typecheck exits 0; every web test passes (same count as before).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/shared/i18n/en-branches.ts apps/web/src/shared/i18n/ar-branches.ts apps/web/src/shared/i18n/en.ts apps/web/src/shared/i18n/ar.ts
git commit -m "refactor(web): move the branches strings to their own dictionary file

en.ts sat at the 300-line limit; the appointments slice adds strings to it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 1: Contract — the `appointments` module flag (D-9) and every reader of a clinic's modules

**Files:**

- Modify: `packages/contracts/src/clinics.ts:36-40`, `packages/contracts/src/onboarding.ts:68-69`, `packages/contracts/src/platform-clinics.ts:77`
- Modify (API, compile only): `apps/api/src/modules/tenancy/domain/feature-flags.ts:1-2`, `apps/api/src/modules/tenancy/queries/platform-clinic-detail.ts:43`, `apps/api/src/modules/tenancy/queries/clinic-access-state.ts:20,49`
- Modify (web): `apps/web/src/shared/i18n/en-audit.ts`, `ar-audit.ts` (`values.appointments`), `apps/web/src/shared/api/mock/mock-store.ts:47` (`STORAGE_KEY`), `mock-actor.ts:44,64`, `mock-patient-rules.ts:33`, `mock-platform.ts:115,152,263,265`, `mock-role-rules.ts:45`, `mock-session.ts:76,106`, `seed.ts:166`, `apps/web/src/shared/api/http/http-session.ts:27,42`, `http-platform.ts:33,54`, `apps/web/src/shared/api/http/__tests__/fetch-stub.ts:123`, `apps/web/src/platform/clinics/clinic-modules-tab.tsx` (whole file), `apps/web/src/shared/i18n/en.ts` and `ar.ts` (`clinics.modules`)
- Test: `apps/web/src/platform/clinic-modules-mock.test.ts` (create), `apps/web/src/shared/api/http/__tests__/platform-routes.test.ts:123-143`; expectations that print a clinic's modules: `apps/api/src/modules/platform/__tests__/platform-contracts.spec.ts:42`, `apps/api/src/modules/platform/__tests__/platform-clinic-admin.db.spec.ts:121,139`, `apps/api/src/modules/tenancy/__tests__/tenancy.db.spec.ts:86`

**Interfaces:**

- Consumes: nothing.
- Produces: `moduleSchema` = `z.enum(["patients", "appointments"])`; `ClinicModule` = `"patients" | "appointments"`; `featuresSchema` = `{ patients: boolean; appointments: boolean }`; `NO_FEATURES: ClinicFeatures` (both `false`); `createClinicRequestSchema.modules.appointments` (default `false`); `platformClinicDetailSchema.modules.appointments`; i18n keys `clinics.modules.appointments`, `clinics.modules.appointmentsBody`; tenancy `ClinicModule` type (same two values). Existing clinics keep no `appointments` row (module off, ADR-0010).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/platform/clinic-modules-mock.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { moduleSchema } from "@eyadex/contracts/clinics";
import { PLATFORM, api, as, clinicIdAt, resetMockData } from "@/shared/api/mock/mock-test-kit";

beforeEach(() => resetMockData());

// D-9: appointments is a per-clinic module the platform switches, exactly like patients.
describe("the appointments module flag", () => {
  it("is the second module of the catalogue", () => {
    expect(moduleSchema.options).toEqual(["patients", "appointments"]);
  });

  it("the platform switches it per clinic and the clinic session follows", async () => {
    const clinicId = clinicIdAt(0);
    await api.platform.setClinicFeature(PLATFORM, clinicId, "appointments", false);
    expect((await api.platform.getClinic(PLATFORM, clinicId)).features).toEqual({
      patients: true,
      appointments: false,
    });
    expect((await api.session.getContext(as("clinic_admin"))).features.appointments).toBe(false);
    await api.platform.setClinicFeature(PLATFORM, clinicId, "appointments", true);
    expect((await api.session.getContext(as("clinic_admin"))).features.appointments).toBe(true);
  });
});
```

In `platform-routes.test.ts`, change the `getClinic, listClinicBranches and setClinicFeature use their routes` test: the expected detail becomes `features: { patients: true, appointments: false }`, and after the patients call add

```ts
await h.api.platform.setClinicFeature(P, CLINIC, "appointments", true);
```

with the expected call list extended by `` `PUT ${base}/features/appointments` `` and `expect(h.calls[3]?.body).toEqual({ enabled: true });`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @eyadex/web exec vitest run src/platform/clinic-modules-mock.test.ts src/shared/api/http/__tests__/platform-routes.test.ts`
Expected: FAIL — `expected [ 'patients' ] to deeply equal [ 'patients', 'appointments' ]`, and the detail `features` lacks `appointments`.

- [ ] **Step 3: Contracts**

`packages/contracts/src/clinics.ts` — replace the two schema blocks:

```ts
export const moduleSchema = z.enum(["patients", "appointments"]);
export type ClinicModule = z.infer<typeof moduleSchema>;

export const featuresSchema = z.object({ patients: z.boolean(), appointments: z.boolean() });
export type ClinicFeatures = z.infer<typeof featuresSchema>;

/** A clinic with no flag rows: every module off (ADR-0010, default deny). */
export const NO_FEATURES: ClinicFeatures = Object.freeze({ patients: false, appointments: false });
```

`packages/contracts/src/onboarding.ts` — replace lines 68-69:

```ts
    // TODO(spec): PRD §4.8 opens default modules "by specialty" without a table, so it is an input.
    // `appointments` is optional and off until the platform's default-modules setting (0041) decides it.
    modules: z.object({ patients: z.boolean(), appointments: z.boolean().default(false) }).strict(),
```

`packages/contracts/src/platform-clinics.ts:77`:

```ts
    modules: z.object({ patients: z.boolean(), appointments: z.boolean() }).strict(),
```

- [ ] **Step 4: API readers (compile)**

`apps/api/src/modules/tenancy/domain/feature-flags.ts:1-2`:

```ts
/** الموديولات اللي ليها flag (db/sql/0002، 0042): المراجعون والمواعيد. */
export type ClinicModule = "patients" | "appointments";
```

`platform-clinic-detail.ts:43` and `clinic-access-state.ts:49`:

```ts
    modules: {
      patients: isModuleEnabled(snapshot.features, "patients"),
      appointments: isModuleEnabled(snapshot.features, "appointments"),
    },
```

`clinic-access-state.ts:20`: `readonly modules: { readonly patients: boolean; readonly appointments: boolean };`

- [ ] **Step 5: Web feature literals**

Add `import { NO_FEATURES } from "@eyadex/contracts/clinics";` (or extend the existing `@eyadex/contracts/clinics` import) in each file below, then:

- `mock-store.ts:47`: `const STORAGE_KEY = "eyadex:mock-db:v14";` (saved state has no `appointments` flag; later tasks add store arrays too).
- `mock-actor.ts:44` and `:64`: `const features = db.features[actor.clinic.id] ?? NO_FEATURES;`
- `mock-patient-rules.ts:33`: `if (!(db.features[actor.clinic.id] ?? NO_FEATURES).patients)`
- `mock-platform.ts:115`: `const features = db.features[clinicId] ?? NO_FEATURES;`; `:152`: `db.features[clinic.id] = { patients: true, appointments: false };` (the API's create default); `:263` and `:265`: `db.features[clinicId] ?? NO_FEATURES`.
- `mock-role-rules.ts:45`: `return db.features[clinicId] ?? NO_FEATURES;`
- `mock-session.ts:76`: `features: { ...NO_FEATURES },`; `:106`: `features: db.features[clinic.id] ?? NO_FEATURES,`
- `seed.ts:166`: `const features: ClinicFeatures = { patients: true, appointments: true };` (demo clinics show the module's screens).
- `http-session.ts:27`:

```ts
    features: {
      patients: me.modules.includes("patients"),
      appointments: me.modules.includes("appointments"),
    },
```

and `:42`: `features: { ...NO_FEATURES },`

- `http-platform.ts:33`: `const NEW_CLINIC = { maxUsers: 10, maxBranches: 3, modules: { patients: true, appointments: false } } as const;` and `:54`: `return { ...toClinicListItem(detail), features: { ...detail.modules } };`
- `fetch-stub.ts:123`: `modules: { patients: true, appointments: false },`

- [ ] **Step 6: One switch per module on the platform clinic page**

Replace `apps/web/src/platform/clinics/clinic-modules-tab.tsx` with:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { moduleSchema, type ClinicDetail, type ClinicModule } from "@eyadex/contracts/clinics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { clinicKeys } from "./clinic-queries";

export function ClinicModulesTab({ clinic }: { clinic: ClinicDetail }) {
  const { t } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ module, enabled }: { module: ClinicModule; enabled: boolean }) =>
      api.platform.setClinicFeature(persona, clinic.id, module, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clinicKeys.detail(clinic.id) });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      toast.success(t("clinics.modules.saved"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("clinics.modules.title")}</CardTitle>
        <CardDescription>{t("clinics.modules.body")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {moduleSchema.options.map((module) => (
          <div
            key={module}
            className="flex items-center justify-between gap-4 rounded-lg border p-4"
          >
            <div>
              <div className="font-medium">{t(`clinics.modules.${module}`)}</div>
              <div className="text-sm text-muted-foreground">
                {t(`clinics.modules.${module}Body`)}
              </div>
            </div>
            <Switch
              checked={clinic.features[module]}
              disabled={mutation.isPending}
              onCheckedChange={(enabled) => mutation.mutate({ module, enabled })}
              aria-label={t(`clinics.modules.${module}`)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

In `en.ts` `clinics.modules` add after `patientsBody`:

```ts
      appointments: "Appointments",
      appointmentsBody: "Services, work schedules and time off; booking arrives next.",
```

and in `ar.ts`:

```ts
      appointments: "المواعيد",
      appointmentsBody: "الخدمات وجداول العمل والإجازات؛ الحجز يأتي في المرحلة التالية.",
```

The audit screen translates every `moduleSchema` value (`audit-format.test.ts`): add `appointments: "Appointments",` to `values` in `apps/web/src/shared/i18n/en-audit.ts` and `appointments: "المواعيد",` to `values` in `ar-audit.ts`.

- [ ] **Step 7: Existing expectations that print a clinic's modules**

A clinic with no `appointments` row reads `appointments: false` (ADR-0010):

- `platform-contracts.spec.ts:42`: `modules: { patients: true, appointments: false },`
- `platform-clinic-admin.db.spec.ts:121`: `expect(locked.json().modules).toEqual({ patients: false, appointments: false });` and `:139`: `expect(restored.json().modules).toEqual({ patients: true, appointments: false });`
- `tenancy.db.spec.ts:86`: `modules: { patients: true, appointments: false },`

(The two `.db.spec.ts` files run under `test:db` from Task 5 on; the unit spec runs now.)

- [ ] **Step 8: Run the tests and the typechecks**

Run: `pnpm --filter @eyadex/web exec vitest run src/platform/clinic-modules-mock.test.ts src/shared/api/http/__tests__/platform-routes.test.ts src/audit/audit-format.test.ts && pnpm --filter @eyadex/api exec vitest run src/modules/platform/__tests__/platform-contracts.spec.ts && pnpm --filter @eyadex/contracts typecheck && pnpm --filter @eyadex/api typecheck && pnpm --filter @eyadex/web typecheck`
Expected: the four test files PASS; the three typechecks exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/clinics.ts packages/contracts/src/onboarding.ts packages/contracts/src/platform-clinics.ts apps/api/src/modules/tenancy/domain/feature-flags.ts apps/api/src/modules/tenancy/queries/platform-clinic-detail.ts apps/api/src/modules/tenancy/queries/clinic-access-state.ts apps/api/src/modules/tenancy/__tests__/tenancy.db.spec.ts apps/api/src/modules/platform/__tests__/platform-contracts.spec.ts apps/api/src/modules/platform/__tests__/platform-clinic-admin.db.spec.ts apps/web/src/shared/api/mock apps/web/src/shared/api/http apps/web/src/platform apps/web/src/shared/i18n
git commit -m "feat(contracts): appointments is a clinic module the platform switches (D-9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Contract — the permission catalogue additions (spec §3) and the `own` scope

**Files:**

- Modify: `packages/contracts/src/permissions.ts` (whole file), `packages/contracts/src/roles.ts:39-45`
- Modify: `apps/api/src/modules/patients/http/patients.controller.ts:27,162-176`
- Modify: `apps/web/src/roles/permission-matrix.tsx:24-31,124-126`, `apps/web/src/audit/audit-format.ts:1`, `apps/web/src/shared/i18n/en-roles.ts`, `apps/web/src/shared/i18n/ar-roles.ts`
- Test: `apps/api/src/modules/identity/domain/__tests__/appointments-catalogue.spec.ts` (create); existing `apps/web/src/audit/audit-format.test.ts` (translates every catalogue key)

**Interfaces:**

- Consumes: `ClinicModule` incl. `"appointments"` (Task 1).
- Produces: `actionSchema` + `"overbook"`; `resourceSchema` + `"appointments" | "services" | "schedules"`; `scopeSchema` + `"own"`; `permissionSchema` regex `^(view|create|update|deactivate|overbook):(branches|users|roles|patients|audit_log|clinic_settings|appointments|services|schedules):(clinic|branch|own)$`; `PERMISSION_CATALOG` gains exactly these 17 keys, all with `module: "appointments"`, in this order:
  `view:appointments:clinic`, `view:appointments:branch`, `view:appointments:own`, `create:appointments:clinic`, `create:appointments:branch`, `update:appointments:clinic`, `update:appointments:branch`, `overbook:appointments:clinic`, `overbook:appointments:branch`, `view:services:clinic`, `create:services:clinic`, `update:services:clinic`, `deactivate:services:clinic`, `view:schedules:clinic`, `view:schedules:branch`, `update:schedules:clinic`, `update:schedules:branch`.
  `PERMISSION_KEYS` lists the same 17 after `"update:clinic_settings:clinic"`. i18n keys `roles.actions.overbook`, `roles.scopes.own`, `roles.groups.appointments`, `roles.resources.{appointments,services,schedules}`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/identity/domain/__tests__/appointments-catalogue.spec.ts`:

```ts
import {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  permissionSchema,
} from "@eyadex/contracts/permissions";
import { permissionKeysSchema } from "@eyadex/contracts/roles";
import { describe, expect, it } from "vitest";

const ADDED = [
  "view:appointments:clinic",
  "view:appointments:branch",
  "view:appointments:own",
  "create:appointments:clinic",
  "create:appointments:branch",
  "update:appointments:clinic",
  "update:appointments:branch",
  "overbook:appointments:clinic",
  "overbook:appointments:branch",
  "view:services:clinic",
  "create:services:clinic",
  "update:services:clinic",
  "deactivate:services:clinic",
  "view:schedules:clinic",
  "view:schedules:branch",
  "update:schedules:clinic",
  "update:schedules:branch",
];

// Appointments spec §3, slice A1: the catalogue entries only; `own` is enforced in queries from A3.
describe("the appointments catalogue", () => {
  it("adds exactly the module's keys, every one gated by the appointments module", () => {
    const added = PERMISSION_CATALOG.filter((p) => p.module === "appointments").map((p) => p.key);
    expect(added).toEqual(ADDED);
  });

  it("offers `own` only on view:appointments; view:patients:own waits for A3", () => {
    const own = PERMISSION_CATALOG.filter((p) => p.scope === "own").map((p) => p.key);
    expect(own).toEqual(["view:appointments:own"]);
  });

  it("keeps every key valid, and PERMISSION_KEYS equal to the catalogue", () => {
    for (const { key } of PERMISSION_CATALOG)
      expect(permissionSchema.safeParse(key).success).toBe(true);
    expect([...PERMISSION_KEYS]).toEqual(PERMISSION_CATALOG.map((p) => p.key));
  });

  it("a role holds one scope per action on every resource, not only on patients", () => {
    const twoViews = ["view:appointments:branch", "view:appointments:own"];
    expect(permissionKeysSchema.safeParse(twoViews).success).toBe(false);
    const mixed = ["view:schedules:clinic", "update:schedules:branch"];
    expect(permissionKeysSchema.safeParse(mixed).success).toBe(true);
  });

  it("overbook is a write: it needs view on appointments like any other", () => {
    expect(permissionKeysSchema.safeParse(["overbook:appointments:branch"]).success).toBe(false);
    const withView = ["view:appointments:branch", "overbook:appointments:branch"];
    expect(permissionKeysSchema.safeParse(withView).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @eyadex/api exec vitest run src/modules/identity/domain/__tests__/appointments-catalogue.spec.ts`
Expected: FAIL — `expected [] to deeply equal [ 'view:appointments:clinic', … ]`.

- [ ] **Step 3: Rewrite `packages/contracts/src/permissions.ts`**

```ts
import { z } from "zod";
import type { ClinicModule } from "./clinics.ts";

export const actionSchema = z.enum(["view", "create", "update", "deactivate", "overbook"]);
export type PermissionAction = z.infer<typeof actionSchema>;

export const resourceSchema = z.enum([
  "branches",
  "users",
  "roles",
  "patients",
  "audit_log",
  "clinic_settings",
  "appointments",
  "services",
  "schedules",
]);
export type PermissionResource = z.infer<typeof resourceSchema>;

/** `clinic` = every branch, `branch` = the member's branches, `own` = the member's own records (A3). */
export const scopeSchema = z.enum(["clinic", "branch", "own"]);
export type PermissionScope = z.infer<typeof scopeSchema>;

/** Permission string: action:resource:scope */
export const permissionSchema = z
  .string()
  .regex(
    /^(view|create|update|deactivate|overbook):(branches|users|roles|patients|audit_log|clinic_settings|appointments|services|schedules):(clinic|branch|own)$/,
  );
export type Permission = string;

export type PermissionDefinition = {
  key: Permission;
  action: PermissionAction;
  resource: PermissionResource;
  scope: PermissionScope;
  /** null = core, always available; otherwise gated by the clinic feature flag. */
  module: ClinicModule | null;
};

const resourceModule: Record<PermissionResource, ClinicModule | null> = {
  branches: null,
  users: null,
  roles: null,
  patients: "patients",
  audit_log: null,
  clinic_settings: null,
  appointments: "appointments",
  services: "appointments",
  schedules: "appointments",
};

type Scopes = readonly PermissionScope[];
const CLINIC: Scopes = ["clinic"];
const BRANCHED: Scopes = ["clinic", "branch"];
const MANAGED = { view: CLINIC, create: CLINIC, update: CLINIC, deactivate: CLINIC };

/**
 * Each resource's actions and the scopes each action takes (PRD 4.7, appointments spec §3); no other
 * combination exists. `view:patients:own` joins in slice A3, together with the query that evaluates it.
 */
const resourceGrants: Record<PermissionResource, Partial<Record<PermissionAction, Scopes>>> = {
  branches: MANAGED,
  users: MANAGED,
  roles: MANAGED,
  patients: { view: BRANCHED, create: BRANCHED, update: BRANCHED, deactivate: BRANCHED },
  audit_log: { view: CLINIC },
  clinic_settings: { view: CLINIC, update: CLINIC },
  appointments: {
    view: ["clinic", "branch", "own"],
    create: BRANCHED,
    update: BRANCHED,
    overbook: BRANCHED,
  },
  services: MANAGED,
  schedules: { view: BRANCHED, update: BRANCHED },
};

function buildCatalog(): PermissionDefinition[] {
  const list: PermissionDefinition[] = [];
  for (const resource of resourceSchema.options) {
    for (const action of actionSchema.options) {
      for (const scope of resourceGrants[resource][action] ?? []) {
        list.push({
          key: `${action}:${resource}:${scope}`,
          action,
          resource,
          scope,
          module: resourceModule[resource],
        });
      }
    }
  }
  return list;
}

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = buildCatalog();

/**
 * Every catalogue key as a literal type, so `@Require(...)` in the API only compiles with a real key.
 * Written out (not derived) on purpose: a test pins it to PERMISSION_CATALOG and to the seeded table.
 */
export const PERMISSION_KEYS = [
  "view:branches:clinic",
  "create:branches:clinic",
  "update:branches:clinic",
  "deactivate:branches:clinic",
  "view:users:clinic",
  "create:users:clinic",
  "update:users:clinic",
  "deactivate:users:clinic",
  "view:roles:clinic",
  "create:roles:clinic",
  "update:roles:clinic",
  "deactivate:roles:clinic",
  "view:patients:clinic",
  "view:patients:branch",
  "create:patients:clinic",
  "create:patients:branch",
  "update:patients:clinic",
  "update:patients:branch",
  "deactivate:patients:clinic",
  "deactivate:patients:branch",
  "view:audit_log:clinic",
  "view:clinic_settings:clinic",
  "update:clinic_settings:clinic",
  "view:appointments:clinic",
  "view:appointments:branch",
  "view:appointments:own",
  "create:appointments:clinic",
  "create:appointments:branch",
  "update:appointments:clinic",
  "update:appointments:branch",
  "overbook:appointments:clinic",
  "overbook:appointments:branch",
  "view:services:clinic",
  "create:services:clinic",
  "update:services:clinic",
  "deactivate:services:clinic",
  "view:schedules:clinic",
  "view:schedules:branch",
  "update:schedules:clinic",
  "update:schedules:branch",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
```

- [ ] **Step 4: One scope per action on every resource**

In `packages/contracts/src/roles.ts`, change the import to `import { PERMISSION_CATALOG, actionSchema, resourceSchema } from "./permissions.ts";` and replace the `for (const action of actionSchema.options) { … }` loop (lines 39-45) with:

```ts
for (const resource of resourceSchema.options) {
  for (const action of actionSchema.options) {
    const scopes = keys.filter((k) => k.startsWith(`${action}:${resource}:`));
    if (scopes.length > 1) {
      ctx.addIssue({ code: "custom", message: "validation.oneScope" });
      return;
    }
  }
}
```

- [ ] **Step 5: Keep the patients options route on its three actions**

`apps/api/src/modules/patients/http/patients.controller.ts`: delete line 27 (`import type { PermissionAction } …`) and change the `options` parameter type:

```ts
  private options(
    request: ClinicRequest,
    action: "view" | "create" | "update",
  ): Promise<PatientBranchOptionList> {
```

- [ ] **Step 6: Web — role editor groups, labels, audit regex**

`apps/web/src/roles/permission-matrix.tsx` — add `import { moduleSchema, type ClinicModule } from "@eyadex/contracts/clinics";`, replace the `groups` constant:

```ts
const groups = [
  { id: "core" as const, items: resources.filter((r) => moduleOf(catalog, r) === null) },
  ...moduleSchema.options.map((module) => ({
    id: module,
    items: resources.filter((r) => moduleOf(catalog, r) === module),
  })),
].filter((g) => g.items.length > 0);
```

and replace the `isModule` helper at the end of the file with:

```ts
function moduleOf(
  catalog: PermissionDefinition[],
  resource: PermissionResource,
): ClinicModule | null {
  return catalog.find((d) => d.resource === resource)?.module ?? null;
}
```

`apps/web/src/audit/audit-format.ts:1`:

```ts
const PERMISSION = /^(view|create|update|deactivate|overbook):([a-z_]+):(clinic|branch|own)$/;
```

`en-roles.ts` — set:

```ts
    groups: {
      core: "Clinic administration",
      patients: "Patients module",
      appointments: "Appointments module",
    },
    resources: {
      branches: "Branches",
      users: "Users",
      roles: "Roles",
      patients: "Patients",
      audit_log: "Audit log",
      clinic_settings: "Clinic settings",
      appointments: "Appointments",
      services: "Services",
      schedules: "Work schedules",
    },
    actions: {
      view: "View",
      create: "Create",
      update: "Update",
      deactivate: "Deactivate",
      overbook: "Overbook",
    },
    scopes: { none: "None", clinic: "All branches", branch: "Own branches", own: "Own records" },
```

`ar-roles.ts`:

```ts
    groups: { core: "إدارة العيادة", patients: "موديول المراجعين", appointments: "موديول المواعيد" },
    resources: {
      branches: "الفروع",
      users: "المستخدمون",
      roles: "الأدوار",
      patients: "المراجعون",
      audit_log: "سجل التدقيق",
      clinic_settings: "إعدادات العيادة",
      appointments: "المواعيد",
      services: "الخدمات",
      schedules: "جداول العمل",
    },
    actions: {
      view: "عرض",
      create: "إضافة",
      update: "تعديل",
      deactivate: "تعطيل",
      overbook: "حجز رغم التعارض",
    },
    scopes: { none: "بدون", clinic: "كل الفروع", branch: "فروعه فقط", own: "سجلاته فقط" },
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @eyadex/api exec vitest run src/modules/identity/domain/__tests__/appointments-catalogue.spec.ts && pnpm test && pnpm typecheck`
Expected: all PASS (every unit suite of the workspace, the marketing keyring and the role editor included); `pnpm typecheck` exits 0. (`permission-catalogue.db.spec.ts` stays red until Task 5 seeds the rows — it runs under `test:db`, not here.)

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/permissions.ts packages/contracts/src/roles.ts apps/api/src/modules/identity/domain/__tests__/appointments-catalogue.spec.ts apps/api/src/modules/patients/http/patients.controller.ts apps/web/src/roles/permission-matrix.tsx apps/web/src/audit/audit-format.ts apps/web/src/shared/i18n/en-roles.ts apps/web/src/shared/i18n/ar-roles.ts
git commit -m "feat(contracts): appointments, services and schedules keys, overbook and the own scope

Catalogue only (spec §3, slice A1); own is evaluated in queries from A3.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Contract — services, booking profile, schedules, time off, clinic wall time (D-2, D-6, D-12, D-14, D-15)

**Files:**

- Create: `packages/contracts/src/services.ts`, `packages/contracts/src/schedules.ts`, `packages/contracts/src/clinic-time.ts`
- Test: `apps/api/src/modules/appointments/domain/__tests__/shift-coverage.spec.ts`, `apps/api/src/modules/appointments/domain/__tests__/clinic-time.spec.ts`

**Interfaces:**

- Consumes: `idSchema`, `pageQuerySchema`, `stripInvisibleControls` (`common.ts`).
- Produces (`@eyadex/contracts/services`): `DURATION_MIN_MINUTES = 5`, `DURATION_MAX_MINUTES = 480`, `DEFAULT_PROVIDER_DURATION_MINUTES = 20`, `durationMinutesSchema`, `serviceStatusSchema` / `ServiceStatus` (`"active" | "inactive"`), `serviceInputSchema` / `ServiceInput` (`{ nameAr; nameEn; durationMinutes }`), `clinicServiceSchema` / `ClinicService` (`{ id; nameAr; nameEn; durationMinutes; status; createdAt }`), `serviceListHttpQuerySchema` / `ServiceListHttpQuery`, `serviceListResponseSchema` / `ServiceListResponse`, `serviceListQuerySchema` / `ServiceListQuery` (web: `{ cursor: string | null; limit; status: ServiceStatus | null }`), `bookingProfileInputSchema` / `BookingProfileInput` (`{ acceptsAppointments: boolean; defaultDurationMinutes: number }`), `bookingProfileSchema` / `BookingProfile` (`BookingProfileInput & { memberId }`).
- Produces (`@eyadex/contracts/schedules`): `MINUTES_PER_DAY`, `WEEK_MINUTES`, `weekdaySchema`, `wallMinutes(time: string): number`, `minutesToWall(minutes: number): string`, `shiftSchema` / `Shift` (`{ weekday; startsAt: "HH:MM"; endsAt: "HH:MM" | "24:00" }`), `branchScheduleInputSchema` / `BranchScheduleInput` (`{ shifts: Shift[] }`, max 42), `scheduleShiftSchema` / `ScheduleShift` (`Shift & { branchId }`), `providerSummarySchema` / `ProviderSummary` (`{ membershipId; fullName; defaultDurationMinutes; allBranches; branchIds }`), `providerListResponseSchema`, `scheduleBranchSchema` / `ScheduleBranch` (`{ id; nameAr; nameEn; isActive }`), `timeOffSchema` / `TimeOff` (`{ id; startsAt; endsAt; note: string | null }`), `timeOffInputSchema` / `TimeOffInput`, `providerScheduleSchema` / `ProviderSchedule` (`{ provider; branches; shifts; timeOff }`), `findShiftOverlap<S extends WallShift>(shifts: readonly S[]): readonly [S, S] | null`, `coversWallInterval(shifts: readonly WallShift[], start: { weekday: number; minute: number }, durationMinutes: number): boolean`, type `WallShift = Pick<Shift, "weekday" | "startsAt" | "endsAt">`.
- Produces (`@eyadex/contracts/clinic-time`): `wallToInstant(date: string, time: string, timeZone: string): string` (ISO, `Z`), `instantToWall(iso: string, timeZone: string): { date: string; time: string }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/appointments/domain/__tests__/shift-coverage.spec.ts`:

```ts
import { coversWallInterval, findShiftOverlap, type WallShift } from "@eyadex/contracts/schedules";
import { describe, expect, it } from "vitest";

const SUN = 0;
const MON = 1;
const SAT = 6;
const shift = (weekday: number, startsAt: string, endsAt: string): WallShift => ({
  weekday,
  startsAt,
  endsAt,
});
const at = (weekday: number, time: string) => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return { weekday, minute: h * 60 + m };
};

describe("findShiftOverlap (a provider is in one place at a time)", () => {
  it("touching ends are not an overlap; a shared minute is", () => {
    expect(
      findShiftOverlap([shift(SUN, "08:00", "12:00"), shift(SUN, "12:00", "16:00")]),
    ).toBeNull();
    const clash = [shift(SUN, "08:00", "12:00"), shift(SUN, "11:59", "13:00")];
    expect(findShiftOverlap(clash)).toEqual(clash);
  });

  it("finds a short shift inside a long one even with a later shift between them", () => {
    const rows = [
      shift(MON, "08:00", "20:00"),
      shift(MON, "09:00", "10:00"),
      shift(MON, "21:00", "22:00"),
    ];
    expect(findShiftOverlap(rows)).toEqual([rows[0], rows[1]]);
  });

  it("Sunday 20:00–24:00 and Monday 00:00–01:00 do not overlap", () => {
    expect(
      findShiftOverlap([shift(SUN, "20:00", "24:00"), shift(MON, "00:00", "01:00")]),
    ).toBeNull();
  });
});

describe("coversWallInterval (D-6, D-14)", () => {
  const split = [shift(SUN, "08:00", "12:00"), shift(SUN, "16:00", "20:00")];

  it("split shifts: inside one part yes, across the gap no", () => {
    expect(coversWallInterval(split, at(SUN, "16:00"), 30)).toBe(true);
    expect(coversWallInterval(split, at(SUN, "11:30"), 60)).toBe(false);
  });

  it("a shift continued across midnight covers 23:45–00:15", () => {
    const night = [shift(SUN, "20:00", "24:00"), shift(MON, "00:00", "01:00")];
    expect(coversWallInterval(night, at(SUN, "23:45"), 30)).toBe(true);
  });

  it("a gap at midnight is not covered", () => {
    const gap = [shift(SUN, "20:00", "23:30"), shift(MON, "00:00", "01:00")];
    expect(coversWallInterval(gap, at(SUN, "23:45"), 30)).toBe(false);
  });

  it("Saturday 24:00 continues into Sunday 00:00, from either side of the week", () => {
    const weekEnd = [shift(SAT, "22:00", "24:00"), shift(SUN, "00:00", "02:00")];
    expect(coversWallInterval(weekEnd, at(SAT, "23:30"), 60)).toBe(true);
    expect(coversWallInterval(weekEnd, at(SUN, "00:10"), 30)).toBe(true);
    expect(coversWallInterval(weekEnd, at(SUN, "01:30"), 60)).toBe(false);
  });

  it("no shift that day covers nothing", () => {
    expect(coversWallInterval(split, at(MON, "09:00"), 15)).toBe(false);
  });
});
```

Create `apps/api/src/modules/appointments/domain/__tests__/clinic-time.spec.ts`:

```ts
import { instantToWall, wallToInstant } from "@eyadex/contracts/clinic-time";
import { describe, expect, it } from "vitest";

describe("clinic wall time", () => {
  it("Kuwait wall time is UTC+3 all year", () => {
    expect(wallToInstant("2026-10-11", "09:00", "Asia/Kuwait")).toBe("2026-10-11T06:00:00.000Z");
    expect(wallToInstant("2026-10-11", "00:30", "Asia/Kuwait")).toBe("2026-10-10T21:30:00.000Z");
  });

  it("round-trips an instant through the clinic's wall clock", () => {
    const iso = "2026-10-10T21:30:00.000Z";
    expect(instantToWall(iso, "Asia/Kuwait")).toEqual({ date: "2026-10-11", time: "00:30" });
    const { date, time } = instantToWall(iso, "Africa/Cairo");
    expect(wallToInstant(date, time, "Africa/Cairo")).toBe(iso);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @eyadex/api exec vitest run src/modules/appointments/domain/__tests__/shift-coverage.spec.ts src/modules/appointments/domain/__tests__/clinic-time.spec.ts`
Expected: FAIL — `Failed to resolve import "@eyadex/contracts/schedules"` (and `clinic-time`).

- [ ] **Step 3: Create `packages/contracts/src/services.ts`**

```ts
import { z } from "zod";
import { idSchema, pageQuerySchema, stripInvisibleControls } from "./common.ts";

/** D-15: any service, appointment or provider default lasts 5 minutes to 8 hours. */
export const DURATION_MIN_MINUTES = 5;
export const DURATION_MAX_MINUTES = 480;
/** D-15: a provider's default duration until the clinic admin changes it. */
export const DEFAULT_PROVIDER_DURATION_MINUTES = 20;

export const durationMinutesSchema = z
  .number({ invalid_type_error: "validation.number" })
  .int("validation.number")
  .min(DURATION_MIN_MINUTES, "validation.outOfRange")
  .max(DURATION_MAX_MINUTES, "validation.outOfRange");

// Invisible controls are dropped first, as role and patient names (they could only spoof or split).
const serviceName = z
  .string()
  .transform(stripInvisibleControls)
  .pipe(z.string().trim().min(1, "validation.required").max(100, "validation.tooLong"));

export const serviceStatusSchema = z.enum(["active", "inactive"]);
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;

/** D-12: a clinic-level service (name ar/en, duration). No price until the finance phase. */
export const serviceInputSchema = z
  .object({ nameAr: serviceName, nameEn: serviceName, durationMinutes: durationMinutesSchema })
  .strict();
export type ServiceInput = z.input<typeof serviceInputSchema>;

export const clinicServiceSchema = z
  .object({
    id: idSchema,
    nameAr: z.string(),
    nameEn: z.string(),
    durationMinutes: z.number().int(),
    status: serviceStatusSchema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type ClinicService = z.infer<typeof clinicServiceSchema>;

/** `GET /v1/services`: newest id last (`id` order, UUID v7), opaque cursor. */
export const serviceListHttpQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: serviceStatusSchema.optional(),
  })
  .strict();
export type ServiceListHttpQuery = z.infer<typeof serviceListHttpQuerySchema>;

export const serviceListResponseSchema = z
  .object({
    items: z.array(clinicServiceSchema),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type ServiceListResponse = z.infer<typeof serviceListResponseSchema>;

/** The web list query (the `ApiClient` shape, like the other areas). */
export const serviceListQuerySchema = pageQuerySchema.extend({
  status: serviceStatusSchema.nullable(),
});
export type ServiceListQuery = z.infer<typeof serviceListQuerySchema>;

/** D-1, D-15: whether a member can be booked, and the length of a booking with no service. */
export const bookingProfileInputSchema = z
  .object({ acceptsAppointments: z.boolean(), defaultDurationMinutes: durationMinutesSchema })
  .strict();
export type BookingProfileInput = z.infer<typeof bookingProfileInputSchema>;

export const bookingProfileSchema = bookingProfileInputSchema
  .extend({ memberId: idSchema })
  .strict();
export type BookingProfile = z.infer<typeof bookingProfileSchema>;
```

- [ ] **Step 4: Create `packages/contracts/src/schedules.ts`**

```ts
import { z } from "zod";
import { idSchema, stripInvisibleControls } from "./common.ts";

/** 0 = Sunday … 6 = Saturday (`Date.getDay`); the clinic's week starts on Sunday. */
export const weekdaySchema = z.number().int().min(0).max(6);
export const MINUTES_PER_DAY = 1440;
export const WEEK_MINUTES = 7 * MINUTES_PER_DAY;

const START = /^([01]\d|2[0-3]):[0-5]\d$/;
const END = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** Minutes after the clinic's midnight for `HH:MM` or `HH:MM:SS` (`24:00` = 1440). */
export function wallMinutes(time: string): number {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** `HH:MM` for minutes after midnight (1440 = `24:00`). */
export function minutesToWall(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** One weekly row in clinic wall-clock time (D-6); it never crosses midnight on its own (D-14). */
export const shiftSchema = z
  .object({
    weekday: weekdaySchema,
    startsAt: z.string().regex(START, "validation.time"),
    endsAt: z.string().regex(END, "validation.time"),
  })
  .strict()
  .refine((s) => wallMinutes(s.startsAt) < wallMinutes(s.endsAt), {
    message: "validation.timeOrder",
    path: ["endsAt"],
  });
export type Shift = z.infer<typeof shiftSchema>;
export type WallShift = Pick<Shift, "weekday" | "startsAt" | "endsAt">;

/** `PUT /v1/schedules/:membershipId/branches/:branchId`: the provider's whole week in that branch. */
export const branchScheduleInputSchema = z
  .object({ shifts: z.array(shiftSchema).max(42) })
  .strict();
export type BranchScheduleInput = z.infer<typeof branchScheduleInputSchema>;

export const scheduleShiftSchema = z
  .object({ branchId: idSchema, weekday: weekdaySchema, startsAt: z.string(), endsAt: z.string() })
  .strict();
export type ScheduleShift = z.infer<typeof scheduleShiftSchema>;

/** A bookable member (D-1): active, "accepts appointments" on. */
export const providerSummarySchema = z
  .object({
    membershipId: idSchema,
    fullName: z.string(),
    defaultDurationMinutes: z.number().int(),
    allBranches: z.boolean(),
    branchIds: z.array(idSchema),
  })
  .strict();
export type ProviderSummary = z.infer<typeof providerSummarySchema>;

export const providerListResponseSchema = z
  .object({ items: z.array(providerSummarySchema) })
  .strict();
export type ProviderListResponse = z.infer<typeof providerListResponseSchema>;

export const scheduleBranchSchema = z
  .object({ id: idSchema, nameAr: z.string(), nameEn: z.string(), isActive: z.boolean() })
  .strict();
export type ScheduleBranch = z.infer<typeof scheduleBranchSchema>;

export const timeOffSchema = z
  .object({
    id: idSchema,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    note: z.string().nullable(),
  })
  .strict();
export type TimeOff = z.infer<typeof timeOffSchema>;

const note = z
  .string()
  .transform(stripInvisibleControls)
  .pipe(z.string().trim().max(200, "validation.tooLong"));

/** D-6: a period the provider cannot be booked in (instants with an offset; stored UTC). */
export const timeOffInputSchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    note: note.nullable(),
  })
  .strict()
  .refine((v) => Date.parse(v.startsAt) < Date.parse(v.endsAt), {
    message: "validation.timeOrder",
    path: ["endsAt"],
  });
export type TimeOffInput = z.input<typeof timeOffInputSchema>;

/**
 * One provider's schedule as the caller may see it: the branches it works in inside the caller's
 * reach, its weekly rows in those branches, and its time off that has not ended.
 */
export const providerScheduleSchema = z
  .object({
    provider: providerSummarySchema,
    branches: z.array(scheduleBranchSchema),
    shifts: z.array(scheduleShiftSchema),
    timeOff: z.array(timeOffSchema),
  })
  .strict();
export type ProviderSchedule = z.infer<typeof providerScheduleSchema>;

type Span = { start: number; end: number };

const spanOf = (s: WallShift): Span => ({
  start: s.weekday * MINUTES_PER_DAY + wallMinutes(s.startsAt),
  end: s.weekday * MINUTES_PER_DAY + wallMinutes(s.endsAt),
});

/**
 * The first two rows that share a minute (touching ends do not), or null. A provider is in one place
 * at a time, so the caller passes the rows of every branch.
 */
export function findShiftOverlap<S extends WallShift>(
  shifts: readonly S[],
): readonly [S, S] | null {
  const sorted = [...shifts].sort((a, b) => spanOf(a).start - spanOf(b).start);
  let reach = sorted[0];
  for (const next of sorted.slice(1)) {
    if (reach === undefined) break;
    if (spanOf(next).start < spanOf(reach).end) return [reach, next];
    if (spanOf(next).end > spanOf(reach).end) reach = next;
  }
  return null;
}

// Back-to-back rows join (D-14); Saturday 24:00 meets Sunday 00:00, so the week's last span is also
// written once more, continued into the first.
function continuousSpans(shifts: readonly WallShift[]): Span[] {
  const out: Span[] = [];
  for (const span of shifts.map(spanOf).sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last !== undefined && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else out.push({ ...span });
  }
  const first = out[0];
  const last = out.at(-1);
  if (first !== undefined && last !== undefined && out.length > 1 && first.start === 0) {
    if (last.end === WEEK_MINUTES) out.push({ start: last.start, end: WEEK_MINUTES + first.end });
  }
  return out;
}

/**
 * Is the wall-clock interval (its weekday and minute after midnight, then its length) inside one
 * continuous shift? Rows of ONE branch only: the caller filters (D-6, D-14).
 */
export function coversWallInterval(
  shifts: readonly WallShift[],
  start: { weekday: number; minute: number },
  durationMinutes: number,
): boolean {
  const from = start.weekday * MINUTES_PER_DAY + start.minute;
  const to = from + durationMinutes;
  return continuousSpans(shifts).some(
    (s) =>
      (s.start <= from && to <= s.end) ||
      (s.start <= from + WEEK_MINUTES && to + WEEK_MINUTES <= s.end),
  );
}
```

- [ ] **Step 5: Create `packages/contracts/src/clinic-time.ts`**

```ts
/** Minutes the zone is ahead of UTC at that instant (a zone with daylight saving moves). */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return Math.round((local - at.getTime()) / 60_000);
}

/**
 * The UTC instant of a wall-clock date (`YYYY-MM-DD`) and time (`HH:MM`) in a clinic's zone. Two passes,
 * as `trialEndsAt` and `endOfLocalDay`: the first guess can fall on the other side of a DST change.
 */
export function wallToInstant(date: string, time: string, timeZone: string): string {
  const target = Date.parse(`${date}T${time}:00Z`);
  const guess = new Date(target - offsetMinutes(new Date(target), timeZone) * 60_000);
  return new Date(target - offsetMinutes(guess, timeZone) * 60_000).toISOString();
}

/** The wall-clock date (`YYYY-MM-DD`) and time (`HH:MM`) of an instant in a clinic's zone. */
export function instantToWall(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @eyadex/api exec vitest run src/modules/appointments/domain/__tests__/shift-coverage.spec.ts src/modules/appointments/domain/__tests__/clinic-time.spec.ts && pnpm --filter @eyadex/contracts typecheck && pnpm --filter @eyadex/contracts lint`
Expected: 11 tests PASS; typecheck and lint exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/services.ts packages/contracts/src/schedules.ts packages/contracts/src/clinic-time.ts apps/api/src/modules/appointments/domain/__tests__/shift-coverage.spec.ts apps/api/src/modules/appointments/domain/__tests__/clinic-time.spec.ts
git commit -m "feat(contracts): services, booking profile, weekly shifts and time off shapes

Back-to-back rows count as one shift, also across midnight and the week's end (D-14).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Contract — four error codes and the audit vocabulary

**Files:**

- Modify: `packages/contracts/src/common.ts:20-56` (`apiErrorCodeSchema`), `packages/contracts/src/organization.ts:44-52` (`clinicAuditEntitySchema`), `packages/contracts/src/audit.ts:95-149`
- Modify: `apps/api/src/shared/errors.ts:8-41` (`STATUS`), `apps/api/src/shared/api-error-messages.ts` (append four entries), `apps/api/src/modules/audit/domain/audit-snapshot.ts:13-60`
- Create: `apps/web/src/shared/i18n/en-scheduling.ts`, `apps/web/src/shared/i18n/ar-scheduling.ts` (errors part only in this task)
- Modify: `apps/web/src/shared/i18n/en.ts`, `ar.ts` (`errors` spread), `apps/web/src/shared/i18n/en-audit.ts`, `ar-audit.ts`, `apps/web/src/shared/api/mock/mock-audit-log.ts:1-7,111-122` (the platform side keeps only platform entities, as the API)
- Test: `apps/api/src/modules/audit/__tests__/scheduling-snapshots.spec.ts` (create); existing `apps/web/src/audit/audit-format.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: error codes `service_name_taken` (409), `schedule_overlap` (409), `provider_not_bookable` (400), `provider_not_in_branch` (400); audit entities `clinic_service`, `provider_schedule`, `provider_time_off` (clinic log only — not in `platformAuditEntitySchema`); actions `user.booking_changed`, `service.created`, `service.updated`, `service.deactivated`, `service.reactivated`, `schedule.replaced`, `time_off.added`, `time_off.cancelled`; snapshot allowlists: `clinic_service` = `nameAr, nameEn, durationMinutes, status`; `provider_schedule` = `providerName, branchId, shifts`; `provider_time_off` = `providerName, startsAt, endsAt, cancelled`; `user` gains `acceptsAppointments, defaultDurationMinutes`. Web exports `enSchedulingErrors` / `arSchedulingErrors`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/audit/__tests__/scheduling-snapshots.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { API_ERROR_MESSAGES } from "../../../shared/api-error-messages.ts";
import { ApiError } from "../../../shared/errors.ts";
import { auditSnapshots } from "../domain/audit-snapshot.ts";

describe("scheduling error codes", () => {
  it("answer with their status and both languages", () => {
    expect(new ApiError("service_name_taken").status).toBe(409);
    expect(new ApiError("schedule_overlap").status).toBe(409);
    expect(new ApiError("provider_not_bookable").status).toBe(400);
    expect(new ApiError("provider_not_in_branch").status).toBe(400);
    expect(API_ERROR_MESSAGES.schedule_overlap.message_ar).toMatch(/[؀-ۿ]/);
  });
});

describe("scheduling audit snapshots (PRD §4.11 allowlists)", () => {
  it("a service shows its names, duration and status only", () => {
    const after = { nameAr: "ليزر", nameEn: "Laser", durationMinutes: 30, status: "active", x: 1 };
    expect(auditSnapshots("clinic_service", { before: null, after }).after).toEqual({
      nameAr: "ليزر",
      nameEn: "Laser",
      durationMinutes: 30,
      status: "active",
    });
  });

  it("time off never shows its note; a booking change shows the two booking fields", () => {
    const off = { providerName: "Dr A", startsAt: "s", endsAt: "e", cancelled: false, note: "x" };
    expect(
      auditSnapshots("provider_time_off", { before: null, after: off }).after,
    ).not.toHaveProperty("note");
    const user = { fullName: "A", acceptsAppointments: true, defaultDurationMinutes: 20 };
    expect(auditSnapshots("user", { before: null, after: user }).after).toEqual(user);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @eyadex/api exec vitest run src/modules/audit/__tests__/scheduling-snapshots.spec.ts`
Expected: FAIL — `expected 500 to be 409` and `Cannot read properties of undefined (reading 'message_ar')`.

- [ ] **Step 3: Contracts**

`common.ts` — insert before `"unknown",`:

```ts
  "service_name_taken",
  "schedule_overlap",
  "provider_not_bookable",
  "provider_not_in_branch",
```

`organization.ts` — the entity enum becomes:

```ts
export const clinicAuditEntitySchema = z.enum([
  "clinic",
  "branch",
  "user",
  "invitation",
  "role",
  "patient",
  "clinic_mail_provider",
  "clinic_service",
  "provider_schedule",
  "provider_time_off",
]);
```

`audit.ts` — add to `CLINIC_AUDIT_ACTIONS` after `"user.profile_updated",`: `"user.booking_changed",`; after `"clinic.mail_provider_degraded",`:

```ts
  "service.created",
  "service.updated",
  "service.deactivated",
  "service.reactivated",
  "schedule.replaced",
  "time_off.added",
  "time_off.cancelled",
```

and replace `PLATFORM_AUDIT_ACTIONS`:

```ts
/**
 * Clinic-log actions the platform never reads: patient access, and the appointments module's
 * configuration (services, schedules, staff time off) — ADR-0026 §8.
 */
const CLINIC_ONLY_ACTION = /^(patient|service|schedule|time_off)\./;

/** What the platform audit screen can show: its own events plus clinic administrative ones. */
export const PLATFORM_AUDIT_ACTIONS = [
  ...PLATFORM_ONLY_AUDIT_ACTIONS,
  ...CLINIC_AUDIT_ACTIONS.filter((a) => !CLINIC_ONLY_ACTION.test(a)),
].filter((a, i, all) => all.indexOf(a) === i);
```

- [ ] **Step 4: API statuses, messages, snapshot allowlists**

`apps/api/src/shared/errors.ts` — in `STATUS` add after `patient_civil_id_taken: 409,`:

```ts
  service_name_taken: 409,
  schedule_overlap: 409,
  provider_not_bookable: 400,
  provider_not_in_branch: 400,
```

`apps/api/src/shared/api-error-messages.ts` — append inside `API_ERROR_MESSAGES` (before its closing `}`):

```ts
  service_name_taken: {
    message_ar: "توجد خدمة أخرى في العيادة بهذا الاسم",
    message_en: "Another service in this clinic already uses this name",
  },
  schedule_overlap: {
    message_ar: "فترات العمل تتداخل مع فترة أخرى لنفس الشخص",
    message_en: "These working hours overlap another period of the same person",
  },
  provider_not_bookable: {
    message_ar: "هذا المستخدم غير متاح للحجز؛ فعّل استقبال المواعيد له أولًا",
    message_en: "This user cannot be booked; turn on accepting appointments for them first",
  },
  provider_not_in_branch: {
    message_ar: "هذا المستخدم لا يعمل في هذا الفرع",
    message_en: "This user does not work in this branch",
  },
```

`apps/api/src/modules/audit/domain/audit-snapshot.ts` — add `"acceptsAppointments", "defaultDurationMinutes",` at the end of `PERSON`, and in `ALLOWED` after `clinic_mail_provider: [...]`:

```ts
  // ADR-0026: the appointments module's configuration. A time-off note is free text about a person's
  // absence: it is never recorded, so it can never be shown.
  clinic_service: ["nameAr", "nameEn", "durationMinutes", "status"],
  provider_schedule: ["providerName", "branchId", "shifts"],
  provider_time_off: ["providerName", "startsAt", "endsAt", "cancelled"],
```

- [ ] **Step 5: Web strings**

Create `apps/web/src/shared/i18n/en-scheduling.ts`:

```ts
// Appointments-module strings (services, schedules, booking profile), split out to keep each
// dictionary file small.
export const enSchedulingErrors = {
  service_name_taken: "Another service in this clinic already uses this name",
  schedule_overlap: "These working hours overlap another period of the same person",
  provider_not_bookable:
    "This user cannot be booked; turn on accepting appointments for them first",
  provider_not_in_branch: "This user does not work in this branch",
};
```

Create `apps/web/src/shared/i18n/ar-scheduling.ts`:

```ts
// نصوص موديول المواعيد (الخدمات والجداول وإعدادات الحجز)، مفصولة لإبقاء ملفات القاموس صغيرة.
export const arSchedulingErrors = {
  service_name_taken: "توجد خدمة أخرى في العيادة بهذا الاسم",
  schedule_overlap: "فترات العمل تتداخل مع فترة أخرى لنفس الشخص",
  provider_not_bookable: "هذا المستخدم غير متاح للحجز؛ فعّل استقبال المواعيد له أولًا",
  provider_not_in_branch: "هذا المستخدم لا يعمل في هذا الفرع",
};
```

`en.ts`: add `import { enSchedulingErrors } from "./en-scheduling";` and `    ...enSchedulingErrors,` right after `    ...enAccessErrors,`. `ar.ts`: the same with `arSchedulingErrors`.

`en-audit.ts` — `entities` add:

```ts
      clinic_service: "Service",
      provider_schedule: "Work schedule",
      provider_time_off: "Time off",
```

`actions` add a `booking_changed: "Booking settings changed",` line to `user`, and three groups after `role`:

```ts
      service: {
        created: "Service created",
        updated: "Service updated",
        deactivated: "Service deactivated",
        reactivated: "Service reactivated",
      },
      schedule: { replaced: "Work schedule saved" },
      time_off: { added: "Time off added", cancelled: "Time off cancelled" },
```

`fields` add:

```ts
      acceptsAppointments: "Accepts appointments",
      defaultDurationMinutes: "Default duration (minutes)",
      durationMinutes: "Duration (minutes)",
      providerName: "Provider",
      shifts: "Working hours",
      startsAt: "Starts",
      endsAt: "Ends",
      cancelled: "Cancelled",
```

`values` add `inactive: "Inactive",` (a service status).

`ar-audit.ts` — the same keys:

```ts
      clinic_service: "خدمة",
      provider_schedule: "جدول عمل",
      provider_time_off: "إجازة",
```

```ts
        booking_changed: "تغيير إعدادات الحجز",
```

```ts
      service: {
        created: "إنشاء خدمة",
        updated: "تعديل خدمة",
        deactivated: "تعطيل خدمة",
        reactivated: "إعادة تفعيل خدمة",
      },
      schedule: { replaced: "حفظ جدول العمل" },
      time_off: { added: "إضافة إجازة", cancelled: "إلغاء إجازة" },
```

```ts
      acceptsAppointments: "يستقبل المواعيد",
      defaultDurationMinutes: "المدة الافتراضية (دقائق)",
      durationMinutes: "المدة (دقائق)",
      providerName: "مقدّم الخدمة",
      shifts: "ساعات العمل",
      startsAt: "البداية",
      endsAt: "النهاية",
      cancelled: "ملغاة",
```

```ts
      inactive: "غير نشط",
```

In `mock-audit-log.ts`, add `platformAuditEntitySchema` to the `@eyadex/contracts/audit` import and replace the source filter of the clinic side (the `for (const e of db.clinicAudit)` loop head and its `entity: e.entity,` line):

```ts
      // Filtered at the source, as the API: only entities the platform may read (no patient, and none of
      // the appointments module's configuration, ADR-0026 §8) and administrative entries only.
      const clinicSide: PlatformAuditItem[] = [];
      for (const e of db.clinicAudit) {
        const entity = platformAuditEntitySchema.safeParse(e.entity);
        if (e.category !== "administrative" || !entity.success) continue;
```

and `entity: entity.data,` in the pushed item.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @eyadex/api exec vitest run src/modules/audit && pnpm --filter @eyadex/web exec vitest run src/audit && pnpm typecheck`
Expected: PASS (the web test checks the entity and action label sets against the contracts); typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/common.ts packages/contracts/src/organization.ts packages/contracts/src/audit.ts apps/api/src/shared/errors.ts apps/api/src/shared/api-error-messages.ts apps/api/src/modules/audit apps/web/src/shared/i18n
git commit -m "feat(contracts): scheduling error codes and audit vocabulary (clinic log only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: SQL `0042_appointments_setup.sql` + RLS negative tests + admin-key backfill test

**Files:**

- Create: `db/sql/0042_appointments_setup.sql`, `db/tests/admin-keys-backfill.sh`
- Modify: `db/tests/rls-isolation.sql` (seed loop, ISO-01 table list, write probes, move probes, delete probes, PLAT-01 block), `.github/workflows/ci.yml` (one step after the platform backfill step, lines 77-78)

**Interfaces:**

- Consumes: the catalogue of Task 2 (17 keys, ids `…0c0018`–`…0c0028`), the module value of Task 1.
- Produces: tables `clinic_services(clinic_id, id, name_ar, name_en, duration_minutes, status, created_at, updated_at)`, `provider_schedules(clinic_id, id, membership_id, branch_id, weekday smallint, starts_at time, ends_at time, created_at)`, `provider_time_off(clinic_id, id, membership_id, starts_at, ends_at, note, cancelled_at, created_at, updated_at)`; `memberships.accepts_appointments boolean NOT NULL DEFAULT false`, `memberships.default_duration_minutes integer NOT NULL DEFAULT 20`; grants `eyadex_app`: `SELECT, INSERT, UPDATE` on `clinic_services`, `provider_time_off`; `SELECT, INSERT, DELETE` on `provider_schedules`; `eyadex_platform`: nothing. CHECK names (as `pg_get_constraintdef` prints them, used by Task 6): see the mirror in Task 6.

- [ ] **Step 1: Write the failing negative tests**

In `db/tests/rls-isolation.sql`, inside the seed loop after the `clinic_expiry_reminders` insert, add:

```sql
    INSERT INTO clinic_services VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'f')::uuid, 'ليزر', 'Laser '||s, 30, 'active', now(), now());
    INSERT INTO provider_schedules VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'1')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, 0, '08:00', '12:00', now());
    INSERT INTO provider_time_off VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'2')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, now() + interval '1 day', now() + interval '2 days', null, null, now(), now());
```

Append `'clinic_services','provider_schedules','provider_time_off'` to the ISO-01 read loop's array (after `'clinic_expiry_reminders'`). In the write-probe block, before the `audit_log` probe, add:

```sql
  BEGIN
    INSERT INTO clinic_services VALUES (b, gen_random_uuid(), 'x', 'x', 30, 'active', now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: clinic_services';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO provider_schedules VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b5', '00000000-0000-7000-8000-0000000001b2', 1, '08:00', '09:00', now());
    RAISE EXCEPTION 'ISO-01 write leak: provider_schedules';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO provider_time_off VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b5', now(), now() + interval '1 hour', null, null, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: provider_time_off';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
```

Append `'clinic_services','provider_schedules','provider_time_off'` to the move-probe array (after `'clinic_mail_providers'`). After the `DELETE FROM patients` probe add:

```sql
  -- Appointments configuration (ADR-0026): services and time off are never deleted; a schedule row is
  -- replaced, and replacing never reaches another clinic's rows.
  BEGIN DELETE FROM clinic_services; RAISE EXCEPTION 'clinic_services are hard-deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM provider_time_off; RAISE EXCEPTION 'provider_time_off is hard-deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE provider_schedules SET weekday = 1; RAISE EXCEPTION 'provider_schedules are updatable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  DELETE FROM provider_schedules WHERE clinic_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: deleted % schedule rows of another clinic', n; END IF;
  -- The booking columns are clinic data like the rest of the membership (D-1, D-15).
  BEGIN UPDATE memberships SET default_duration_minutes = 4; RAISE EXCEPTION 'a 4-minute default was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
```

In the PLAT-01 block, after the `clinic_expiry_reminders` probe add:

```sql
  BEGIN PERFORM 1 FROM clinic_services LIMIT 1; RAISE EXCEPTION 'PLAT: platform can read clinic_services';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM provider_schedules LIMIT 1; RAISE EXCEPTION 'PLAT: platform can read provider_schedules';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM provider_time_off LIMIT 1; RAISE EXCEPTION 'PLAT: platform can read provider_time_off';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
```

Create `db/tests/admin-keys-backfill.sh`:

```sh
#!/bin/sh
# 0042 backfill (ADR-0026 §6): every existing locked clinic_admin role gains the appointments module's
# clinic-scope keys, and no other role changes. Builds a scratch database up to 0041, seeds a clinic
# with an admin and a doctor role, applies the rest with db/migrate.sh, checks, drops it.
# Usage: sh db/tests/admin-keys-backfill.sh   (libpq env vars; PGDATABASE = the admin database)
set -eu

t_dir=$(dirname "$0")
migrate="$t_dir/../migrate.sh"
repo_sql="$t_dir/../sql"
admin_db="${PGDATABASE:-postgres}"
db="eyadex_adminkeys_$$_$(date +%s)"
work=$(mktemp -d)
. "$t_dir/migrate-kit.sh"

cleanup() {
  PGDATABASE="$admin_db" psql -X -q -c "DROP DATABASE IF EXISTS \"$db\";" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

mkdir -p "$work/before" "$work/all"
for f in "$repo_sql"/*.sql; do
  cp "$f" "$work/all/"
  case "$(basename "$f")" in 004[2-9]_* | 00[5-9]*) ;; *) cp "$f" "$work/before/" ;; esac
done

PGDATABASE="$admin_db" psql -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\";"
PGDATABASE="$db" MIGRATE_SQL_DIR="$work/before" sh "$migrate" >/dev/null
PGDATABASE="$db" psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO clinics VALUES ('00000000-0000-7000-8000-0000000042a1','ak-a','أ','A','general','ar',
  'Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO roles VALUES
  ('00000000-0000-7000-8000-0000000042a1','00000000-0000-7000-8000-0000000042b1','clinic_admin',
   'مدير','Admin',true,true,now(),now()),
  ('00000000-0000-7000-8000-0000000042a1','00000000-0000-7000-8000-0000000042b2','doctor',
   'طبيب','Doctor',false,true,now(),now());
INSERT INTO role_permissions SELECT '00000000-0000-7000-8000-0000000042a1', uuidv7(),
  '00000000-0000-7000-8000-0000000042b1', id, now() FROM permissions WHERE key = 'view:branches:clinic';
SQL
PGDATABASE="$db" MIGRATE_SQL_DIR="$work/all" sh "$migrate" >/dev/null || fail "0042 refused the backfill"

keys() {
  PGDATABASE="$db" psql -X -q -tA -v ON_ERROR_STOP=1 -c "
    SELECT coalesce(string_agg(p.key, ',' ORDER BY p.key COLLATE \"C\"), '')
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = '$1' AND p.module = 'appointments';"
}
want="create:appointments:clinic,create:services:clinic,deactivate:services:clinic,overbook:appointments:clinic,update:appointments:clinic,update:schedules:clinic,update:services:clinic,view:appointments:clinic,view:schedules:clinic,view:services:clinic"
got=$(keys 00000000-0000-7000-8000-0000000042b1)
[ "$got" = "$want" ] || fail "the admin role holds '$got'"
pass "a locked clinic admin holds every clinic-scope key of the appointments module"
got=$(keys 00000000-0000-7000-8000-0000000042b2)
[ "$got" = "" ] || fail "the doctor role gained '$got'"
pass "no other role changes"
echo "admin-keys-backfill: all passed"
```

In `.github/workflows/ci.yml`, after the `Platform team backfill (0037)…` step (same indentation):

```yaml
- name: Admin key backfill (0042) reaches locked admin roles only
  run: sh db/tests/admin-keys-backfill.sh
```

- [ ] **Step 2: Run them to see them fail**

Run: `MSYS_NO_PATHCONV=1 sh /f/Dev/Worktrees/eyadex/dbcheck.sh eyadex-pg-a1 /f/Dev/Worktrees/eyadex/appt-spec`
Expected: FAIL at `--- db/tests` on `db/tests/rls-isolation.sql` with `relation "clinic_services" does not exist`.

- [ ] **Step 3: Write `db/sql/0042_appointments_setup.sql`**

```sql
-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Appointments slice A1 (ADR-0026, docs/specs/appointments-design.md §2-§3): the `appointments`
-- module flag, its permission keys, a member's booking profile, the clinic's services, weekly
-- provider schedules and time off. Appointments themselves arrive with slice A2.

-- D-9: a module the platform switches per clinic, like `patients`. Existing clinics get no row: a module
-- with no row is off (ADR-0010), so nothing changes for them until the platform turns it on.
ALTER TABLE clinic_features DROP CONSTRAINT clinic_features_module_check;
ALTER TABLE clinic_features ADD CONSTRAINT clinic_features_module_check
  CHECK (module IN ('patients', 'appointments'));

-- Spec §3: the action `overbook`, the module's three resources and the scope `own`. The rows mirror
-- PERMISSION_CATALOG (packages/contracts); code looks permissions up by key, never by id.
-- `view:patients:own` arrives with slice A3, together with the query that evaluates it.
ALTER TABLE permissions DROP CONSTRAINT permissions_key_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_key_check CHECK (key ~ '^(view|create|update|deactivate|overbook):(branches|users|roles|patients|audit_log|clinic_settings|appointments|services|schedules):(clinic|branch|own)$');
ALTER TABLE permissions DROP CONSTRAINT permissions_module_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_module_check
  CHECK (module IN ('patients', 'appointments'));
INSERT INTO permissions (id, key, action, resource, scope, module) VALUES
  ('00000000-0000-7000-8000-0000000c0018', 'view:appointments:clinic', 'view', 'appointments', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0019', 'view:appointments:branch', 'view', 'appointments', 'branch', 'appointments'),
  ('00000000-0000-7000-8000-0000000c001a', 'view:appointments:own', 'view', 'appointments', 'own', 'appointments'),
  ('00000000-0000-7000-8000-0000000c001b', 'create:appointments:clinic', 'create', 'appointments', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c001c', 'create:appointments:branch', 'create', 'appointments', 'branch', 'appointments'),
  ('00000000-0000-7000-8000-0000000c001d', 'update:appointments:clinic', 'update', 'appointments', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c001e', 'update:appointments:branch', 'update', 'appointments', 'branch', 'appointments'),
  ('00000000-0000-7000-8000-0000000c001f', 'overbook:appointments:clinic', 'overbook', 'appointments', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0020', 'overbook:appointments:branch', 'overbook', 'appointments', 'branch', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0021', 'view:services:clinic', 'view', 'services', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0022', 'create:services:clinic', 'create', 'services', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0023', 'update:services:clinic', 'update', 'services', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0024', 'deactivate:services:clinic', 'deactivate', 'services', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0025', 'view:schedules:clinic', 'view', 'schedules', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0026', 'view:schedules:branch', 'view', 'schedules', 'branch', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0027', 'update:schedules:clinic', 'update', 'schedules', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0028', 'update:schedules:branch', 'update', 'schedules', 'branch', 'appointments');

-- D-1, D-15: whether a member can be booked (never derived from the role name) and the length of a
-- booking with no service. Every existing member starts not bookable, 20 minutes.
ALTER TABLE memberships
  ADD COLUMN accepts_appointments boolean NOT NULL DEFAULT false,
  ADD COLUMN default_duration_minutes integer NOT NULL DEFAULT 20
    CONSTRAINT memberships_default_duration_minutes_check
    CHECK (default_duration_minutes BETWEEN 5 AND 480);

-- D-12: one clinic-level list. Names are unique per language like roles (0018), inactive ones included,
-- so reactivating one can never collide. No price until the finance phase; never deleted (deactivated).
CREATE TABLE clinic_services (
  clinic_id        uuid NOT NULL REFERENCES clinics (id),
  id               uuid NOT NULL,
  name_ar          text NOT NULL,
  name_en          text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  status           text NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id)
);
CREATE UNIQUE INDEX clinic_services_name_ar_unique ON clinic_services (clinic_id, lower(btrim(name_ar)));
CREATE UNIQUE INDEX clinic_services_name_en_unique ON clinic_services (clinic_id, lower(btrim(name_en)));
CREATE INDEX clinic_services_clinic_status_idx ON clinic_services (clinic_id, status);

-- D-6, D-14: a provider's weekly hours per branch in clinic wall-clock time; 24:00 ends a day. Rows are
-- configuration, not history: saving a branch's week deletes its rows and writes the new ones in one
-- transaction under the provider lock (ADR-0026 §4), and that change is audited. Overlaps across a
-- provider's branches are refused by the use case under the same lock (D-13: no new extension).
CREATE TABLE provider_schedules (
  clinic_id     uuid NOT NULL REFERENCES clinics (id),
  id            uuid NOT NULL,
  membership_id uuid NOT NULL,
  branch_id     uuid NOT NULL,
  weekday       smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at     time NOT NULL,
  ends_at       time NOT NULL,
  created_at    timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, membership_id) REFERENCES memberships (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  CONSTRAINT provider_schedules_interval_check CHECK (starts_at < ends_at)
);
CREATE INDEX provider_schedules_clinic_membership_weekday_idx
  ON provider_schedules (clinic_id, membership_id, weekday);
CREATE INDEX provider_schedules_clinic_branch_idx ON provider_schedules (clinic_id, branch_id);

-- D-6: periods a provider cannot be booked in, stored UTC. Never deleted: a mistaken one is cancelled.
-- The note is free text about a person's absence: it never reaches an audit row (ADR-0026 §7).
CREATE TABLE provider_time_off (
  clinic_id     uuid NOT NULL REFERENCES clinics (id),
  id            uuid NOT NULL,
  membership_id uuid NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  note          text NULL CHECK (char_length(note) <= 200),
  cancelled_at  timestamptz NULL,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, membership_id) REFERENCES memberships (clinic_id, id),
  CONSTRAINT provider_time_off_interval_check CHECK (starts_at < ends_at)
);
CREATE INDEX provider_time_off_clinic_membership_starts_idx
  ON provider_time_off (clinic_id, membership_id, starts_at);

ALTER TABLE clinic_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_services FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_services_tenant_isolation ON clinic_services
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE provider_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_schedules_tenant_isolation ON provider_schedules
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE provider_time_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_time_off FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_time_off_tenant_isolation ON provider_time_off
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The clinic runtime role only. Schedule rows are replaced (DELETE + INSERT), never updated; services and
-- time off are updated (deactivate, cancel), never deleted. The platform never reads any of them: they
-- name the clinic's staff and, from A2 on, sit next to the appointments that name patients.
GRANT SELECT, INSERT, UPDATE ON clinic_services, provider_time_off TO eyadex_app;
GRANT SELECT, INSERT, DELETE ON provider_schedules TO eyadex_app;
REVOKE ALL ON clinic_services, provider_schedules, provider_time_off FROM eyadex_platform;

-- PRD §5.3: "Clinic Admin (locked, everything)". A locked role refuses every write (ADR-0017), so only
-- this file can give existing admins the module's keys; without them no existing clinic could ever open
-- its services or schedules. No other existing role changes (spec §3). The keys of a module that is off
-- grant nothing until the platform turns it on (ADR-0010).
DO $$
BEGIN
  -- Every clinic's roles: only a role that bypasses RLS sees them all. Refuse loudly rather than
  -- backfill nothing.
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0042: the admin backfill must run as the migration owner (superuser)';
  END IF;
END $$;
INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
SELECT r.clinic_id, uuidv7(), r.id, p.id, now()
FROM roles r CROSS JOIN permissions p
WHERE r.system_key = 'clinic_admin' AND r.is_locked
  AND p.module = 'appointments' AND p.scope = 'clinic'
ON CONFLICT (clinic_id, role_id, permission_id) DO NOTHING;
```

- [ ] **Step 4: Run the database checks**

Run: `MSYS_NO_PATHCONV=1 sh /f/Dev/Worktrees/eyadex/dbcheck.sh eyadex-pg-a1 /f/Dev/Worktrees/eyadex/appt-spec`
Expected: `0042_appointments_setup.sql` applied; status clean; every `db/tests/*.sql` passes (`RLS isolation tests: all passed`, `FK index tests: all passed`); `DBCHECK OK`.

Then the backfill test inside the same container (dbcheck copied `db/` to `/work`):

Run: `MSYS_NO_PATHCONV=1 docker exec -e PGUSER=eyadex_owner -e PGPASSWORD=ci-only-owner -e PGHOST=127.0.0.1 -e PGDATABASE=postgres eyadex-pg-a1 sh -c 'cd /work && sh db/tests/admin-keys-backfill.sh'`
Expected: two `ok:` lines and `admin-keys-backfill: all passed`.

Then record the printed CHECK definitions Task 6 must mirror:

Run: `MSYS_NO_PATHCONV=1 docker exec -e PGPASSWORD=ci-only-owner eyadex-pg-a1 psql -h 127.0.0.1 -U eyadex_owner -d eyadex -tAc "SELECT conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE contype = 'c' AND conrelid::regclass::text IN ('clinic_features','permissions','memberships','clinic_services','provider_schedules','provider_time_off') ORDER BY 1"`
Expected (compare with Task 6's mirror strings; if PostgreSQL prints anything differently, the mirror copies what it prints):

```text
clinic_features clinic_features_module_check CHECK ((module = ANY (ARRAY['patients'::text, 'appointments'::text])))
clinic_services clinic_services_duration_minutes_check CHECK (((duration_minutes >= 5) AND (duration_minutes <= 480)))
clinic_services clinic_services_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
memberships memberships_default_duration_minutes_check CHECK (((default_duration_minutes >= 5) AND (default_duration_minutes <= 480)))
permissions permissions_module_check CHECK ((module = ANY (ARRAY['patients'::text, 'appointments'::text])))
provider_schedules provider_schedules_interval_check CHECK ((starts_at < ends_at))
provider_schedules provider_schedules_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
provider_time_off provider_time_off_interval_check CHECK ((starts_at < ends_at))
provider_time_off provider_time_off_note_check CHECK ((char_length(note) <= 200))
```

(plus the pre-existing memberships/permissions checks and `permissions_key_check`).

- [ ] **Step 5: Commit**

```bash
git add db/sql/0042_appointments_setup.sql db/tests/rls-isolation.sql db/tests/admin-keys-backfill.sh .github/workflows/ci.yml
git commit -m "feat(db): 0042 appointments setup - services, schedules, time off, booking columns, keys

Forced RLS and negative tests for every new table; eyadex_platform has no grant; existing locked
clinic admins receive the module's clinic keys (ADR-0026).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Drizzle mirror of 0042 (+ the `time` type in the drift test)

**Files:**

- Create: `packages/db/src/schema/scheduling.ts`
- Modify: `packages/db/src/schema/memberships.ts:23-66`, `packages/db/src/schema/clinics.ts:65,77`, `packages/db/src/schema/roles.ts:62-74`, `packages/db/src/schema/index.ts`, `packages/db/src/__tests__/schema-drift.db.spec.ts:58-90`, `packages/db/src/__tests__/schema-surface.spec.ts:15-26`

**Interfaces:**

- Consumes: the database of Task 5.
- Produces: `clinicServices`, `providerSchedules`, `providerTimeOff` from `@eyadex/db/schema`; `memberships.acceptsAppointments`, `memberships.defaultDurationMinutes`.

- [ ] **Step 1: Write the failing test**

In `schema-surface.spec.ts`, add to the `clinicOwned` array:

```ts
      schema.clinicServices,
      schema.providerSchedules,
      schema.providerTimeOff,
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @eyadex/db exec vitest run src/__tests__/schema-surface.spec.ts` (export the `test:db` env of the Global Constraints first for the second command) and `pnpm --filter @eyadex/db test:db -- src/__tests__/schema-drift.db.spec.ts`
Expected: surface FAILS (`getTableConfig` of `undefined`); drift FAILS on `mirrors exactly the tables the baseline creates` (three tables missing) and on `memberships` columns.

- [ ] **Step 3: Write `packages/db/src/schema/scheduling.ts`**

```ts
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { branches } from "./branches.ts";
import { clinics } from "./clinics.ts";
import { memberships } from "./memberships.ts";

// Mirror of db/sql/0042 (ADR-0026). Clinic tables: forced RLS, eyadex_app only.
const tz = { withTimezone: true, mode: "date" } as const;

export const clinicServices = pgTable(
  "clinic_services",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "clinic_services_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "clinic_services_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    uniqueIndex("clinic_services_name_ar_unique").on(t.clinicId, sql`lower(btrim(${t.nameAr}))`),
    uniqueIndex("clinic_services_name_en_unique").on(t.clinicId, sql`lower(btrim(${t.nameEn}))`),
    index("clinic_services_clinic_status_idx").on(t.clinicId, t.status),
    check(
      "clinic_services_duration_minutes_check",
      sql.raw("((duration_minutes >= 5) AND (duration_minutes <= 480))"),
    ),
    check(
      "clinic_services_status_check",
      sql.raw("(status = ANY (ARRAY['active'::text, 'inactive'::text]))"),
    ),
  ],
);

export const providerSchedules = pgTable(
  "provider_schedules",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    weekday: smallint("weekday").notNull(),
    startsAt: time("starts_at").notNull(),
    endsAt: time("ends_at").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "provider_schedules_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "provider_schedules_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "provider_schedules_clinic_id_membership_id_fkey",
      columns: [t.clinicId, t.membershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }),
    foreignKey({
      name: "provider_schedules_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    index("provider_schedules_clinic_membership_weekday_idx").on(
      t.clinicId,
      t.membershipId,
      t.weekday,
    ),
    index("provider_schedules_clinic_branch_idx").on(t.clinicId, t.branchId),
    check("provider_schedules_interval_check", sql.raw("(starts_at < ends_at)")),
    check("provider_schedules_weekday_check", sql.raw("((weekday >= 0) AND (weekday <= 6))")),
  ],
);

export const providerTimeOff = pgTable(
  "provider_time_off",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    startsAt: timestamp("starts_at", tz).notNull(),
    endsAt: timestamp("ends_at", tz).notNull(),
    note: text("note"),
    cancelledAt: timestamp("cancelled_at", tz),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "provider_time_off_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "provider_time_off_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "provider_time_off_clinic_id_membership_id_fkey",
      columns: [t.clinicId, t.membershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }),
    index("provider_time_off_clinic_membership_starts_idx").on(
      t.clinicId,
      t.membershipId,
      t.startsAt,
    ),
    check("provider_time_off_interval_check", sql.raw("(starts_at < ends_at)")),
    check("provider_time_off_note_check", sql.raw("(char_length(note) <= 200)")),
  ],
);
```

- [ ] **Step 4: Mirror the changed tables and export**

`memberships.ts` — import `integer` from `drizzle-orm/pg-core`, change the header comment to `// Mirror of db/sql/0005, 0006, 0015, 0017, 0027, 0042. …`, add the two columns after `lastLoginAt` (column order does not matter to the drift test, it sorts):

```ts
    acceptsAppointments: boolean("accepts_appointments").notNull().default(false),
    defaultDurationMinutes: integer("default_duration_minutes").notNull().default(20),
```

and the check after `memberships_status_check`:

```ts
    check(
      "memberships_default_duration_minutes_check",
      sql.raw("((default_duration_minutes >= 5) AND (default_duration_minutes <= 480))"),
    ),
```

`clinics.ts` — in `clinicFeatures`: `module: text("module", { enum: ["patients", "appointments"] }).notNull(),` and

```ts
    check(
      "clinic_features_module_check",
      sql.raw("(module = ANY (ARRAY['patients'::text, 'appointments'::text]))"),
    ),
```

`roles.ts` — in `permissions`: `module: text("module", { enum: ["patients", "appointments"] }),` and the two checks:

```ts
    check(
      "permissions_key_check",
      sql.raw(
        "(key ~ '^(view|create|update|deactivate|overbook):(branches|users|roles|patients|audit_log|clinic_settings|appointments|services|schedules):(clinic|branch|own)$'::text)",
      ),
    ),
    check(
      "permissions_module_check",
      sql.raw("(module = ANY (ARRAY['patients'::text, 'appointments'::text]))"),
    ),
```

`index.ts` — append:

```ts
export { clinicServices, providerSchedules, providerTimeOff } from "./scheduling.ts";
```

`schema-drift.db.spec.ts` — in `mirrorShape`, where the column tuple is built, replace `c.getSQLType(),` with `sqlTypeOf(c.getSQLType()),` and add above `mirrorShape`:

```ts
// information_schema spells `time` in full; Drizzle's PgTime prints the short form (0042, ADR-0026).
const sqlTypeOf = (type: string): string => (type === "time" ? "time without time zone" : type);
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @eyadex/db exec vitest run src/__tests__/schema-surface.spec.ts && pnpm --filter @eyadex/db test:db -- src/__tests__/schema-drift.db.spec.ts && pnpm --filter @eyadex/db typecheck`
Expected: PASS (if a check string differs, copy PostgreSQL's text from Task 5 Step 4 exactly).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema packages/db/src/__tests__/schema-drift.db.spec.ts packages/db/src/__tests__/schema-surface.spec.ts
git commit -m "feat(db): Drizzle mirror of 0042 (services, schedules, time off, booking columns)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Identity domain — `own` as the narrowest grant, the new-clinic admin template

**Files:**

- Modify: `apps/api/src/modules/identity/domain/permission-check.ts` (whole file), `apps/api/src/modules/identity/domain/system-roles.ts:13-21`
- Test: `apps/api/src/modules/identity/domain/__tests__/grant-rules.spec.ts` (append two `describe` blocks)

**Interfaces:**

- Consumes: `PERMISSION_CATALOG` incl. the 17 keys (Task 2).
- Produces: `PermissionGrant = "clinic" | "branch" | "own"`; `grantFor(permissions, required)` — clinic key wins, then branch (for a `branch` or `own` requirement), then the `own` key itself (for an `own` requirement); `SYSTEM_ROLES` admin = every `scope === "clinic"` catalogue key. Doctor, receptionist and technician templates unchanged (A3).

- [ ] **Step 1: Write the failing tests**

Append to `grant-rules.spec.ts` (add `import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";` and `import { grantFor } from "../permission-check.ts";` at the top):

```ts
describe("the own scope (spec §3: the narrowest; a wider scope on the same action wins)", () => {
  it("own is granted by own, branch or clinic, and grants nothing wider", () => {
    expect(grantFor(["view:appointments:own"], "view:appointments:own")).toBe("own");
    expect(grantFor(["view:appointments:branch"], "view:appointments:own")).toBe("branch");
    expect(grantFor(["view:appointments:clinic"], "view:appointments:own")).toBe("clinic");
    expect(grantFor(["view:appointments:own"], "view:appointments:branch")).toBeNull();
    expect(grantFor(["view:appointments:own"], "view:appointments:clinic")).toBeNull();
  });

  it("a branch-scope actor covers an own key when defining or granting a role", () => {
    expect(uncoveredKeys(["view:appointments:branch"], ["view:appointments:own"])).toEqual([]);
    expect(uncoveredKeys(["view:appointments:own"], ["view:appointments:branch"])).toEqual([
      "view:appointments:branch",
    ]);
  });
});

describe("new-clinic system roles (ADR-0026 §6)", () => {
  it("the locked admin holds every clinic-scope key of the catalogue, appointments included", () => {
    const clinicKeys = PERMISSION_CATALOG.filter((p) => p.scope === "clinic").map((p) => p.key);
    expect([...adminKeys].sort()).toEqual([...clinicKeys].sort());
    expect(adminKeys).toContain("update:schedules:clinic");
  });

  it("doctor, receptionist and technician keep their keys until slice A3", () => {
    const keysOf = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)!.permissions;
    expect(keysOf("doctor")).toEqual(["view:patients:branch"]);
    expect(keysOf("receptionist")).toEqual([
      "view:patients:branch",
      "create:patients:branch",
      "update:patients:branch",
    ]);
    expect(keysOf("technician")).toEqual(["view:patients:branch"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @eyadex/api exec vitest run src/modules/identity/domain/__tests__/grant-rules.spec.ts`
Expected: FAIL — `expected null to be 'own'` and the admin key list lacks `update:schedules:clinic`.

- [ ] **Step 3: Rewrite `permission-check.ts`**

```ts
import type { PermissionKey } from "@eyadex/contracts/permissions";

/**
 * النطاق اللي الصلاحية اتمنحت بيه: `clinic` = كل الفروع، `branch` = فروع المستخدم، `own` = سجلاته بس
 * (spec المواعيد §3؛ تقييمه في الاستعلامات بييجي في A3).
 */
export type PermissionGrant = "clinic" | "branch" | "own";

/**
 * هل المفاتيح دي بتدي الصلاحية المطلوبة؟ الأوسع على نفس الفعل والمورد بيكسب دايمًا: `clinic` ثم
 * `branch` ثم `own`. مطلوب `clinic` ما بيعدّيش إلا بمفتاح `clinic`؛ مطلوب `branch` بيعدّي بـ `clinic` أو
 * `branch`؛ مطلوب `own` بيعدّي بأي واحد من التلاتة. مفيش أي فحص على اسم الدور أو مفتاحه.
 *
 * @param permissions مفاتيح الدور الفعلية
 * @param required المفتاح اللي الـ route طالبه
 * @returns النطاق الممنوح، أو `null` = مرفوض
 */
export function grantFor(
  permissions: readonly string[],
  required: PermissionKey,
): PermissionGrant | null {
  const [action, resource, scope] = required.split(":");
  if (permissions.includes(`${action}:${resource}:clinic`)) return "clinic";
  if (scope === "clinic") return null;
  if (permissions.includes(`${action}:${resource}:branch`)) return "branch";
  if (scope === "own" && permissions.includes(required)) return "own";
  return null;
}
```

- [ ] **Step 4: The admin template follows the catalogue**

In `system-roles.ts`, add `import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";` and replace the `clinicScope` constant:

```ts
// PRD §5.3 "Clinic Admin (locked, everything)": every clinic-scope key of the catalogue, so a key the
// catalogue gains reaches new clinics' admins with no second list (ADR-0026 §6). Same rule as the web
// mock's ROLE_TEMPLATES.
const clinicScope = PERMISSION_CATALOG.filter((p) => p.scope === "clinic").map((p) => p.key);
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @eyadex/api exec vitest run src/modules/identity && pnpm --filter @eyadex/api typecheck`
Expected: PASS (the existing `grantFor` tests in `access-guard.spec.ts` stay green); typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/identity/domain/permission-check.ts apps/api/src/modules/identity/domain/system-roles.ts apps/api/src/modules/identity/domain/__tests__/grant-rules.spec.ts
git commit -m "feat(api): own is the narrowest grant; new clinics' admin holds the appointments keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Tenancy — a new clinic gets one feature row per module

**Files:**

- Modify: `apps/api/src/modules/tenancy/persistence/pg-new-clinic-writer.ts` (whole file), `apps/api/src/modules/tenancy/use-cases/create-clinic-with-admin/create-clinic-with-admin.ts:79`
- Test: `apps/api/src/modules/platform/__tests__/create-clinic.db.spec.ts:99` and one new `it`

**Interfaces:**

- Consumes: `moduleSchema`, `createClinicRequestSchema.modules.appointments` (default `false`) — Task 1; the `appointments` CHECK value — Task 5.
- Produces: `insertNewClinic(tx, clinicId, input, newId: () => string, now)` writes one `clinic_features` row per `moduleSchema` option.

- [ ] **Step 1: Write the failing test**

In `create-clinic.db.spec.ts`, change line 99 to `expect(await count("clinic_features", "clinic_id::text", clinicId)).toBe(2);` and add inside `describe("POST /v1/platform/clinics (ONB-01)", …)`:

```ts
it("D-9: writes one flag per module; appointments is off unless the request turns it on", async () => {
  const flags = async (clinicId: string) =>
    Object.fromEntries(
      (
        await h.owner`SELECT module, enabled FROM clinic_features WHERE clinic_id = ${clinicId}`
      ).map((r) => [r["module"], r["enabled"]]),
    );
  const off = (await create(body())).json().clinicId as string;
  expect(await flags(off)).toEqual({ patients: true, appointments: false });
  const on = await create({ ...body(), modules: { patients: false, appointments: true } });
  expect(on.statusCode).toBe(201);
  expect(await flags(on.json().clinicId)).toEqual({ patients: false, appointments: true });
});
```

- [ ] **Step 2: Run it to see it fail**

Run (with the `test:db` env exported): `pnpm --filter @eyadex/api test:db -- src/modules/platform/__tests__/create-clinic.db.spec.ts`
Expected: FAIL — `expected 1 to be 2` and `expected { patients: true } to deeply equal { patients: true, appointments: false }`.

- [ ] **Step 3: Write one row per module**

Replace `pg-new-clinic-writer.ts`:

```ts
import { moduleSchema } from "@eyadex/contracts/clinics";
import type { CreateClinicRequest } from "@eyadex/contracts/onboarding";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * بيكتب صف العيادة وصف لكل موديول (0001، 0002، 0042) جوه transaction الـ onboarding. الـ slug المكرر
 * بيطلع `DatabaseError` بالقيد `clinics_slug_key`. موديول جديد في `moduleSchema` بياخد صفه من غير تعديل هنا.
 *
 * @param tx transaction العيادة الجديدة
 * @param clinicId الـ id اللي `withNewTenant` ولّده
 * @param input الطلب بعد الـ contract
 * @param newId مولّد ids صفوف `clinic_features` (UUID v7)
 * @param now الوقت
 * @returns بيخلص لما الصفوف تتكتب
 */
export async function insertNewClinic(
  tx: Tx,
  clinicId: string,
  input: Omit<CreateClinicRequest, "expiresAt" | "trialDays"> & { readonly expiresAt: Date },
  newId: () => string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone,
          status, expires_at, max_users, max_branches, created_at, updated_at)
        VALUES (${clinicId}, ${input.slug}, ${input.nameAr}, ${input.nameEn}, ${input.specialty},
          ${input.defaultLanguage}, ${input.timezone}, ${input.status},
          ${input.expiresAt.toISOString()}::timestamptz, ${input.maxUsers},
          ${input.maxBranches}, ${at}::timestamptz, ${at}::timestamptz)`,
  );
  for (const module of moduleSchema.options) {
    await tx.execute(
      sql`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
          VALUES (${clinicId}, ${newId()}, ${module}, ${input.modules[module]}, ${at}::timestamptz)`,
    );
  }
}
```

`create-clinic-with-admin.ts:79`:

```ts
await insertNewClinic(tx, clinicId, { ...input, expiresAt: expiry }, () => ids.newId(), now);
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @eyadex/api test:db -- src/modules/platform src/modules/tenancy`
Expected: PASS (incl. the Task 1 expectations in `platform-clinic-admin.db.spec.ts` and `tenancy.db.spec.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/tenancy/persistence/pg-new-clinic-writer.ts apps/api/src/modules/tenancy/use-cases/create-clinic-with-admin/create-clinic-with-admin.ts apps/api/src/modules/platform/__tests__/create-clinic.db.spec.ts
git commit -m "feat(api): a new clinic gets one module flag per module, appointments included

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Appointments domain — scope, services, schedules, time off

**Files:**

- Create: `apps/api/src/modules/appointments/domain/scheduling-scope.ts`, `service-rules.ts`, `schedule-rules.ts`, `time-off-rules.ts`
- Test: `apps/api/src/modules/appointments/domain/__tests__/scheduling-domain.spec.ts`

**Interfaces:**

- Consumes: `findShiftOverlap`, `minutesToWall`, `wallMinutes`, `Shift` (Task 3); `ServiceStatus` (Task 3); `scrubAuditText` (`@eyadex/observability`).
- Produces:
  - `scheduling-scope.ts`: `type Reach = { readonly all: true } | { readonly all: false; readonly branchIds: readonly string[] }`; `type RouteGrant = "clinic" | "branch" | "own" | undefined`; `reachOf(grant: RouteGrant, member: Reach): Reach | null`; `reachCovers(reach: Reach, branchId: string): boolean`; `interface ProviderReach { readonly allBranches: boolean; readonly branchIds: readonly string[] }`; `providerWithin(reach: Reach, provider: ProviderReach): boolean`; `providerWorksIn(provider: ProviderReach, branchId: string): boolean`.
  - `service-rules.ts`: `interface ServiceRecord { id; nameAr; nameEn; durationMinutes; status: ServiceStatus }`; `type ServiceFields = Pick<ServiceRecord, "nameAr" | "nameEn" | "durationMinutes">`; `isServiceUnchanged(before: ServiceRecord, input: ServiceFields): boolean`; `serviceAuditSnapshot(s: ServiceRecord): { nameAr; nameEn; durationMinutes; status }`.
  - `schedule-rules.ts`: `interface ScheduleRow { readonly id: string; readonly branchId: string; readonly weekday: number; readonly startsAt: string; readonly endsAt: string }` (`HH:MM`); `wallFromDb(value: string): string`; `type ScheduleDecision = { kind: "same" } | { kind: "overlap" } | { kind: "replace"; shifts: readonly Shift[] }`; `decideBranchSchedule(current: readonly ScheduleRow[], branchId: string, wanted: readonly Shift[]): ScheduleDecision`; `shiftLabel(s: Pick<Shift, "weekday" | "startsAt" | "endsAt">): string` (`"0 08:00-12:00"`); `scheduleAuditSnapshot(providerName: string, branchId: string, shifts: readonly Pick<Shift, "weekday" | "startsAt" | "endsAt">[]): { providerName; branchId; shifts: string[] }`.
  - `time-off-rules.ts`: `interface TimeOffRecord { readonly id: string; readonly startsAt: Date; readonly endsAt: Date; readonly note: string | null; readonly cancelledAt: Date | null }`; `normalizeNote(note: string | null): string | null`; `decideTimeOffCancel(record: TimeOffRecord): "same" | "cancel"`; `timeOffAuditSnapshot(providerName: string, record: TimeOffRecord): { providerName; startsAt; endsAt; cancelled }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/appointments/domain/__tests__/scheduling-domain.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  decideBranchSchedule,
  scheduleAuditSnapshot,
  wallFromDb,
  type ScheduleRow,
} from "../schedule-rules.ts";
import {
  providerWithin,
  providerWorksIn,
  reachCovers,
  reachOf,
  type Reach,
} from "../scheduling-scope.ts";
import { isServiceUnchanged, serviceAuditSnapshot, type ServiceRecord } from "../service-rules.ts";
import {
  decideTimeOffCancel,
  normalizeNote,
  timeOffAuditSnapshot,
  type TimeOffRecord,
} from "../time-off-rules.ts";

const MINE: Reach = { all: false, branchIds: ["r"] };
const row = (branchId: string, weekday: number, startsAt: string, endsAt: string): ScheduleRow => ({
  id: `${branchId}${weekday}${startsAt}`,
  branchId,
  weekday,
  startsAt,
  endsAt,
});

describe("reach of a route's grant", () => {
  it("clinic = every branch, branch = the member's branches, own or nothing = no reach", () => {
    expect(reachOf("clinic", MINE)).toEqual({ all: true });
    expect(reachOf("branch", MINE)).toEqual(MINE);
    expect(reachOf("branch", { all: true })).toEqual({ all: true });
    expect(reachOf("own", MINE)).toBeNull();
    expect(reachOf(undefined, MINE)).toBeNull();
  });

  it("a provider is within reach when it works in one of the reached branches", () => {
    expect(reachCovers(MINE, "r")).toBe(true);
    expect(reachCovers(MINE, "d")).toBe(false);
    expect(providerWithin(MINE, { allBranches: false, branchIds: ["d", "r"] })).toBe(true);
    expect(providerWithin(MINE, { allBranches: false, branchIds: ["d"] })).toBe(false);
    expect(providerWithin(MINE, { allBranches: true, branchIds: [] })).toBe(true);
    expect(providerWorksIn({ allBranches: false, branchIds: ["d"] }, "r")).toBe(false);
  });
});

describe("decideBranchSchedule (D-6, D-13)", () => {
  const current = [row("d", 0, "08:00", "12:00"), row("r", 1, "08:00", "12:00")];

  it("the same week in the same branch changes nothing, in any order", () => {
    const same = [{ weekday: 0, startsAt: "08:00", endsAt: "12:00" }];
    expect(decideBranchSchedule(current, "d", same)).toEqual({ kind: "same" });
  });

  it("refuses a week that overlaps the provider's rows in another branch", () => {
    const clash = [{ weekday: 1, startsAt: "11:00", endsAt: "13:00" }];
    expect(decideBranchSchedule(current, "d", clash)).toEqual({ kind: "overlap" });
  });

  it("refuses two wanted rows that overlap each other", () => {
    const self = [
      { weekday: 3, startsAt: "08:00", endsAt: "10:00" },
      { weekday: 3, startsAt: "09:30", endsAt: "11:00" },
    ];
    expect(decideBranchSchedule([], "d", self)).toEqual({ kind: "overlap" });
  });

  it("replaces with back-to-back rows across midnight (D-14) and drops the branch's old rows", () => {
    const night = [
      { weekday: 1, startsAt: "00:00", endsAt: "01:00" },
      { weekday: 0, startsAt: "20:00", endsAt: "24:00" },
    ];
    expect(decideBranchSchedule(current, "d", night)).toEqual({
      kind: "replace",
      shifts: [night[1], night[0]],
    });
    expect(decideBranchSchedule(current, "d", [])).toEqual({ kind: "replace", shifts: [] });
  });

  it("reads PostgreSQL time text as HH:MM, 24:00 included", () => {
    expect(wallFromDb("08:30:00")).toBe("08:30");
    expect(wallFromDb("24:00:00")).toBe("24:00");
  });
});

describe("audit snapshots (allowlisted, scrubbed)", () => {
  it("a schedule snapshot names the provider and lists the rows as text", () => {
    const shifts = [{ weekday: 0, startsAt: "08:00", endsAt: "12:00" }];
    expect(scheduleAuditSnapshot("Dr 99998888", "d", shifts)).toEqual({
      providerName: expect.not.stringContaining("99998888"),
      branchId: "d",
      shifts: ["0 08:00-12:00"],
    });
  });

  it("a service is unchanged only when all three fields match; its snapshot has four fields", () => {
    const s: ServiceRecord = {
      id: "s",
      nameAr: "ليزر",
      nameEn: "Laser",
      durationMinutes: 30,
      status: "active",
    };
    expect(isServiceUnchanged(s, { nameAr: "ليزر", nameEn: "Laser", durationMinutes: 30 })).toBe(
      true,
    );
    expect(isServiceUnchanged(s, { nameAr: "ليزر", nameEn: "Laser", durationMinutes: 45 })).toBe(
      false,
    );
    expect(Object.keys(serviceAuditSnapshot(s)).sort()).toEqual([
      "durationMinutes",
      "nameAr",
      "nameEn",
      "status",
    ]);
  });

  it("time off: a blank note is no note, a second cancel changes nothing, the note never reaches audit", () => {
    expect(normalizeNote("   ")).toBeNull();
    expect(normalizeNote(" leave ")).toBe("leave");
    const off: TimeOffRecord = {
      id: "t",
      startsAt: new Date("2026-10-11T06:00:00Z"),
      endsAt: new Date("2026-10-12T06:00:00Z"),
      note: "medical",
      cancelledAt: null,
    };
    expect(decideTimeOffCancel(off)).toBe("cancel");
    expect(decideTimeOffCancel({ ...off, cancelledAt: new Date() })).toBe("same");
    expect(timeOffAuditSnapshot("Dr A", off)).toEqual({
      providerName: "Dr A",
      startsAt: "2026-10-11T06:00:00.000Z",
      endsAt: "2026-10-12T06:00:00.000Z",
      cancelled: false,
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @eyadex/api exec vitest run src/modules/appointments/domain/__tests__/scheduling-domain.spec.ts`
Expected: FAIL — `Failed to load url ../schedule-rules.ts`.

- [ ] **Step 3: Write `scheduling-scope.ts`**

```ts
/** فروع الفاعل لفعل واحد: كل الفروع، أو قايمة فروع (نفس شكل `BranchScope` في identity). */
export type Reach =
  { readonly all: true } | { readonly all: false; readonly branchIds: readonly string[] };

/** النطاق اللي الـ guard منح بيه صلاحية الـ route (`ClinicRequest.permissionGrant`). */
export type RouteGrant = "clinic" | "branch" | "own" | undefined;

/** فروع عضو زي ما العضوية بتقولها. */
export interface ProviderReach {
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
}

/**
 * وصول فعل على الجداول من منحة الـ guard: مفتاح `clinic` = كل الفروع، مفتاح `branch` = فروع العضو.
 * `own` (A3) أو مفيش منحة = مفيش وصول، والرفض هو الافتراضي.
 *
 * @param grant النطاق الممنوح للـ route
 * @param member فروع العضو من سياق الطلب
 * @returns الوصول، أو `null`
 */
export function reachOf(grant: RouteGrant, member: Reach): Reach | null {
  if (grant === "clinic") return { all: true };
  if (grant === "branch") return member;
  return null;
}

/**
 * هل الوصول بيغطي الفرع؟
 *
 * @param reach الوصول
 * @param branchId الفرع
 * @returns `true` لو مغطّي
 */
export function reachCovers(reach: Reach, branchId: string): boolean {
  return reach.all || reach.branchIds.includes(branchId);
}

/**
 * هل مقدّم الخدمة شغّال في فرع واحد على الأقل جوه الوصول؟ برّه الوصول = `not_found` عند المنادي، فمحدش
 * يقدر يستكشف أعضاء فروع تانية.
 *
 * @param reach وصول الفاعل
 * @param provider فروع مقدّم الخدمة
 * @returns `true` لو ظاهر للفاعل
 */
export function providerWithin(reach: Reach, provider: ProviderReach): boolean {
  if (reach.all) return true;
  if (provider.allBranches) return reach.branchIds.length > 0;
  return provider.branchIds.some((id) => reach.branchIds.includes(id));
}

/**
 * هل مقدّم الخدمة بيشتغل في الفرع ده (عضوية "كل الفروع" أو الفرع في فروعه)؟
 *
 * @param provider فروع مقدّم الخدمة
 * @param branchId الفرع
 * @returns `true` لو بيشتغل فيه
 */
export function providerWorksIn(provider: ProviderReach, branchId: string): boolean {
  return provider.allBranches || provider.branchIds.includes(branchId);
}
```

- [ ] **Step 4: Write `service-rules.ts`**

```ts
import type { ServiceStatus } from "@eyadex/contracts/services";
import { scrubAuditText } from "@eyadex/observability";

/** خدمة عيادة زي ما بتتخزن (D-12). */
export interface ServiceRecord {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly durationMinutes: number;
  readonly status: ServiceStatus;
}

/** اللي المستخدم بيكتبه في الخدمة. */
export type ServiceFields = Pick<ServiceRecord, "nameAr" | "nameEn" | "durationMinutes">;

/**
 * هل التعديل ما بيغيّرش حاجة؟ نفس الحقول = نفس الرد من غير صف سجل.
 *
 * @param before الخدمة قبل التعديل
 * @param input الحقول المطلوبة
 * @returns `true` لو الحقول التلاتة زي ما هي
 */
export function isServiceUnchanged(before: ServiceRecord, input: ServiceFields): boolean {
  return (
    before.nameAr === input.nameAr &&
    before.nameEn === input.nameEn &&
    before.durationMinutes === input.durationMinutes
  );
}

/**
 * لقطة السجل: الحقول المسموحة بس، والأسماء بعد التنضيف (رقم مكتوب في اسم ما يوصلش للسجل).
 *
 * @param service الخدمة
 * @returns اللقطة
 */
export function serviceAuditSnapshot(service: ServiceRecord) {
  return {
    nameAr: scrubAuditText(service.nameAr),
    nameEn: scrubAuditText(service.nameEn),
    durationMinutes: service.durationMinutes,
    status: service.status,
  };
}
```

- [ ] **Step 5: Write `schedule-rules.ts`**

```ts
import {
  findShiftOverlap,
  minutesToWall,
  wallMinutes,
  type Shift,
} from "@eyadex/contracts/schedules";
import { scrubAuditText } from "@eyadex/observability";

/** صف أسبوعي متخزّن، بوقت الساعة في العيادة `HH:MM`. */
export interface ScheduleRow {
  readonly id: string;
  readonly branchId: string;
  readonly weekday: number;
  readonly startsAt: string;
  readonly endsAt: string;
}

type WallShift = Pick<Shift, "weekday" | "startsAt" | "endsAt">;

/** نتيجة حفظ أسبوع فرع. */
export type ScheduleDecision =
  | { readonly kind: "same" }
  | { readonly kind: "overlap" }
  | { readonly kind: "replace"; readonly shifts: readonly WallShift[] };

/**
 * وقت PostgreSQL كنص (`08:30:00`، `24:00:00`) بشكل العقد `HH:MM`.
 *
 * @param value النص من الداتابيز
 * @returns `HH:MM`
 */
export function wallFromDb(value: string): string {
  return minutesToWall(wallMinutes(value));
}

/**
 * الصف كنص قصير للسجل والمقارنة: `"<يوم> <بداية>-<نهاية>"`.
 *
 * @param shift الصف
 * @returns النص
 */
export function shiftLabel(shift: WallShift): string {
  return `${shift.weekday} ${shift.startsAt}-${shift.endsAt}`;
}

const sorted = (shifts: readonly WallShift[]) =>
  [...shifts].sort(
    (a, b) => a.weekday - b.weekday || wallMinutes(a.startsAt) - wallMinutes(b.startsAt),
  );

/**
 * يقرر حفظ أسبوع مقدّم خدمة في فرع (D-6، D-13): نفس الصفوف = مفيش تغيير؛ أي تداخل مع صفوفه في أي فرع
 * تاني أو بين الصفوف المطلوبة نفسها = رفض؛ غير كده الصفوف الجديدة بتحل محل صفوف الفرع ده. الصفوف
 * المتلاصقة مش تداخل، حتى عبر نص الليل (D-14).
 *
 * @param current كل صفوف مقدّم الخدمة في كل الفروع، مقروءة تحت قفله
 * @param branchId الفرع اللي بيتحفظ
 * @param wanted الأسبوع المطلوب في الفرع ده
 * @returns القرار
 */
export function decideBranchSchedule(
  current: readonly ScheduleRow[],
  branchId: string,
  wanted: readonly WallShift[],
): ScheduleDecision {
  const mine = sorted(current.filter((r) => r.branchId === branchId)).map(shiftLabel);
  const next = sorted(wanted);
  if (mine.length === next.length && next.every((s, i) => shiftLabel(s) === mine[i])) {
    return { kind: "same" };
  }
  const others = current.filter((r) => r.branchId !== branchId);
  if (findShiftOverlap([...others, ...next]) !== null) return { kind: "overlap" };
  return { kind: "replace", shifts: next };
}

/**
 * لقطة سجل أسبوع فرع: اسم مقدّم الخدمة بعد التنضيف، الفرع، والصفوف كنص.
 *
 * @param providerName اسم العضو
 * @param branchId الفرع
 * @param shifts الصفوف
 * @returns اللقطة
 */
export function scheduleAuditSnapshot(
  providerName: string,
  branchId: string,
  shifts: readonly WallShift[],
) {
  return {
    providerName: scrubAuditText(providerName),
    branchId,
    shifts: sorted(shifts).map(shiftLabel),
  };
}
```

- [ ] **Step 6: Write `time-off-rules.ts`**

```ts
import { scrubAuditText } from "@eyadex/observability";

/** إجازة متخزّنة (D-6). `cancelledAt` = اتلغت (مفيش حذف نهائي). */
export interface TimeOffRecord {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly note: string | null;
  readonly cancelledAt: Date | null;
}

/**
 * الملاحظة بعد العقد (اتشالت منها الرموز المخفية واتقصّت): فاضية = مفيش ملاحظة.
 *
 * @param note الملاحظة من الطلب
 * @returns الملاحظة، أو `null`
 */
export function normalizeNote(note: string | null): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * إلغاء إجازة: الملغية قبل كده = نفس الرد من غير صف سجل.
 *
 * @param record الإجازة
 * @returns `same` أو `cancel`
 */
export function decideTimeOffCancel(record: TimeOffRecord): "same" | "cancel" {
  return record.cancelledAt === null ? "cancel" : "same";
}

/**
 * لقطة السجل: المدة وحالة الإلغاء بس. الملاحظة نص حر عن غياب شخص، فعمرها ما بتتسجل (ADR-0026 §7).
 *
 * @param providerName اسم العضو
 * @param record الإجازة
 * @returns اللقطة
 */
export function timeOffAuditSnapshot(providerName: string, record: TimeOffRecord) {
  return {
    providerName: scrubAuditText(providerName),
    startsAt: record.startsAt.toISOString(),
    endsAt: record.endsAt.toISOString(),
    cancelled: record.cancelledAt !== null,
  };
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @eyadex/api exec vitest run src/modules/appointments/domain && pnpm --filter @eyadex/api typecheck && pnpm --filter @eyadex/api lint`
Expected: PASS (the Task 3 specs included); typecheck and lint exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/appointments/domain
git commit -m "feat(api): appointments domain rules for reach, services, weekly schedules and time off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: API — the booking profile on the membership (D-1, D-15) + the provider lock + identity's `PgProviderDirectory`

**Files:**

- Create: `apps/api/src/shared/provider-lock.ts`, `apps/api/src/modules/identity/persistence/pg-booking-profile-store.ts`, `apps/api/src/modules/identity/persistence/pg-provider-directory.ts`, `apps/api/src/modules/identity/use-cases/booking-profile/booking-profile-changes.ts`, `apps/api/src/modules/identity/http/booking-profile.controller.ts`
- Modify: `apps/api/src/modules/identity/clinic-access.module.ts` (controllers list + one provider), `apps/api/src/modules/identity/index.ts` (one export line)
- Test: `apps/api/src/modules/appointments/__tests__/scheduling-fixtures.ts` (create), `apps/api/src/modules/appointments/__tests__/booking-profile.db.spec.ts` (create)

**Interfaces:**

- Consumes: `bookingProfileInputSchema`, `BookingProfile`, `BookingProfileInput` (Task 3); `assertActorMay` (`identity/use-cases/role-changes/grant-bound.ts`), `assertMayTouchAdmin`, `UserActor` (`identity/use-cases/user-changes/user-changes.ts`), `findMemberForUpdate`, `lockClinicUsers` (`pg-user-store.ts`), `lockClinicRoles` (`pg-role-store.ts`), `findUserView` (`queries/user-views.ts`), `actorOf`, `idOf` (`http/users.controller.ts`), `writeClinicAudit` (`shared/clinic-audit.ts`).
- Produces:
  - `lockProvider(tx: Tx, clinicId: string, membershipId: string): Promise<void>` — `pg_advisory_xact_lock(hashtextextended('appointments:<clinicId>:<membershipId>', 0))`.
  - `GET /v1/users/:id/booking-profile` (`view:users:clinic`, module `appointments`) → `BookingProfile`; `PUT /v1/users/:id/booking-profile` (`update:users:clinic`, module `appointments`) body `BookingProfileInput` → `BookingProfile`; audit action `user.booking_changed`, entity `user`.
  - `class PgProviderDirectory { find(tx, clinicId, membershipId): Promise<ProviderRow | null>; listBookable(tx, clinicId): Promise<readonly ProviderRow[]> }` with `ProviderRow = { membershipId; fullName; active; acceptsAppointments; defaultDurationMinutes; allBranches; branchIds }`, exported from `identity/index.ts`.
  - Test fixtures (`scheduling-fixtures.ts`): `setAppointmentsModule(h, invalidate, clinicId, enabled)`, `membershipIdOf(h, userId)`, `send(h, cookie, method, url, body?, key?)`, `code(res)`, `schedulingClinic(h, invalidate)` → `{ clinicId, admin: Member & { memberId }, doctor: Member & { memberId, branchId }, desk, noKeys, branchD, branchR, branchX }`.

- [ ] **Step 1: Write the test fixtures**

Create `apps/api/src/modules/appointments/__tests__/scheduling-fixtures.ts`:

```ts
import { randomUUID } from "node:crypto";

import { APP, call, type Harness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import type { AuthorizationInvalidator } from "../../identity/index.ts";
import { addBranch } from "../../patients/__tests__/patient-fixtures.ts";

type Method = "GET" | "POST" | "PUT";

/** One request on the clinic host as `cookie`; an Idempotency-Key when given. */
export const send = (
  h: Harness,
  cookie: string,
  method: Method,
  url: string,
  body?: unknown,
  key?: string,
) =>
  call(h, {
    method,
    url,
    host: APP,
    cookie,
    ...(body === undefined ? {} : { body }),
    ...(key === undefined ? {} : { headers: { "idempotency-key": key } }),
  });

export const code = (res: { json: () => unknown }) => (res.json() as { code?: string }).code;

/** The platform's flag for this clinic (upserted: clinics made before 0042 have no row), then the cache. */
export async function setAppointmentsModule(
  h: Harness,
  invalidate: AuthorizationInvalidator,
  clinicId: string,
  enabled: boolean,
): Promise<void> {
  await h.owner`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
                VALUES (${clinicId}, ${randomUUID()}, 'appointments', ${enabled}, now())
                ON CONFLICT (clinic_id, module) DO UPDATE SET enabled = ${enabled}, updated_at = now()`;
  await invalidate.clinicChanged(clinicId);
}

export async function membershipIdOf(h: Harness, userId: string): Promise<string> {
  const [row] = await h.owner`SELECT id FROM memberships WHERE user_id = ${userId}`;
  return row!["id"] as string;
}

export const auditOf = (h: Harness, clinicId: string, entityId: string) =>
  h.owner`SELECT action, entity_type, category, details, details::text AS raw FROM audit_log
          WHERE clinic_id = ${clinicId} AND entity_id = ${entityId} ORDER BY created_at, id`;

/**
 * A clinic with the appointments module on: the admin (every clinic key, all branches), a doctor on
 * branch D, a front desk on branch R holding view/update:schedules:branch and view:services:clinic,
 * a member holding no module key, and branch X that only the admin reaches.
 */
export async function schedulingClinic(h: Harness, invalidate: AuthorizationInvalidator) {
  const base = await clinicWithMembers(h);
  const clinicId = base.admin.clinicId;
  await setAppointmentsModule(h, invalidate, clinicId, true);
  const branchR = await addBranch(h, clinicId);
  const branchX = await addBranch(h, clinicId);
  const deskRole = await customRole(h, clinicId, [
    "view:schedules:branch",
    "update:schedules:branch",
    "view:services:clinic",
  ]);
  const desk = await memberOn(h, base.admin, deskRole, {
    allBranches: false,
    branchIds: [branchR],
  });
  const noKeys = await memberOn(
    h,
    base.admin,
    await customRole(h, clinicId, ["view:branches:clinic"]),
  );
  return {
    clinicId,
    admin: { ...base.admin, memberId: await membershipIdOf(h, base.admin.userId) },
    doctor: { ...base.doctor, memberId: await membershipIdOf(h, base.doctor.userId) },
    desk,
    noKeys,
    branchD: base.doctor.branchId,
    branchR,
    branchX,
  };
}
```

- [ ] **Step 2: Write the failing route tests**

Create `apps/api/src/modules/appointments/__tests__/booking-profile.db.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  auditOf,
  code,
  schedulingClinic,
  send,
  setAppointmentsModule,
} from "./scheduling-fixtures.ts";

// D-1, D-15 (ADR-0026 §5): "accepts appointments" + default duration on the user editor.
let h: Harness;
let invalidate: AuthorizationInvalidator;
let C: Awaited<ReturnType<typeof schedulingClinic>>;
let other: Awaited<ReturnType<typeof schedulingClinic>>;
const url = (memberId: string) => `/v1/users/${memberId}/booking-profile`;

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await schedulingClinic(h, invalidate);
  other = await schedulingClinic(h, invalidate);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("booking profile", () => {
  it("starts not bookable, 20 minutes (D-15)", async () => {
    const res = await send(h, C.admin.cookie, "GET", url(C.doctor.memberId));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      memberId: C.doctor.memberId,
      acceptsAppointments: false,
      defaultDurationMinutes: 20,
    });
  });

  it("the admin turns it on with one audit row; the same values again write nothing", async () => {
    const body = { acceptsAppointments: true, defaultDurationMinutes: 30 };
    const first = await send(h, C.admin.cookie, "PUT", url(C.doctor.memberId), body);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ memberId: C.doctor.memberId, ...body });
    expect((await send(h, C.admin.cookie, "PUT", url(C.doctor.memberId), body)).statusCode).toBe(
      200,
    );
    const rows = (await auditOf(h, C.clinicId, C.doctor.memberId)).filter(
      (r) => r["action"] === "user.booking_changed",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!["category"]).toBe("administrative");
    expect(rows[0]!["details"]).toMatchObject({
      before: { acceptsAppointments: false, defaultDurationMinutes: 20 },
      after: { acceptsAppointments: true, defaultDurationMinutes: 30 },
    });
  });

  it("refuses a duration outside 5–480 minutes (D-15)", async () => {
    for (const minutes of [4, 481, 12.5]) {
      const body = { acceptsAppointments: true, defaultDurationMinutes: minutes };
      const res = await send(h, C.admin.cookie, "PUT", url(C.doctor.memberId), body);
      expect(res.statusCode).toBe(400);
      expect(code(res)).toBe("validation");
    }
  });

  it("NEGATIVE: needs the users keys, never a role name", async () => {
    expect(code(await send(h, C.desk.cookie, "GET", url(C.doctor.memberId)))).toBe("forbidden");
    const body = { acceptsAppointments: true, defaultDurationMinutes: 20 };
    expect(code(await send(h, C.desk.cookie, "PUT", url(C.doctor.memberId), body))).toBe(
      "forbidden",
    );
  });

  it("NEGATIVE: another clinic's member and a malformed id are not found", async () => {
    expect((await send(h, C.admin.cookie, "GET", url(other.doctor.memberId))).statusCode).toBe(404);
    expect((await send(h, C.admin.cookie, "GET", url("not-a-uuid"))).statusCode).toBe(404);
  });

  it("NEGATIVE: the module switched off answers module_disabled on both routes", async () => {
    await setAppointmentsModule(h, invalidate, C.clinicId, false);
    try {
      expect(code(await send(h, C.admin.cookie, "GET", url(C.doctor.memberId)))).toBe(
        "module_disabled",
      );
      const body = { acceptsAppointments: false, defaultDurationMinutes: 20 };
      const put = await send(h, C.admin.cookie, "PUT", url(C.doctor.memberId), body);
      expect(put.statusCode).toBe(403);
      expect(code(put)).toBe("module_disabled");
    } finally {
      await setAppointmentsModule(h, invalidate, C.clinicId, true);
    }
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run (with the `test:db` env exported): `pnpm --filter @eyadex/api test:db -- src/modules/appointments/__tests__/booking-profile.db.spec.ts`
Expected: FAIL — `expected 404 to be 200` (no route yet).

- [ ] **Step 4: Write `apps/api/src/shared/provider-lock.ts`**

```ts
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * D-13 (ADR-0026 §3): one provider's booking profile, weekly schedule and time off — and from slice A2
 * on, its appointments — change one transaction at a time. A path that also needs the clinic's
 * `roles:` / `users:` locks takes them first.
 *
 * @param tx the transaction inside `withTenant(clinicId)`
 * @param clinicId the clinic
 * @param membershipId the provider's membership
 * @returns resolves once the lock is held (until the transaction ends)
 */
export async function lockProvider(tx: Tx, clinicId: string, membershipId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`appointments:${clinicId}:${membershipId}`}, 0))`,
  );
}
```

- [ ] **Step 5: Write `pg-booking-profile-store.ts`**

```ts
import type { BookingProfile, BookingProfileInput } from "@eyadex/contracts/services";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// SQL of the booking profile (0042's two membership columns). Runs inside the caller's withTenant.

/** The member's booking profile; `null` = no such member in this clinic. */
export async function readBookingProfile(
  tx: Tx,
  clinicId: string,
  memberId: string,
): Promise<BookingProfile | null> {
  const rows = await tx.execute<{
    id: string;
    accepts_appointments: boolean;
    default_duration_minutes: number;
  }>(
    sql`SELECT id, accepts_appointments, default_duration_minutes FROM memberships
        WHERE clinic_id = ${clinicId} AND id = ${memberId}`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    memberId: row.id,
    acceptsAppointments: row.accepts_appointments,
    defaultDurationMinutes: Number(row.default_duration_minutes),
  };
}

export async function saveBookingProfile(
  tx: Tx,
  clinicId: string,
  memberId: string,
  input: BookingProfileInput,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE memberships SET accepts_appointments = ${input.acceptsAppointments},
          default_duration_minutes = ${input.defaultDurationMinutes},
          updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${memberId}`,
  );
}
```

- [ ] **Step 6: Write `pg-provider-directory.ts`**

```ts
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** A member as the appointments module reads it (its `ProviderDirectory` port, ADR-0026 §2). */
export interface ProviderRow {
  readonly membershipId: string;
  readonly fullName: string;
  readonly active: boolean;
  readonly acceptsAppointments: boolean;
  readonly defaultDurationMinutes: number;
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
}

interface Raw {
  id: string;
  full_name: string;
  status: "active" | "deactivated";
  accepts_appointments: boolean;
  default_duration_minutes: number;
  all_branches: boolean;
  branch_ids: string[] | null;
}

const SELECT = sql`SELECT m.id, m.full_name, m.status, m.accepts_appointments,
    m.default_duration_minutes, m.all_branches,
    (SELECT jsonb_agg(mb.branch_id ORDER BY mb.branch_id) FROM membership_branches mb
      WHERE mb.clinic_id = m.clinic_id AND mb.membership_id = m.id) AS branch_ids
  FROM memberships m`;

const toRow = (row: Raw): ProviderRow => ({
  membershipId: row.id,
  fullName: row.full_name,
  active: row.status === "active",
  acceptsAppointments: row.accepts_appointments,
  defaultDurationMinutes: Number(row.default_duration_minutes),
  allBranches: row.all_branches,
  branchIds: row.branch_ids ?? [],
});

/**
 * identity's adapter for the appointments module's `ProviderDirectory` port: reads memberships inside
 * the appointments transaction, so the module never names identity's tables (apps/api/AGENTS.md).
 */
export class PgProviderDirectory {
  async find(tx: Tx, clinicId: string, membershipId: string): Promise<ProviderRow | null> {
    const rows = await tx.execute<Raw>(
      sql`${SELECT} WHERE m.clinic_id = ${clinicId} AND m.id = ${membershipId}`,
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async listBookable(tx: Tx, clinicId: string): Promise<readonly ProviderRow[]> {
    const rows = await tx.execute<Raw>(
      sql`${SELECT} WHERE m.clinic_id = ${clinicId} AND m.status = 'active'
            AND m.accepts_appointments ORDER BY m.full_name, m.id`,
    );
    return rows.map(toRow);
  }
}
```

- [ ] **Step 7: Write the use case `booking-profile-changes.ts`**

```ts
import type { BookingProfile, BookingProfileInput } from "@eyadex/contracts/services";
import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { scrubAuditText } from "@eyadex/observability";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { lockProvider } from "../../../../shared/provider-lock.ts";
import type { Clock } from "../../../tenancy/index.ts";
import {
  readBookingProfile,
  saveBookingProfile,
} from "../../persistence/pg-booking-profile-store.ts";
import { lockClinicRoles } from "../../persistence/pg-role-store.ts";
import { findMemberForUpdate, lockClinicUsers } from "../../persistence/pg-user-store.ts";
import { findUserView } from "../../queries/user-views.ts";
import { assertActorMay } from "../role-changes/grant-bound.ts";
import { assertMayTouchAdmin, type UserActor } from "../user-changes/user-changes.ts";

export interface BookingProfileDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * إعدادات الحجز لعضو (D-1، D-15، ADR-0026 §5): بيستقبل مواعيد ولا لأ، ومدته الافتراضية. التغيير transaction
 * واحدة تحت أقفال الأدوار ثم المستخدمين (نفس ترتيب ADR-0012) ثم قفل مقدّم الخدمة (D-13)، فيها صف سجل واحد.
 * القرار من الصلاحيات بس، عمره ما بيبص على اسم الدور.
 */
export class BookingProfileChanges {
  constructor(private readonly deps: BookingProfileDeps) {}

  /**
   * إعدادات عضو.
   *
   * @param actor الفاعل
   * @param memberId العضوية
   * @returns الإعدادات؛ عضو مش في العيادة دي → `not_found`
   */
  read(actor: UserActor, memberId: string): Promise<BookingProfile> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const profile = await readBookingProfile(tx, actor.clinicId, memberId);
      if (profile === null) throw new ApiError("not_found");
      return profile;
    });
  }

  /**
   * يغيّر الإعدادات؛ نفس القيم = نفس الرد من غير صف سجل.
   *
   * @param actor الفاعل
   * @param memberId العضوية
   * @param input القيم بعد `bookingProfileInputSchema`
   * @returns الإعدادات بعد التغيير
   */
  update(actor: UserActor, memberId: string, input: BookingProfileInput): Promise<BookingProfile> {
    const { db, clock, ids } = this.deps;
    const { clinicId } = actor;
    return db.withTenant(clinicId, async (tx) => {
      await lockClinicRoles(tx, clinicId);
      await lockClinicUsers(tx, clinicId);
      // The route's own key, on the actor as it is after the locks (`@Require` ran before them).
      await assertActorMay(tx, actor, "update:users:clinic");
      const member = await findMemberForUpdate(tx, clinicId, memberId);
      if (member === null) throw new ApiError("not_found");
      await assertMayTouchAdmin(tx, actor, [member.roleSystemKey]);
      await lockProvider(tx, clinicId, memberId);
      const before = await readBookingProfile(tx, clinicId, memberId);
      if (before === null) throw new ApiError("not_found");
      const same =
        before.acceptsAppointments === input.acceptsAppointments &&
        before.defaultDurationMinutes === input.defaultDurationMinutes;
      if (same) return before;
      const now = clock.now();
      await saveBookingProfile(tx, clinicId, memberId, input, now);
      const fullName = scrubAuditText((await findUserView(tx, clinicId, memberId))?.fullName ?? "");
      await writeClinicAudit(tx, {
        clinicId,
        id: ids.newId(),
        actorUserId: actor.userId,
        action: "user.booking_changed",
        entityType: "user",
        entityId: memberId,
        details: {
          before: {
            fullName,
            acceptsAppointments: before.acceptsAppointments,
            defaultDurationMinutes: before.defaultDurationMinutes,
          },
          after: { fullName, ...input },
        },
        createdAt: now,
      });
      return { memberId, ...input };
    });
  }
}
```

- [ ] **Step 8: Write the controller `booking-profile.controller.ts`**

```ts
import { Body, Controller, Get, Inject, Param, Put, Req } from "@nestjs/common";
import {
  bookingProfileInputSchema,
  type BookingProfile,
  type BookingProfileInput,
} from "@eyadex/contracts/services";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { Require, RequiresFeature } from "../access/access-rules.ts";
import type { ClinicRequest } from "../access/access.guard.ts";
import type { BookingProfileChanges } from "../use-cases/booking-profile/booking-profile-changes.ts";
import { actorOf, idOf } from "./users.controller.ts";

export const BOOKING_PROFILE_CHANGES = Symbol("identity.BookingProfileChanges");

// D-1, D-15 (ADR-0026 §5): the user editor's booking settings. The membership is identity's, so the route
// is too; the settings belong to the appointments module, so its flag gates them (rule 10).
@Controller("users")
export class BookingProfileController {
  constructor(@Inject(BOOKING_PROFILE_CHANGES) private readonly changes: BookingProfileChanges) {}

  @Get(":id/booking-profile")
  @Require("view:users:clinic")
  @RequiresFeature("appointments")
  read(@Req() request: ClinicRequest, @Param("id") id: string): Promise<BookingProfile> {
    return this.changes.read(actorOf(request), idOf(id));
  }

  @Put(":id/booking-profile")
  @Require("update:users:clinic")
  @RequiresFeature("appointments")
  update(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(bookingProfileInputSchema)) body: BookingProfileInput,
  ): Promise<BookingProfile> {
    return this.changes.update(actorOf(request), idOf(id), body);
  }
}
```

- [ ] **Step 9: Wire it**

`clinic-access.module.ts` — add the imports

```ts
import {
  BOOKING_PROFILE_CHANGES,
  BookingProfileController,
} from "./http/booking-profile.controller.ts";
import { BookingProfileChanges } from "./use-cases/booking-profile/booking-profile-changes.ts";
```

add `BookingProfileController,` to `controllers` after `UsersController,`, add to the doc comment `، و /v1/users/:id/booking-profile (ADR-0026)`, and add to `providers` after the `USER_CHANGES` provider:

```ts
    {
      provide: BOOKING_PROFILE_CHANGES,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new BookingProfileChanges({ db, clock, ids: systemUuidV7() }),
    },
```

`identity/index.ts` — append:

```ts
export { PgProviderDirectory, type ProviderRow } from "./persistence/pg-provider-directory.ts";
```

- [ ] **Step 10: Run the tests**

Run: `pnpm --filter @eyadex/api test:db -- src/modules/appointments/__tests__/booking-profile.db.spec.ts src/modules/identity && pnpm --filter @eyadex/api exec vitest run src/shared && pnpm --filter @eyadex/api typecheck`
Expected: PASS (the route-access check counts the new routes; each has exactly one access declaration); typecheck exits 0.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/shared/provider-lock.ts apps/api/src/modules/identity apps/api/src/modules/appointments/__tests__/scheduling-fixtures.ts apps/api/src/modules/appointments/__tests__/booking-profile.db.spec.ts
git commit -m "feat(api): booking profile on the user editor, behind the appointments module (D-1, D-15)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: API — the appointments module and its services list (D-12)

**Files:**

- Create: `apps/api/src/modules/appointments/ports/provider-directory.ts`, `ports/scheduling-branch-reader.ts`, `ports/tokens.ts`, `persistence/pg-service-store.ts`, `queries/service-list.ts`, `use-cases/service-changes/service-changes.ts`, `http/services.controller.ts`, `appointments.module.ts`, `index.ts`
- Modify: `apps/api/src/app.ts:36-39` (import) and `:133` (mount), `apps/api/src/shared/__tests__/module-boundaries.spec.ts`
- Test: `apps/api/src/modules/appointments/__tests__/services.db.spec.ts`

**Interfaces:**

- Consumes: `serviceInputSchema`, `serviceListHttpQuerySchema`, `ClinicService`, `ServiceListResponse`, `ServiceStatus` (Task 3); `ServiceRecord`, `isServiceUnchanged`, `serviceAuditSnapshot` (Task 9); `claimClinicIdempotencyKey`, `completeClinicIdempotencyKey`, `requestHash`, `writeClinicAudit`; `PgProviderDirectory` (Task 10), `PgFilingBranches`, `CLOCK`, `TenancyModule` (tenancy index).
- Produces:
  - Ports: `ProviderRecord`, `ProviderDirectory { find; listBookable }`, `SchedulingBranch`, `SchedulingBranchReader { lockForFiling; listForOptions }`; tokens `SERVICE_CHANGES`, `SCHEDULE_CHANGES`, `PROVIDER_DIRECTORY`, `SCHEDULING_BRANCH_READER`.
  - Routes: `GET /v1/services` (`view:services:clinic`), `POST /v1/services` (`create:services:clinic`, `Idempotency-Key` required, 201), `PUT /v1/services/:id` (`update:services:clinic`), `POST /v1/services/:id/deactivate` and `/reactivate` (`deactivate:services:clinic`, 200); all `@RequiresFeature("appointments")`; answers `ClinicService` / `ServiceListResponse`.
  - `class ServiceChanges { create(actor: ServiceActor, input: ServiceFields, key: string): Promise<ClinicService>; update(actor, id, input): Promise<ClinicService>; setStatus(actor, id, status: ServiceStatus): Promise<ClinicService> }`, `interface ServiceActor { clinicId; userId }`.
  - `AppointmentsModule` (exported from `modules/appointments/index.ts`), mounted with the clinic modules.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/appointments/__tests__/services.db.spec.ts`:

```ts
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  auditOf,
  code,
  schedulingClinic,
  send,
  setAppointmentsModule,
} from "./scheduling-fixtures.ts";

// D-12: one clinic-level services list (ADR-0026 §1). Every write audited, names unique like roles.
let h: Harness;
let invalidate: AuthorizationInvalidator;
let C: Awaited<ReturnType<typeof schedulingClinic>>;
let other: Awaited<ReturnType<typeof schedulingClinic>>;
const tag = () => randomUUID().slice(0, 6);
const svc = (minutes = 30, name = tag()) => ({
  nameAr: `خدمة ${name}`,
  nameEn: `Service ${name}`,
  durationMinutes: minutes,
});
const create = (cookie: string, body: unknown, key: string | undefined = randomUUID()) =>
  send(h, cookie, "POST", "/v1/services", body, key);

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await schedulingClinic(h, invalidate);
  other = await schedulingClinic(h, invalidate);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("creating a service", () => {
  it("201 with the service, one audit row; a replay returns it, a changed body conflicts", async () => {
    const key = randomUUID();
    const body = svc();
    const first = await create(C.admin.cookie, body, key);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ ...body, status: "active" });
    const again = await create(C.admin.cookie, body, key);
    expect(again.json()).toEqual(first.json());
    expect(code(await create(C.admin.cookie, svc(), key))).toBe("idempotency_conflict");
    const rows = await auditOf(h, C.clinicId, first.json().id);
    expect(rows.map((r) => [r["action"], r["entity_type"], r["category"]])).toEqual([
      ["service.created", "clinic_service", "administrative"],
    ]);
  });

  it("needs an Idempotency-Key (400)", async () => {
    const res = await send(h, C.admin.cookie, "POST", "/v1/services", svc());
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe("validation");
  });

  it("refuses 4 and 481 minutes (D-15)", async () => {
    expect(code(await create(C.admin.cookie, svc(4)))).toBe("validation");
    expect(code(await create(C.admin.cookie, svc(481)))).toBe("validation");
  });

  it("names are unique per language ignoring case and spaces, inactive services included", async () => {
    const body = svc();
    const made = (await create(C.admin.cookie, body)).json();
    const dup = { ...svc(), nameEn: ` ${body.nameEn.toUpperCase()} ` };
    const res = await create(C.admin.cookie, dup);
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("service_name_taken");
    await send(h, C.admin.cookie, "POST", `/v1/services/${made.id}/deactivate`);
    expect(code(await create(C.admin.cookie, { ...svc(), nameAr: body.nameAr }))).toBe(
      "service_name_taken",
    );
  });
});

describe("changing a service", () => {
  it("update, deactivate, reactivate: one row each; a no-op writes nothing", async () => {
    const made = (await create(C.admin.cookie, svc())).json();
    const path = `/v1/services/${made.id}`;
    const changed = { nameAr: made.nameAr, nameEn: made.nameEn, durationMinutes: 45 };
    expect((await send(h, C.admin.cookie, "PUT", path, changed)).json().durationMinutes).toBe(45);
    expect((await send(h, C.admin.cookie, "PUT", path, changed)).statusCode).toBe(200);
    expect((await send(h, C.admin.cookie, "POST", `${path}/deactivate`)).json().status).toBe(
      "inactive",
    );
    expect((await send(h, C.admin.cookie, "POST", `${path}/deactivate`)).statusCode).toBe(200);
    expect((await send(h, C.admin.cookie, "POST", `${path}/reactivate`)).json().status).toBe(
      "active",
    );
    const actions = (await auditOf(h, C.clinicId, made.id)).map((r) => r["action"]);
    expect(actions).toEqual([
      "service.created",
      "service.updated",
      "service.deactivated",
      "service.reactivated",
    ]);
  });

  it("NEGATIVE: another clinic's service is not found", async () => {
    const theirs = (await create(other.admin.cookie, svc())).json();
    const res = await send(h, C.admin.cookie, "PUT", `/v1/services/${theirs.id}`, svc());
    expect(res.statusCode).toBe(404);
  });
});

describe("reading and permissions", () => {
  it("lists with a status filter and a cursor", async () => {
    const page = await send(h, C.desk.cookie, "GET", "/v1/services?limit=2&status=active");
    expect(page.statusCode).toBe(200);
    const body = page.json();
    expect(body.items.length).toBeLessThanOrEqual(2);
    expect(body.items.every((s: { status: string }) => s.status === "active")).toBe(true);
    if (body.nextCursor !== null) {
      const next = await send(
        h,
        C.desk.cookie,
        "GET",
        `/v1/services?limit=2&cursor=${body.nextCursor}`,
      );
      expect(next.statusCode).toBe(200);
    }
  });

  it("NEGATIVE: view does not create; no key sees nothing", async () => {
    expect(code(await create(C.desk.cookie, svc()))).toBe("forbidden");
    expect(code(await send(h, C.noKeys.cookie, "GET", "/v1/services"))).toBe("forbidden");
  });

  it("NEGATIVE: the module switched off answers module_disabled", async () => {
    await setAppointmentsModule(h, invalidate, C.clinicId, false);
    try {
      expect(code(await send(h, C.admin.cookie, "GET", "/v1/services"))).toBe("module_disabled");
      expect(code(await create(C.admin.cookie, svc()))).toBe("module_disabled");
    } finally {
      await setAppointmentsModule(h, invalidate, C.clinicId, true);
    }
  });
});
```

In `module-boundaries.spec.ts`, after `auditSqlRelations` add:

```ts
// ADR-0026: the appointments module names only its own tables; members come through ProviderDirectory
// (identity) and branches through SchedulingBranchReader (tenancy).
const APPOINTMENTS_RELATIONS = ["clinic_services", "provider_schedules", "provider_time_off"];
const appointmentsSqlRelations = (): string[] =>
  sourceFiles(join(modulesDir, "appointments")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)/g)]
      .map(([, relation = ""]) => relation)
      .filter((relation) => !APPOINTMENTS_RELATIONS.includes(relation))
      .map((relation) => `${file.slice(modulesDir.length)}: ${relation}`),
  );
```

and inside `describe("module boundaries", …)`:

```ts
it("the appointments module's SQL names only its own tables; the rest comes through its ports", () => {
  expect(existsSync(join(modulesDir, "appointments", "appointments.module.ts"))).toBe(true);
  expect(appointmentsSqlRelations()).toEqual([]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @eyadex/api exec vitest run src/shared/__tests__/module-boundaries.spec.ts && pnpm --filter @eyadex/api test:db -- src/modules/appointments/__tests__/services.db.spec.ts`
Expected: FAIL — `expected false to be true` (no module file) and `expected 404 to be 201`.

- [ ] **Step 3: Ports and tokens**

`ports/provider-directory.ts`:

```ts
import type { Tx } from "@eyadex/db";

/** عضو العيادة زي ما موديول المواعيد بيشوفه (D-1). */
export interface ProviderRecord {
  readonly membershipId: string;
  readonly fullName: string;
  readonly active: boolean;
  readonly acceptsAppointments: boolean;
  readonly defaultDurationMinutes: number;
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
}

/**
 * اللي موديول المواعيد محتاجه من العضويات (ملك identity)، جوه الـ transaction بتاعته. الـ port ده بتاع
 * المواعيد، و identity بتنفّذه (`PgProviderDirectory`)، والربط في `appointments.module.ts` بس.
 */
export interface ProviderDirectory {
  /**
   * عضو واحد بأي حالة.
   *
   * @param tx transaction المواعيد جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param membershipId العضوية
   * @returns العضو، أو `null` لو مش عضو في العيادة دي
   */
  find(tx: Tx, clinicId: string, membershipId: string): Promise<ProviderRecord | null>;

  /**
   * الأعضاء القابلين للحجز (نشطين و"يستقبل مواعيد")، مرتبين بالاسم.
   *
   * @param tx transaction المواعيد جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @returns الأعضاء
   */
  listBookable(tx: Tx, clinicId: string): Promise<readonly ProviderRecord[]>;
}
```

`ports/scheduling-branch-reader.ts`:

```ts
import type { Tx } from "@eyadex/db";

/** فرع في جدول مقدّم خدمة. */
export interface SchedulingBranch {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly isActive: boolean;
}

/**
 * اللي موديول المواعيد محتاجه من جدول الفروع (ملك tenancy). tenancy بتنفّذه (`PgFilingBranches`، نفس
 * adapter المراجعين)، والربط في `appointments.module.ts`.
 */
export interface SchedulingBranchReader {
  /**
   * الفرع مقفول `FOR SHARE` لحد آخر الـ transaction، فتعطيله في نفس اللحظة بيستنى.
   *
   * @param tx transaction المواعيد جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param branchId الفرع
   * @returns هل الفرع نشط، أو `null` لو مش فرع في العيادة دي
   */
  lockForFiling(tx: Tx, clinicId: string, branchId: string): Promise<{ isActive: boolean } | null>;

  /**
   * كل فروع العيادة: النشطة الأول، وبعدين بالاسم في لغة المستخدم.
   *
   * @param tx transaction المواعيد جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param language لغة ترتيب الأسماء
   * @returns الفروع
   */
  listForOptions(
    tx: Tx,
    clinicId: string,
    language: "ar" | "en",
  ): Promise<readonly SchedulingBranch[]>;
}
```

`ports/tokens.ts`:

```ts
/** مفاتيح الحقن في موديول المواعيد. */
export const SERVICE_CHANGES = Symbol("appointments.ServiceChanges");
export const SCHEDULE_CHANGES = Symbol("appointments.ScheduleChanges");
export const PROVIDER_DIRECTORY = Symbol("appointments.ProviderDirectory");
export const SCHEDULING_BRANCH_READER = Symbol("appointments.SchedulingBranchReader");
```

- [ ] **Step 4: `persistence/pg-service-store.ts`**

```ts
import type { ClinicService, ServiceStatus } from "@eyadex/contracts/services";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { ServiceFields, ServiceRecord } from "../domain/service-rules.ts";

// SQL on clinic_services (0042). Every function runs inside the caller's withTenant(clinicId).

interface Row {
  id: string;
  name_ar: string;
  name_en: string;
  duration_minutes: number;
  status: ServiceStatus;
  created_at: Date | string;
}

export const SERVICE_COLUMNS = sql`id, name_ar, name_en, duration_minutes, status, created_at`;

export const toClinicService = (row: Row): ClinicService => ({
  id: row.id,
  nameAr: row.name_ar,
  nameEn: row.name_en,
  durationMinutes: Number(row.duration_minutes),
  status: row.status,
  createdAt: new Date(row.created_at).toISOString(),
});

/** Serialises the clinic's service writes, so the name check and the insert see the same list. */
export async function lockClinicServices(tx: Tx, clinicId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`services:${clinicId}`}, 0))`,
  );
}

export async function findService(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<ClinicService | null> {
  const rows = await tx.execute<Row>(
    sql`SELECT ${SERVICE_COLUMNS} FROM clinic_services WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
  return rows[0] === undefined ? null : toClinicService(rows[0]);
}

/** Another service (any status) already uses either name, compared as 0042's unique indexes do. */
export async function serviceNameTaken(
  tx: Tx,
  clinicId: string,
  input: ServiceFields,
  exceptId: string | null,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM clinic_services WHERE clinic_id = ${clinicId}
          AND (lower(btrim(name_ar)) = lower(btrim(${input.nameAr}))
               OR lower(btrim(name_en)) = lower(btrim(${input.nameEn})))
          AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
        LIMIT 1`,
  );
  return rows.length > 0;
}

export async function insertService(
  tx: Tx,
  clinicId: string,
  service: ServiceRecord,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO clinic_services (clinic_id, id, name_ar, name_en, duration_minutes, status,
          created_at, updated_at)
        VALUES (${clinicId}, ${service.id}, ${service.nameAr}, ${service.nameEn},
          ${service.durationMinutes}, ${service.status}, ${at}::timestamptz, ${at}::timestamptz)`,
  );
}

export async function saveService(
  tx: Tx,
  clinicId: string,
  service: ServiceRecord,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE clinic_services SET name_ar = ${service.nameAr}, name_en = ${service.nameEn},
          duration_minutes = ${service.durationMinutes}, status = ${service.status},
          updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${service.id}`,
  );
}
```

- [ ] **Step 5: `queries/service-list.ts`**

```ts
import { idSchema } from "@eyadex/contracts/common";
import type { ServiceListHttpQuery, ServiceListResponse } from "@eyadex/contracts/services";
import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import { SERVICE_COLUMNS, toClinicService } from "../persistence/pg-service-store.ts";

const encode = (id: string) => Buffer.from(id, "utf8").toString("base64url");

function decode(cursor: string | undefined): string | null {
  if (cursor === undefined) return null;
  const id = idSchema.safeParse(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!id.success) throw new ApiError("validation", [{ path: ["cursor"], code: "custom" }]);
  return id.data;
}

/**
 * خدمات العيادة بـ cursor على الـ id (UUID v7 = ترتيب الإنشاء)، بفلتر الحالة. الـ total في جملة لوحده.
 *
 * @param db الـ pool على `eyadex_app`
 * @param clinicId عيادة السياق
 * @param query الفلاتر والـ cursor
 * @returns الصفحة
 */
export async function listServices(
  db: Database,
  clinicId: string,
  query: ServiceListHttpQuery,
): Promise<ServiceListResponse> {
  const after = decode(query.cursor);
  const status = query.status ?? null;
  const filters = sql`clinic_id = ${clinicId} AND (${status}::text IS NULL OR status = ${status}::text)`;
  const { rows, total } = await db.withTenant(clinicId, async (tx) => ({
    rows: await tx.execute<Parameters<typeof toClinicService>[0]>(
      sql`SELECT ${SERVICE_COLUMNS} FROM clinic_services WHERE ${filters}
            AND (${after}::uuid IS NULL OR id > ${after}::uuid)
          ORDER BY id LIMIT ${query.limit + 1}`,
    ),
    total: await tx.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM clinic_services WHERE ${filters}`,
    ),
  }));
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toClinicService),
    nextCursor: rows.length > query.limit && last !== undefined ? encode(last.id) : null,
    total: Number(total[0]?.total ?? 0),
  };
}
```

- [ ] **Step 6: `use-cases/service-changes/service-changes.ts`**

```ts
import type { ClinicService, ServiceStatus } from "@eyadex/contracts/services";
import { DatabaseError, type Database, type Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import type { Clock } from "../../../tenancy/index.ts";
import {
  isServiceUnchanged,
  serviceAuditSnapshot,
  type ServiceFields,
  type ServiceRecord,
} from "../../domain/service-rules.ts";
import {
  findService,
  insertService,
  lockClinicServices,
  saveService,
  serviceNameTaken,
} from "../../persistence/pg-service-store.ts";

export interface ServiceChangesDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** الفاعل: عضو العيادة اللي الـ guard حلّه. */
export interface ServiceActor {
  readonly clinicId: string;
  readonly userId: string;
}

// The unique indexes back the check under the lock; if one still fires it is the same answer.
function nameTakenOnUnique(error: unknown): never {
  if (error instanceof DatabaseError && error.code === "23505")
    throw new ApiError("service_name_taken");
  throw error;
}

/**
 * قايمة خدمات العيادة (D-12، ADR-0026 §1): إنشاء بمفتاح `Idempotency-Key`، تعديل، تعطيل وإعادة تفعيل.
 * كل عملية transaction واحدة تحت قفل خدمات العيادة، فيها صف سجل إداري واحد. مفيش حذف.
 */
export class ServiceChanges {
  constructor(private readonly deps: ServiceChangesDeps) {}

  /**
   * خدمة جديدة نشطة. نفس المفتاح ونفس الجسم = نفس الخدمة؛ جسم مختلف = `idempotency_conflict`.
   *
   * @param actor الفاعل
   * @param input الأسماء والمدة بعد `serviceInputSchema`
   * @param idempotencyKey المفتاح
   * @returns الخدمة
   */
  create(
    actor: ServiceActor,
    input: ServiceFields,
    idempotencyKey: string,
  ): Promise<ClinicService> {
    const { db, clock, ids } = this.deps;
    const claim = {
      clinicId: actor.clinicId,
      scope: `service:create:${actor.userId}`,
      key: idempotencyKey,
      hash: requestHash(input),
    };
    return db
      .withTenant(actor.clinicId, async (tx) => {
        const claimed = await claimClinicIdempotencyKey<{ serviceId: string }>(
          tx,
          claim,
          ids.newId(),
          clock.now(),
        );
        if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
        if (claimed.kind === "replay") return this.reload(tx, actor, claimed.response.serviceId);
        await lockClinicServices(tx, actor.clinicId);
        if (await serviceNameTaken(tx, actor.clinicId, input, null)) {
          throw new ApiError("service_name_taken");
        }
        const service: ServiceRecord = { id: ids.newId(), ...input, status: "active" };
        await insertService(tx, actor.clinicId, service, clock.now());
        await this.audit(tx, actor, "service.created", null, service);
        await completeClinicIdempotencyKey(tx, claim, { serviceId: service.id });
        return this.reload(tx, actor, service.id);
      })
      .catch(nameTakenOnUnique);
  }

  /**
   * يعدّل الأسماء والمدة؛ نفس القيم = نفس الرد من غير صف سجل.
   *
   * @param actor الفاعل
   * @param id الخدمة
   * @param input الأسماء والمدة
   * @returns الخدمة بعد التعديل
   */
  update(actor: ServiceActor, id: string, input: ServiceFields): Promise<ClinicService> {
    return this.change(actor, id, async (tx, before) => {
      if (isServiceUnchanged(before, input)) return null;
      if (await serviceNameTaken(tx, actor.clinicId, input, id)) {
        throw new ApiError("service_name_taken");
      }
      return { next: { ...before, ...input }, action: "service.updated" };
    }).catch(nameTakenOnUnique);
  }

  /**
   * تعطيل أو إعادة تفعيل؛ نفس الحالة = نفس الرد من غير صف سجل.
   *
   * @param actor الفاعل
   * @param id الخدمة
   * @param status الحالة المطلوبة
   * @returns الخدمة بعد التغيير
   */
  setStatus(actor: ServiceActor, id: string, status: ServiceStatus): Promise<ClinicService> {
    return this.change(actor, id, async (_tx, before) => {
      if (before.status === status) return null;
      const action = status === "inactive" ? "service.deactivated" : "service.reactivated";
      return { next: { ...before, status }, action };
    });
  }

  private change(
    actor: ServiceActor,
    id: string,
    decide: (
      tx: Tx,
      before: ServiceRecord,
    ) => Promise<{ next: ServiceRecord; action: string } | null>,
  ): Promise<ClinicService> {
    const { db, clock } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockClinicServices(tx, actor.clinicId);
      const before = await findService(tx, actor.clinicId, id);
      if (before === null) throw new ApiError("not_found");
      const decided = await decide(tx, before);
      if (decided === null) return before;
      await saveService(tx, actor.clinicId, decided.next, clock.now());
      await this.audit(tx, actor, decided.action, before, decided.next);
      return this.reload(tx, actor, id);
    });
  }

  private async audit(
    tx: Tx,
    actor: ServiceActor,
    action: string,
    before: ServiceRecord | null,
    after: ServiceRecord,
  ): Promise<void> {
    await writeClinicAudit(tx, {
      clinicId: actor.clinicId,
      id: this.deps.ids.newId(),
      actorUserId: actor.userId,
      action,
      entityType: "clinic_service",
      entityId: after.id,
      details: {
        before: before === null ? null : serviceAuditSnapshot(before),
        after: serviceAuditSnapshot(after),
      },
      createdAt: this.deps.clock.now(),
    });
  }

  private async reload(tx: Tx, actor: ServiceActor, id: string): Promise<ClinicService> {
    const service = await findService(tx, actor.clinicId, id);
    if (service === null) throw new ApiError("not_found");
    return service;
  }
}
```

- [ ] **Step 7: `http/services.controller.ts`**

```ts
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { idSchema } from "@eyadex/contracts/common";
import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";
import {
  serviceInputSchema,
  serviceListHttpQuerySchema,
  type ClinicService,
  type ServiceInput,
  type ServiceListHttpQuery,
  type ServiceListResponse,
} from "@eyadex/contracts/services";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { SERVICE_CHANGES } from "../ports/tokens.ts";
import { listServices } from "../queries/service-list.ts";
import type { ServiceActor, ServiceChanges } from "../use-cases/service-changes/service-changes.ts";

// A malformed id is an unknown service: 404, the same answer as another clinic's id (ISO-02).
const idOf = (raw: string): string => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("not_found");
  return parsed.data;
};

const keyOf = (raw: string | undefined): string => {
  const key = idempotencyKeySchema.safeParse(raw);
  if (!key.success) {
    throw new ApiError("validation", [{ path: ["Idempotency-Key"], code: "required" }]);
  }
  return key.data;
};

const actorOf = (request: ClinicRequest): ServiceActor => ({
  clinicId: request.clinicContext.clinicId,
  userId: request.clinicContext.userId,
});

// D-12 (ADR-0026 §1). Thin: validate → call → map.
@Controller("services")
export class ServicesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SERVICE_CHANGES) private readonly changes: ServiceChanges,
  ) {}

  @Get()
  @Require("view:services:clinic")
  @RequiresFeature("appointments")
  list(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(serviceListHttpQuerySchema)) query: ServiceListHttpQuery,
  ): Promise<ServiceListResponse> {
    return listServices(this.db, request.clinicContext.clinicId, query);
  }

  @Post()
  @HttpCode(201)
  @Require("create:services:clinic")
  @RequiresFeature("appointments")
  create(
    @Req() request: ClinicRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(serviceInputSchema)) body: ServiceInput,
  ): Promise<ClinicService> {
    return this.changes.create(actorOf(request), body, keyOf(rawKey));
  }

  @Put(":id")
  @Require("update:services:clinic")
  @RequiresFeature("appointments")
  update(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(serviceInputSchema)) body: ServiceInput,
  ): Promise<ClinicService> {
    return this.changes.update(actorOf(request), idOf(id), body);
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  @Require("deactivate:services:clinic")
  @RequiresFeature("appointments")
  deactivate(@Req() request: ClinicRequest, @Param("id") id: string): Promise<ClinicService> {
    return this.changes.setStatus(actorOf(request), idOf(id), "inactive");
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  @Require("deactivate:services:clinic")
  @RequiresFeature("appointments")
  reactivate(@Req() request: ClinicRequest, @Param("id") id: string): Promise<ClinicService> {
    return this.changes.setStatus(actorOf(request), idOf(id), "active");
  }
}
```

- [ ] **Step 8: Module, index, mount**

`appointments.module.ts`:

```ts
import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
// A module.ts may bind an identity adapter to a port it owns (CLAUDE.architecture.md §2.2, ADR-0026).
import { PgProviderDirectory } from "../identity/index.ts";
import { CLOCK, PgFilingBranches, TenancyModule, type Clock } from "../tenancy/index.ts";
import { ServicesController } from "./http/services.controller.ts";
import type { ProviderDirectory } from "./ports/provider-directory.ts";
import type { SchedulingBranchReader } from "./ports/scheduling-branch-reader.ts";
import { PROVIDER_DIRECTORY, SCHEDULING_BRANCH_READER, SERVICE_CHANGES } from "./ports/tokens.ts";
import { ServiceChanges } from "./use-cases/service-changes/service-changes.ts";

// Typed against the module's own ports, so neither adapter can drift from what the module needs.
const providers: ProviderDirectory = new PgProviderDirectory();
const branches: SchedulingBranchReader = new PgFilingBranches();

/**
 * موديول المواعيد (ADR-0026): `/v1/services`، `/v1/schedules`. كل الشغل على pool الـ `eyadex_app` جوه
 * `withTenant`؛ مفيش أي مسار منصة. العضويات (identity) والفروع (tenancy) بتتقري من ports الموديول بس.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [ServicesController],
  providers: [
    { provide: PROVIDER_DIRECTORY, useValue: providers },
    { provide: SCHEDULING_BRANCH_READER, useValue: branches },
    {
      provide: SERVICE_CHANGES,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new ServiceChanges({ db, clock, ids: systemUuidV7() }),
    },
  ],
})
export class AppointmentsModule {}
```

`index.ts`:

```ts
// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { AppointmentsModule } from "./appointments.module.ts";
```

`app.ts` — add `import { AppointmentsModule } from "./modules/appointments/index.ts";` after the `PatientsModule` import, change line 133 to:

```ts
        ? [ClinicAccessModule, SettingsModule, RolesModule, PatientsModule, AppointmentsModule, ClinicAuditModule]
```

and add `/v1/services`, `/v1/schedules` and `ADR-0026` to the `mountClinic` doc comment.

- [ ] **Step 9: Run the tests**

Run: `pnpm exec prettier --write apps/api/src/modules/appointments apps/api/src/app.ts && pnpm --filter @eyadex/api exec vitest run src/shared && pnpm --filter @eyadex/api test:db -- src/modules/appointments && pnpm --filter @eyadex/api typecheck && pnpm --filter @eyadex/api lint`
Expected: PASS; typecheck and lint exit 0.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/appointments apps/api/src/app.ts apps/api/src/shared/__tests__/module-boundaries.spec.ts
git commit -m "feat(api): appointments module with the clinic services list (D-12)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: API — weekly schedules and time off (D-6, D-13, D-14)

**Files:**

- Create: `apps/api/src/modules/appointments/persistence/pg-schedule-store.ts`, `queries/provider-schedule.ts`, `use-cases/schedule-changes/schedule-changes.ts`, `http/schedules.controller.ts`
- Modify: `apps/api/src/modules/appointments/appointments.module.ts` (controller + provider)
- Test: `apps/api/src/modules/appointments/__tests__/schedules.db.spec.ts`

**Interfaces:**

- Consumes: `branchScheduleInputSchema`, `timeOffInputSchema`, `ProviderSchedule`, `ProviderSummary`, `ProviderListResponse`, `WallShift` (Task 3); `reachOf`, `reachCovers`, `providerWithin`, `providerWorksIn`, `Reach`, `decideBranchSchedule`, `scheduleAuditSnapshot`, `wallFromDb`, `ScheduleRow`, `normalizeNote`, `decideTimeOffCancel`, `timeOffAuditSnapshot`, `TimeOffRecord` (Task 9); `lockProvider` (Task 10); `ProviderDirectory`, `ProviderRecord`, `SchedulingBranchReader`, tokens (Task 11); `CLOCK`.
- Produces:
  - Routes (all `@RequiresFeature("appointments")`): `GET /v1/schedules/providers` (`view:schedules:branch`) → `ProviderListResponse`; `GET /v1/schedules/:membershipId` (`view:schedules:branch`) → `ProviderSchedule`; `PUT /v1/schedules/:membershipId/branches/:branchId` (`update:schedules:branch`, body `BranchScheduleInput`) → `ProviderSchedule`; `POST /v1/schedules/:membershipId/time-off` (`update:schedules:clinic`, 201, body `TimeOffInput`) → `ProviderSchedule`; `POST /v1/schedules/:membershipId/time-off/:timeOffId/cancel` (`update:schedules:clinic`, 200) → `ProviderSchedule`.
  - `interface ScheduleViewer { clinicId; reach: Reach; language: "ar" | "en" }`, `interface ScheduleActor extends ScheduleViewer { userId }`, `listProviders(db, providers, viewer)`, `readSchedule(db, providers, branches, viewer, membershipId, now)`, `readProviderSchedule(reads, viewer, membershipId, now)`.
  - `class ScheduleChanges { replaceBranch(actor, membershipId, branchId, shifts: readonly WallShift[]); addTimeOff(actor, membershipId, input: TimeOffInput); cancelTimeOff(actor, membershipId, timeOffId) }` — every method returns `Promise<ProviderSchedule>`. Audit: `schedule.replaced` (entity `provider_schedule`, id = membership), `time_off.added` / `time_off.cancelled` (entity `provider_time_off`, id = the time off).
  - Errors: unknown or out-of-reach provider `not_found`; not active or not accepting `provider_not_bookable`; unknown branch `not_found`; branch outside the action's reach `forbidden`; inactive branch `branch_inactive`; provider not working there `provider_not_in_branch`; overlap `schedule_overlap`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/appointments/__tests__/schedules.db.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  auditOf,
  code,
  schedulingClinic,
  send,
  setAppointmentsModule,
} from "./scheduling-fixtures.ts";

// D-6, D-13, D-14 and the branch scope of spec §3 (ADR-0026 §3–§4).
let h: Harness;
let invalidate: AuthorizationInvalidator;
let C: Awaited<ReturnType<typeof schedulingClinic>>;
let other: Awaited<ReturnType<typeof schedulingClinic>>;
const path = (memberId: string) => `/v1/schedules/${memberId}`;
const week = (...rows: [number, string, string][]) => ({
  shifts: rows.map(([weekday, startsAt, endsAt]) => ({ weekday, startsAt, endsAt })),
});
const put = (cookie: string, memberId: string, branchId: string, body: unknown) =>
  send(h, cookie, "PUT", `${path(memberId)}/branches/${branchId}`, body);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const bookable = (memberId: string) =>
  send(h, C.admin.cookie, "PUT", `/v1/users/${memberId}/booking-profile`, {
    acceptsAppointments: true,
    defaultDurationMinutes: 20,
  });

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await schedulingClinic(h, invalidate);
  other = await schedulingClinic(h, invalidate);
  await bookable(C.doctor.memberId);
  await bookable(C.admin.memberId);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("a provider's weekly schedule", () => {
  it("saves a branch week with one audit row; the same week again writes nothing", async () => {
    const body = week([0, "16:00", "20:00"], [0, "08:00", "12:00"]);
    const res = await put(C.admin.cookie, C.doctor.memberId, C.branchD, body);
    expect(res.statusCode).toBe(200);
    expect(res.json().shifts).toEqual([
      { branchId: C.branchD, weekday: 0, startsAt: "08:00", endsAt: "12:00" },
      { branchId: C.branchD, weekday: 0, startsAt: "16:00", endsAt: "20:00" },
    ]);
    expect((await put(C.admin.cookie, C.doctor.memberId, C.branchD, body)).statusCode).toBe(200);
    const rows = (await auditOf(h, C.clinicId, C.doctor.memberId)).filter(
      (r) => r["action"] === "schedule.replaced",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!["details"].after.shifts).toEqual(["0 08:00-12:00", "0 16:00-20:00"]);
  });

  it("D-14: back-to-back rows across midnight are accepted, 24:00 included", async () => {
    const res = await put(
      C.admin.cookie,
      C.doctor.memberId,
      C.branchD,
      week([0, "20:00", "24:00"], [1, "00:00", "01:00"]),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().shifts.map((s: { endsAt: string }) => s.endsAt)).toEqual(["24:00", "01:00"]);
  });

  it("refuses overlapping rows, also against the provider's rows in another branch", async () => {
    const self = await put(
      C.admin.cookie,
      C.doctor.memberId,
      C.branchD,
      week([2, "08:00", "10:00"], [2, "09:00", "11:00"]),
    );
    expect(self.statusCode).toBe(409);
    expect(code(self)).toBe("schedule_overlap");
    expect(
      (await put(C.admin.cookie, C.admin.memberId, C.branchD, week([3, "08:00", "12:00"])))
        .statusCode,
    ).toBe(200);
    const cross = await put(
      C.admin.cookie,
      C.admin.memberId,
      C.branchR,
      week([3, "11:00", "13:00"]),
    );
    expect(code(cross)).toBe("schedule_overlap");
  });

  it("D-13: two saves racing for one provider's overlapping hours — exactly one wins", async () => {
    const [a, b] = await Promise.all([
      put(C.admin.cookie, C.admin.memberId, C.branchX, week([4, "08:00", "12:00"])),
      put(C.admin.cookie, C.admin.memberId, C.branchR, week([4, "10:00", "14:00"])),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  });

  it("refuses a member who is not bookable, and a branch the provider does not work in", async () => {
    const notBookable = await put(
      C.admin.cookie,
      C.desk.memberId,
      C.branchR,
      week([0, "08:00", "09:00"]),
    );
    expect(notBookable.statusCode).toBe(400);
    expect(code(notBookable)).toBe("provider_not_bookable");
    const elsewhere = await put(
      C.admin.cookie,
      C.doctor.memberId,
      C.branchX,
      week([0, "08:00", "09:00"]),
    );
    expect(code(elsewhere)).toBe("provider_not_in_branch");
  });

  it("validates wall times: HH:MM, start before end, 24:00 only as an end", async () => {
    for (const bad of [
      week([0, "08:00", "08:00"]),
      week([0, "24:00", "24:00"]),
      week([0, "8:00", "09:00"]),
      week([7, "08:00", "09:00"]),
    ]) {
      expect((await put(C.admin.cookie, C.doctor.memberId, C.branchD, bad)).statusCode).toBe(400);
    }
  });
});

describe("branch scope (spec §3)", () => {
  it("a front desk on branch R edits a provider in R only and never sees providers outside R", async () => {
    expect(
      (await put(C.desk.cookie, C.admin.memberId, C.branchR, week([5, "08:00", "09:00"])))
        .statusCode,
    ).toBe(200);
    const outside = await put(
      C.desk.cookie,
      C.admin.memberId,
      C.branchD,
      week([5, "08:00", "09:00"]),
    );
    expect(code(outside)).toBe("forbidden");
    expect((await send(h, C.desk.cookie, "GET", path(C.doctor.memberId))).statusCode).toBe(404);
    const providers = (await send(h, C.desk.cookie, "GET", "/v1/schedules/providers")).json().items;
    const ids = providers.map((p: { membershipId: string }) => p.membershipId);
    expect(ids).toContain(C.admin.memberId);
    expect(ids).not.toContain(C.doctor.memberId);
    const seen = (await send(h, C.desk.cookie, "GET", path(C.admin.memberId))).json();
    expect(seen.branches.map((b: { id: string }) => b.id)).toEqual([C.branchR]);
    expect(seen.shifts.every((s: { branchId: string }) => s.branchId === C.branchR)).toBe(true);
  });

  it("NEGATIVE: time off needs update:schedules:clinic; another clinic's member is not found", async () => {
    const body = { startsAt: inDays(1), endsAt: inDays(2), note: null };
    expect(
      code(await send(h, C.desk.cookie, "POST", `${path(C.admin.memberId)}/time-off`, body)),
    ).toBe("forbidden");
    expect((await send(h, C.admin.cookie, "GET", path(other.doctor.memberId))).statusCode).toBe(
      404,
    );
  });
});

describe("time off (D-6)", () => {
  it("adds, shows, cancels once; the note never reaches the audit log", async () => {
    const body = { startsAt: inDays(3), endsAt: inDays(4), note: "private reason" };
    const added = await send(
      h,
      C.admin.cookie,
      "POST",
      `${path(C.doctor.memberId)}/time-off`,
      body,
    );
    expect(added.statusCode).toBe(201);
    const off = added
      .json()
      .timeOff.find((t: { note: string | null }) => t.note === "private reason");
    expect(off).toBeDefined();
    const cancel = `${path(C.doctor.memberId)}/time-off/${off.id}/cancel`;
    const cancelled = await send(h, C.admin.cookie, "POST", cancel);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().timeOff.map((t: { id: string }) => t.id)).not.toContain(off.id);
    expect((await send(h, C.admin.cookie, "POST", cancel)).statusCode).toBe(200);
    const rows = await auditOf(h, C.clinicId, off.id);
    expect(rows.map((r) => r["action"])).toEqual(["time_off.added", "time_off.cancelled"]);
    expect(rows.map((r) => r["raw"]).join(" ")).not.toContain("private reason");
  });

  it("refuses an end before the start (400)", async () => {
    const body = { startsAt: inDays(2), endsAt: inDays(1), note: null };
    expect(
      (await send(h, C.admin.cookie, "POST", `${path(C.doctor.memberId)}/time-off`, body))
        .statusCode,
    ).toBe(400);
  });
});

describe("the module flag (rule 10)", () => {
  it("NEGATIVE: every schedules route answers module_disabled while the module is off", async () => {
    await setAppointmentsModule(h, invalidate, C.clinicId, false);
    try {
      const routes = [
        send(h, C.admin.cookie, "GET", "/v1/schedules/providers"),
        send(h, C.admin.cookie, "GET", path(C.doctor.memberId)),
        put(C.admin.cookie, C.doctor.memberId, C.branchD, week()),
        send(h, C.admin.cookie, "POST", `${path(C.doctor.memberId)}/time-off`, {
          startsAt: inDays(1),
          endsAt: inDays(2),
          note: null,
        }),
      ];
      for (const res of await Promise.all(routes)) expect(code(res)).toBe("module_disabled");
    } finally {
      await setAppointmentsModule(h, invalidate, C.clinicId, true);
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (with the `test:db` env exported): `pnpm --filter @eyadex/api test:db -- src/modules/appointments/__tests__/schedules.db.spec.ts`
Expected: FAIL — `expected 404 to be 200` on the first PUT (no route yet).

- [ ] **Step 3: `persistence/pg-schedule-store.ts`**

```ts
import type { WallShift } from "@eyadex/contracts/schedules";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { wallFromDb, type ScheduleRow } from "../domain/schedule-rules.ts";
import type { TimeOffRecord } from "../domain/time-off-rules.ts";

// SQL on provider_schedules and provider_time_off (0042). Every function runs inside the caller's
// withTenant(clinicId), under the provider lock when it writes.

export async function readScheduleRows(
  tx: Tx,
  clinicId: string,
  membershipId: string,
): Promise<ScheduleRow[]> {
  const rows = await tx.execute<{
    id: string;
    branch_id: string;
    weekday: number;
    starts_at: string;
    ends_at: string;
  }>(
    sql`SELECT id, branch_id, weekday, starts_at::text AS starts_at, ends_at::text AS ends_at
        FROM provider_schedules WHERE clinic_id = ${clinicId} AND membership_id = ${membershipId}
        ORDER BY weekday, starts_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    branchId: r.branch_id,
    weekday: Number(r.weekday),
    startsAt: wallFromDb(r.starts_at),
    endsAt: wallFromDb(r.ends_at),
  }));
}

/** The branch's week is configuration: its rows are replaced, never edited (ADR-0026 §4). */
export async function replaceBranchRows(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  branchId: string,
  shifts: readonly WallShift[],
  newId: () => string,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`DELETE FROM provider_schedules WHERE clinic_id = ${clinicId}
          AND membership_id = ${membershipId} AND branch_id = ${branchId}`,
  );
  for (const s of shifts) {
    await tx.execute(
      sql`INSERT INTO provider_schedules (clinic_id, id, membership_id, branch_id, weekday,
            starts_at, ends_at, created_at)
          VALUES (${clinicId}, ${newId()}, ${membershipId}, ${branchId}, ${s.weekday},
            ${s.startsAt}::time, ${s.endsAt}::time, ${now.toISOString()}::timestamptz)`,
    );
  }
}

interface TimeOffRow {
  id: string;
  starts_at: Date | string;
  ends_at: Date | string;
  note: string | null;
  cancelled_at: Date | string | null;
}

const toTimeOff = (r: TimeOffRow): TimeOffRecord => ({
  id: r.id,
  startsAt: new Date(r.starts_at),
  endsAt: new Date(r.ends_at),
  note: r.note,
  cancelledAt: r.cancelled_at === null ? null : new Date(r.cancelled_at),
});

export async function insertTimeOff(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  record: TimeOffRecord,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO provider_time_off (clinic_id, id, membership_id, starts_at, ends_at, note,
          cancelled_at, created_at, updated_at)
        VALUES (${clinicId}, ${record.id}, ${membershipId}, ${record.startsAt.toISOString()}::timestamptz,
          ${record.endsAt.toISOString()}::timestamptz, ${record.note}, NULL, ${at}::timestamptz,
          ${at}::timestamptz)`,
  );
}

/** One time off of this provider, row-locked; `null` = not this provider's in this clinic. */
export async function findTimeOff(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  id: string,
): Promise<TimeOffRecord | null> {
  const rows = await tx.execute<TimeOffRow>(
    sql`SELECT id, starts_at, ends_at, note, cancelled_at FROM provider_time_off
        WHERE clinic_id = ${clinicId} AND membership_id = ${membershipId} AND id = ${id} FOR UPDATE`,
  );
  return rows[0] === undefined ? null : toTimeOff(rows[0]);
}

export async function markTimeOffCancelled(
  tx: Tx,
  clinicId: string,
  id: string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`UPDATE provider_time_off SET cancelled_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
}

/** Time off that is not cancelled and has not ended, earliest first. */
export async function readUpcomingTimeOff(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  now: Date,
): Promise<TimeOffRecord[]> {
  const rows = await tx.execute<TimeOffRow>(
    sql`SELECT id, starts_at, ends_at, note, cancelled_at FROM provider_time_off
        WHERE clinic_id = ${clinicId} AND membership_id = ${membershipId}
          AND cancelled_at IS NULL AND ends_at > ${now.toISOString()}::timestamptz
        ORDER BY starts_at, id`,
  );
  return rows.map(toTimeOff);
}
```

- [ ] **Step 4: `queries/provider-schedule.ts`**

```ts
import type {
  ProviderListResponse,
  ProviderSchedule,
  ProviderSummary,
} from "@eyadex/contracts/schedules";
import type { Database, Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import {
  providerWithin,
  providerWorksIn,
  reachCovers,
  type Reach,
} from "../domain/scheduling-scope.ts";
import { readScheduleRows, readUpcomingTimeOff } from "../persistence/pg-schedule-store.ts";
import type { ProviderDirectory, ProviderRecord } from "../ports/provider-directory.ts";
import type { SchedulingBranchReader } from "../ports/scheduling-branch-reader.ts";

/** What a schedules read needs: the transaction and the module's two ports. */
export interface ScheduleReads {
  readonly tx: Tx;
  readonly providers: ProviderDirectory;
  readonly branches: SchedulingBranchReader;
}

/** The caller of a schedules route: its clinic, the reach of the route's action, its sort language. */
export interface ScheduleViewer {
  readonly clinicId: string;
  readonly reach: Reach;
  readonly language: "ar" | "en";
}

const summaryOf = (p: ProviderRecord): ProviderSummary => ({
  membershipId: p.membershipId,
  fullName: p.fullName,
  defaultDurationMinutes: p.defaultDurationMinutes,
  allBranches: p.allBranches,
  branchIds: [...p.branchIds],
});

/**
 * The bookable members working in at least one branch inside the caller's reach (spec §5).
 *
 * @param db the `eyadex_app` pool
 * @param providers the module's ProviderDirectory
 * @param viewer the caller
 * @returns the providers, by name
 */
export async function listProviders(
  db: Database,
  providers: ProviderDirectory,
  viewer: ScheduleViewer,
): Promise<ProviderListResponse> {
  const rows = await db.withTenant(viewer.clinicId, (tx) =>
    providers.listBookable(tx, viewer.clinicId),
  );
  return { items: rows.filter((p) => providerWithin(viewer.reach, p)).map(summaryOf) };
}

/**
 * One provider's schedule as the caller may see it: its branches inside the reach, its rows there and
 * its time off that has not ended. A member outside the reach is `not_found` (no probing).
 *
 * @param reads the transaction and ports
 * @param viewer the caller
 * @param membershipId the provider
 * @param now the clock's now
 * @returns the schedule
 */
export async function readProviderSchedule(
  reads: ScheduleReads,
  viewer: ScheduleViewer,
  membershipId: string,
  now: Date,
): Promise<ProviderSchedule> {
  const { tx, providers, branches } = reads;
  const provider = await providers.find(tx, viewer.clinicId, membershipId);
  if (provider === null || !providerWithin(viewer.reach, provider)) throw new ApiError("not_found");
  const visible = (await branches.listForOptions(tx, viewer.clinicId, viewer.language)).filter(
    (b) => providerWorksIn(provider, b.id) && reachCovers(viewer.reach, b.id),
  );
  const ids = new Set(visible.map((b) => b.id));
  const rows = await readScheduleRows(tx, viewer.clinicId, membershipId);
  const timeOff = await readUpcomingTimeOff(tx, viewer.clinicId, membershipId, now);
  return {
    provider: summaryOf(provider),
    branches: visible.map(({ id, nameAr, nameEn, isActive }) => ({ id, nameAr, nameEn, isActive })),
    shifts: rows
      .filter((r) => ids.has(r.branchId))
      .map(({ branchId, weekday, startsAt, endsAt }) => ({ branchId, weekday, startsAt, endsAt })),
    timeOff: timeOff.map((t) => ({
      id: t.id,
      startsAt: t.startsAt.toISOString(),
      endsAt: t.endsAt.toISOString(),
      note: t.note,
    })),
  };
}

/** The `GET /v1/schedules/:membershipId` read in its own transaction. */
export function readSchedule(
  db: Database,
  providers: ProviderDirectory,
  branches: SchedulingBranchReader,
  viewer: ScheduleViewer,
  membershipId: string,
  now: Date,
): Promise<ProviderSchedule> {
  return db.withTenant(viewer.clinicId, (tx) =>
    readProviderSchedule({ tx, providers, branches }, viewer, membershipId, now),
  );
}
```

- [ ] **Step 5: `use-cases/schedule-changes/schedule-changes.ts`**

```ts
import type { ProviderSchedule, TimeOffInput, WallShift } from "@eyadex/contracts/schedules";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { lockProvider } from "../../../../shared/provider-lock.ts";
import type { Clock } from "../../../tenancy/index.ts";
import { decideBranchSchedule, scheduleAuditSnapshot } from "../../domain/schedule-rules.ts";
import { providerWithin, providerWorksIn, reachCovers } from "../../domain/scheduling-scope.ts";
import {
  decideTimeOffCancel,
  normalizeNote,
  timeOffAuditSnapshot,
  type TimeOffRecord,
} from "../../domain/time-off-rules.ts";
import {
  findTimeOff,
  insertTimeOff,
  markTimeOffCancelled,
  readScheduleRows,
  replaceBranchRows,
} from "../../persistence/pg-schedule-store.ts";
import type { ProviderDirectory, ProviderRecord } from "../../ports/provider-directory.ts";
import type { SchedulingBranchReader } from "../../ports/scheduling-branch-reader.ts";
import { readProviderSchedule, type ScheduleViewer } from "../../queries/provider-schedule.ts";

export interface ScheduleChangesDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly providers: ProviderDirectory;
  readonly branches: SchedulingBranchReader;
}

/** The caller of a schedules write: a viewer plus who is acting (for the audit row). */
export interface ScheduleActor extends ScheduleViewer {
  readonly userId: string;
}

/**
 * جداول العمل والإجازات (D-6، D-13، D-14، ADR-0026 §3–§4). كل كتابة transaction واحدة تحت قفل مقدّم
 * الخدمة (نفس قفل الحجز في A2)، فيها صف سجل إداري واحد؛ الأسبوع بيتحفظ لكل فرع لوحده، والتداخل بيتقرر
 * على صفوف مقدّم الخدمة في كل فروعه. مفيش حذف إلا استبدال صفوف أسبوع الفرع.
 */
export class ScheduleChanges {
  constructor(private readonly deps: ScheduleChangesDeps) {}

  /**
   * يستبدل أسبوع مقدّم خدمة في فرع؛ نفس الصفوف = نفس الرد من غير صف سجل.
   *
   * @param actor الفاعل بوصول `update:schedules`
   * @param membershipId مقدّم الخدمة
   * @param branchId الفرع
   * @param shifts الأسبوع بعد `branchScheduleInputSchema`
   * @returns الجدول بعد الحفظ
   */
  replaceBranch(
    actor: ScheduleActor,
    membershipId: string,
    branchId: string,
    shifts: readonly WallShift[],
  ): Promise<ProviderSchedule> {
    const { db, clock, ids, branches } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockProvider(tx, actor.clinicId, membershipId);
      const provider = await this.bookable(tx, actor, membershipId);
      const branch = await branches.lockForFiling(tx, actor.clinicId, branchId);
      if (branch === null) throw new ApiError("not_found");
      if (!reachCovers(actor.reach, branchId)) throw new ApiError("forbidden");
      if (!branch.isActive) throw new ApiError("branch_inactive");
      if (!providerWorksIn(provider, branchId)) throw new ApiError("provider_not_in_branch");
      const current = await readScheduleRows(tx, actor.clinicId, membershipId);
      const decision = decideBranchSchedule(current, branchId, shifts);
      if (decision.kind === "overlap") throw new ApiError("schedule_overlap");
      if (decision.kind === "replace") {
        const now = clock.now();
        const newId = () => ids.newId();
        await replaceBranchRows(
          tx,
          actor.clinicId,
          membershipId,
          branchId,
          decision.shifts,
          newId,
          now,
        );
        const before = current.filter((r) => r.branchId === branchId);
        await this.audit(tx, actor, "schedule.replaced", "provider_schedule", membershipId, {
          before: scheduleAuditSnapshot(provider.fullName, branchId, before),
          after: scheduleAuditSnapshot(provider.fullName, branchId, decision.shifts),
        });
      }
      return this.read(tx, actor, membershipId);
    });
  }

  /**
   * يضيف إجازة لمقدّم خدمة قابل للحجز.
   *
   * @param actor الفاعل (`update:schedules:clinic`)
   * @param membershipId مقدّم الخدمة
   * @param input البداية والنهاية والملاحظة بعد `timeOffInputSchema`
   * @returns الجدول بعد الإضافة
   */
  addTimeOff(
    actor: ScheduleActor,
    membershipId: string,
    input: TimeOffInput,
  ): Promise<ProviderSchedule> {
    const { db, ids } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockProvider(tx, actor.clinicId, membershipId);
      const provider = await this.bookable(tx, actor, membershipId);
      const record: TimeOffRecord = {
        id: ids.newId(),
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        note: normalizeNote(input.note),
        cancelledAt: null,
      };
      await insertTimeOff(tx, actor.clinicId, membershipId, record, this.deps.clock.now());
      await this.audit(tx, actor, "time_off.added", "provider_time_off", record.id, {
        before: null,
        after: timeOffAuditSnapshot(provider.fullName, record),
      });
      return this.read(tx, actor, membershipId);
    });
  }

  /**
   * يلغي إجازة (مفيش حذف)؛ الملغية قبل كده = نفس الرد من غير صف سجل.
   *
   * @param actor الفاعل (`update:schedules:clinic`)
   * @param membershipId مقدّم الخدمة
   * @param timeOffId الإجازة
   * @returns الجدول بعد الإلغاء
   */
  cancelTimeOff(
    actor: ScheduleActor,
    membershipId: string,
    timeOffId: string,
  ): Promise<ProviderSchedule> {
    const { db, clock } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockProvider(tx, actor.clinicId, membershipId);
      const provider = await this.visible(tx, actor, membershipId);
      const record = await findTimeOff(tx, actor.clinicId, membershipId, timeOffId);
      if (record === null) throw new ApiError("not_found");
      if (decideTimeOffCancel(record) === "cancel") {
        const now = clock.now();
        await markTimeOffCancelled(tx, actor.clinicId, record.id, now);
        await this.audit(tx, actor, "time_off.cancelled", "provider_time_off", record.id, {
          before: timeOffAuditSnapshot(provider.fullName, record),
          after: timeOffAuditSnapshot(provider.fullName, { ...record, cancelledAt: now }),
        });
      }
      return this.read(tx, actor, membershipId);
    });
  }

  private async visible(
    tx: Tx,
    actor: ScheduleActor,
    membershipId: string,
  ): Promise<ProviderRecord> {
    const provider = await this.deps.providers.find(tx, actor.clinicId, membershipId);
    if (provider === null || !providerWithin(actor.reach, provider))
      throw new ApiError("not_found");
    return provider;
  }

  // D-1, rule 1: only an active member with "accepts appointments" on has a schedule to edit.
  private async bookable(
    tx: Tx,
    actor: ScheduleActor,
    membershipId: string,
  ): Promise<ProviderRecord> {
    const provider = await this.visible(tx, actor, membershipId);
    if (!provider.active || !provider.acceptsAppointments) {
      throw new ApiError("provider_not_bookable");
    }
    return provider;
  }

  private read(tx: Tx, actor: ScheduleActor, membershipId: string): Promise<ProviderSchedule> {
    const { providers, branches, clock } = this.deps;
    return readProviderSchedule({ tx, providers, branches }, actor, membershipId, clock.now());
  }

  private async audit(
    tx: Tx,
    actor: ScheduleActor,
    action: string,
    entityType: "provider_schedule" | "provider_time_off",
    entityId: string,
    details: { before: unknown; after: unknown },
  ): Promise<void> {
    await writeClinicAudit(tx, {
      clinicId: actor.clinicId,
      id: this.deps.ids.newId(),
      actorUserId: actor.userId,
      action,
      entityType,
      entityId,
      details,
      createdAt: this.deps.clock.now(),
    });
  }
}
```

- [ ] **Step 6: `http/schedules.controller.ts`**

```ts
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from "@nestjs/common";
import { idSchema } from "@eyadex/contracts/common";
import {
  branchScheduleInputSchema,
  timeOffInputSchema,
  type BranchScheduleInput,
  type ProviderListResponse,
  type ProviderSchedule,
  type TimeOffInput,
} from "@eyadex/contracts/schedules";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { CLOCK, type Clock } from "../../tenancy/index.ts";
import { reachOf } from "../domain/scheduling-scope.ts";
import type { ProviderDirectory } from "../ports/provider-directory.ts";
import type { SchedulingBranchReader } from "../ports/scheduling-branch-reader.ts";
import { PROVIDER_DIRECTORY, SCHEDULE_CHANGES, SCHEDULING_BRANCH_READER } from "../ports/tokens.ts";
import { listProviders, readSchedule, type ScheduleViewer } from "../queries/provider-schedule.ts";
import type {
  ScheduleActor,
  ScheduleChanges,
} from "../use-cases/schedule-changes/schedule-changes.ts";

// A malformed id is an unknown record: 404, the same answer as another clinic's id (ISO-02).
const idOf = (raw: string): string => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("not_found");
  return parsed.data;
};

// The reach of the route's own action: its clinic key = every branch, its branch key = the member's.
const viewerOf = (request: ClinicRequest): ScheduleViewer => {
  const reach = reachOf(request.permissionGrant, request.clinicContext.branchScope);
  if (reach === null) throw new ApiError("forbidden");
  return {
    clinicId: request.clinicContext.clinicId,
    reach,
    language: request.clinicMember.preferredLanguage,
  };
};

const actorOf = (request: ClinicRequest): ScheduleActor => ({
  ...viewerOf(request),
  userId: request.clinicContext.userId,
});

// D-6, D-13, D-14 (ADR-0026 §3–§4). Thin: validate → call → map.
@Controller("schedules")
export class SchedulesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SCHEDULE_CHANGES) private readonly changes: ScheduleChanges,
    @Inject(PROVIDER_DIRECTORY) private readonly providers: ProviderDirectory,
    @Inject(SCHEDULING_BRANCH_READER) private readonly branches: SchedulingBranchReader,
  ) {}

  @Get("providers")
  @Require("view:schedules:branch")
  @RequiresFeature("appointments")
  list(@Req() request: ClinicRequest): Promise<ProviderListResponse> {
    return listProviders(this.db, this.providers, viewerOf(request));
  }

  @Get(":membershipId")
  @Require("view:schedules:branch")
  @RequiresFeature("appointments")
  read(
    @Req() request: ClinicRequest,
    @Param("membershipId") membershipId: string,
  ): Promise<ProviderSchedule> {
    const viewer = viewerOf(request);
    return readSchedule(
      this.db,
      this.providers,
      this.branches,
      viewer,
      idOf(membershipId),
      this.clock.now(),
    );
  }

  @Put(":membershipId/branches/:branchId")
  @Require("update:schedules:branch")
  @RequiresFeature("appointments")
  replace(
    @Req() request: ClinicRequest,
    @Param("membershipId") membershipId: string,
    @Param("branchId") branchId: string,
    @Body(new ZodValidationPipe(branchScheduleInputSchema)) body: BranchScheduleInput,
  ): Promise<ProviderSchedule> {
    return this.changes.replaceBranch(
      actorOf(request),
      idOf(membershipId),
      idOf(branchId),
      body.shifts,
    );
  }

  @Post(":membershipId/time-off")
  @HttpCode(201)
  @Require("update:schedules:clinic")
  @RequiresFeature("appointments")
  addTimeOff(
    @Req() request: ClinicRequest,
    @Param("membershipId") membershipId: string,
    @Body(new ZodValidationPipe(timeOffInputSchema)) body: TimeOffInput,
  ): Promise<ProviderSchedule> {
    return this.changes.addTimeOff(actorOf(request), idOf(membershipId), body);
  }

  @Post(":membershipId/time-off/:timeOffId/cancel")
  @HttpCode(200)
  @Require("update:schedules:clinic")
  @RequiresFeature("appointments")
  cancelTimeOff(
    @Req() request: ClinicRequest,
    @Param("membershipId") membershipId: string,
    @Param("timeOffId") timeOffId: string,
  ): Promise<ProviderSchedule> {
    return this.changes.cancelTimeOff(actorOf(request), idOf(membershipId), idOf(timeOffId));
  }
}
```

- [ ] **Step 7: Wire it in `appointments.module.ts`**

Add the imports

```ts
import { SchedulesController } from "./http/schedules.controller.ts";
import { ScheduleChanges } from "./use-cases/schedule-changes/schedule-changes.ts";
```

extend the tokens import with `SCHEDULE_CHANGES`, set `controllers: [ServicesController, SchedulesController]`, and add the provider:

```ts
    {
      provide: SCHEDULE_CHANGES,
      inject: [DATABASE, CLOCK, PROVIDER_DIRECTORY, SCHEDULING_BRANCH_READER],
      useFactory: (
        db: Database,
        clock: Clock,
        providerDirectory: ProviderDirectory,
        branchReader: SchedulingBranchReader,
      ) =>
        new ScheduleChanges({
          db,
          clock,
          ids: systemUuidV7(),
          providers: providerDirectory,
          branches: branchReader,
        }),
    },
```

- [ ] **Step 8: Run the tests**

Run: `pnpm exec prettier --write apps/api/src/modules/appointments && pnpm --filter @eyadex/api test:db -- src/modules/appointments && pnpm --filter @eyadex/api exec vitest run src/shared src/modules/appointments && pnpm --filter @eyadex/api typecheck && pnpm --filter @eyadex/api lint`
Expected: PASS (`prettier` wraps the long test lines); typecheck and lint exit 0; `wc -l` of every new file ≤ 300.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/appointments
git commit -m "feat(api): weekly provider schedules and time off under the provider lock (D-6, D-13, D-14)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: Web — the `scheduling` namespace of `ApiClient` and its HTTP adapter

**Files:**

- Create: `apps/web/src/shared/api/scheduling-client.ts`, `apps/web/src/shared/api/http/http-scheduling.ts`
- Modify: `apps/web/src/shared/api/api-client.ts` (one import + one member), `apps/web/src/shared/api/http/http-adapter.ts`, `apps/web/src/shared/api/mock/mock-adapter.ts` (temporary `notImplemented` namespace, replaced in Task 14)
- Test: `apps/web/src/shared/api/http/__tests__/scheduling-routes.test.ts`

**Interfaces:**

- Consumes: the contracts of Task 3; `HttpContext`, `Transport` (`http-context.ts`, `http-transport.ts`).
- Produces: `interface SchedulingApi` (exact signatures below) and `ApiClient["scheduling"]: SchedulingApi`; `createHttpScheduling(ctx: HttpContext): SchedulingApi`. Screens call only these methods.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/shared/api/http/__tests__/scheduling-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { BRANCH, CLINIC, TS, USER, clientWith, me, type Call } from "./fetch-stub";

// The appointments settings over HTTP (ADR-0026): method, path, body, key header of every call.
const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const SERVICE = "0190a000-0000-7000-8000-0000000000b1";
const OFF = "0190a000-0000-7000-8000-0000000000b2";
const service = {
  id: SERVICE,
  nameAr: "ليزر",
  nameEn: "Laser",
  durationMinutes: 30,
  status: "active",
  createdAt: TS,
};
const provider = {
  membershipId: USER,
  fullName: "Dr A",
  defaultDurationMinutes: 20,
  allBranches: false,
  branchIds: [BRANCH],
};
const schedule = {
  provider,
  branches: [{ id: BRANCH, nameAr: "ف", nameEn: "B", isActive: true }],
  shifts: [{ branchId: BRANCH, weekday: 0, startsAt: "20:00", endsAt: "24:00" }],
  timeOff: [{ id: OFF, startsAt: TS, endsAt: "2026-01-02T00:00:00.000Z", note: null }],
};
const profile = { memberId: USER, acceptsAppointments: true, defaultDurationMinutes: 30 };

function answer(call: Call) {
  const path = call.url.replace(/\?.*$/, "");
  if (path === "/api/v1/me") return { body: me };
  if (path === "/api/v1/services") {
    if (call.method === "GET") return { body: { items: [service], nextCursor: null, total: 1 } };
    return { body: service, status: 201 };
  }
  if (path.startsWith("/api/v1/services/")) return { body: service };
  if (path.endsWith("/booking-profile")) return { body: profile };
  if (path === "/api/v1/schedules/providers") return { body: { items: [provider] } };
  return { body: schedule, status: path.endsWith("/time-off") ? 201 : 200 };
}

let h: ReturnType<typeof clientWith>;
beforeEach(() => {
  h = clientWith(answer);
});
const last = () => h.calls.at(-1)!;

describe("scheduling over HTTP", () => {
  it("services: list with its query, create with the key, update/deactivate/reactivate by id", async () => {
    const page = await h.api.scheduling.listServices(P, {
      cursor: "Ng",
      limit: 20,
      status: "active",
    });
    expect(page).toEqual({ items: [service], nextCursor: null, total: 1 });
    expect(last().url).toBe("/api/v1/services?cursor=Ng&limit=20&status=active");
    const input = { nameAr: "ليزر", nameEn: "Laser", durationMinutes: 30 };
    await h.api.scheduling.createService(P, input, "key-1");
    expect(last()).toMatchObject({ method: "POST", url: "/api/v1/services", body: input });
    expect(last().headers["Idempotency-Key"]).toBe("key-1");
    await h.api.scheduling.updateService(P, SERVICE, input);
    expect(last()).toMatchObject({
      method: "PUT",
      url: `/api/v1/services/${SERVICE}`,
      body: input,
    });
    await h.api.scheduling.deactivateService(P, SERVICE);
    expect(last()).toMatchObject({ method: "POST", url: `/api/v1/services/${SERVICE}/deactivate` });
    await h.api.scheduling.reactivateService(P, SERVICE);
    expect(last().url).toBe(`/api/v1/services/${SERVICE}/reactivate`);
  });

  it("booking profile: GET and PUT on the member's route, only the two fields sent", async () => {
    expect(await h.api.scheduling.getBookingProfile(P, USER)).toEqual(profile);
    const input = { acceptsAppointments: true, defaultDurationMinutes: 30, extra: 1 };
    await h.api.scheduling.setBookingProfile(P, USER, input);
    expect(last()).toMatchObject({
      method: "PUT",
      url: `/api/v1/users/${USER}/booking-profile`,
      body: { acceptsAppointments: true, defaultDurationMinutes: 30 },
    });
  });

  it("schedules: providers, one provider, a branch week, time off add and cancel", async () => {
    expect(await h.api.scheduling.listProviders(P)).toEqual([provider]);
    expect(await h.api.scheduling.getProviderSchedule(P, USER)).toEqual(schedule);
    const week = { shifts: [{ weekday: 0, startsAt: "20:00", endsAt: "24:00" }] };
    await h.api.scheduling.replaceBranchSchedule(P, USER, BRANCH, week);
    expect(last()).toMatchObject({
      method: "PUT",
      url: `/api/v1/schedules/${USER}/branches/${BRANCH}`,
      body: week,
    });
    const off = { startsAt: TS, endsAt: "2026-01-02T00:00:00.000Z", note: null };
    await h.api.scheduling.addTimeOff(P, USER, off);
    expect(last()).toMatchObject({
      method: "POST",
      url: `/api/v1/schedules/${USER}/time-off`,
      body: off,
    });
    await h.api.scheduling.cancelTimeOff(P, USER, OFF);
    expect(last().url).toBe(`/api/v1/schedules/${USER}/time-off/${OFF}/cancel`);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @eyadex/web exec vitest run src/shared/api/http/__tests__/scheduling-routes.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'listServices')`.

- [ ] **Step 3: `apps/web/src/shared/api/scheduling-client.ts`**

```ts
import type { Page } from "@eyadex/contracts/common";
import type {
  BranchScheduleInput,
  ProviderSchedule,
  ProviderSummary,
  TimeOffInput,
} from "@eyadex/contracts/schedules";
import type {
  BookingProfile,
  BookingProfileInput,
  ClinicService,
  ServiceInput,
  ServiceListQuery,
} from "@eyadex/contracts/services";
import type { Persona } from "@eyadex/contracts/session";

/**
 * The appointments module's settings (slice A1, ADR-0026). Every call is rejected with
 * module_disabled while the clinic's appointments module is off.
 */
export interface SchedulingApi {
  /** view:services:clinic. */
  listServices(persona: Persona, query: ServiceListQuery): Promise<Page<ClinicService>>;
  /** A retry with the same key replays the first result; a changed request is a conflict. */
  createService(
    persona: Persona,
    input: ServiceInput,
    idempotencyKey: string,
  ): Promise<ClinicService>;
  updateService(persona: Persona, serviceId: string, input: ServiceInput): Promise<ClinicService>;
  deactivateService(persona: Persona, serviceId: string): Promise<ClinicService>;
  reactivateService(persona: Persona, serviceId: string): Promise<ClinicService>;
  /** The user editor's booking settings: view:users:clinic to read, update:users:clinic to save. */
  getBookingProfile(persona: Persona, memberId: string): Promise<BookingProfile>;
  setBookingProfile(
    persona: Persona,
    memberId: string,
    input: BookingProfileInput,
  ): Promise<BookingProfile>;
  /** Bookable members working in at least one branch the caller's schedules view reaches. */
  listProviders(persona: Persona): Promise<ProviderSummary[]>;
  getProviderSchedule(persona: Persona, membershipId: string): Promise<ProviderSchedule>;
  /** Replaces the provider's whole week in one branch (update:schedules at that branch). */
  replaceBranchSchedule(
    persona: Persona,
    membershipId: string,
    branchId: string,
    input: BranchScheduleInput,
  ): Promise<ProviderSchedule>;
  /** update:schedules:clinic. */
  addTimeOff(
    persona: Persona,
    membershipId: string,
    input: TimeOffInput,
  ): Promise<ProviderSchedule>;
  cancelTimeOff(
    persona: Persona,
    membershipId: string,
    timeOffId: string,
  ): Promise<ProviderSchedule>;
}
```

In `api-client.ts` add `import type { SchedulingApi } from "./scheduling-client";` after the platform import block, and inside `ApiClient` after `patients: {…};`:

```ts
/** Services, booking profiles, weekly schedules and time off (appointments module, ADR-0026). */
scheduling: SchedulingApi;
```

- [ ] **Step 4: `apps/web/src/shared/api/http/http-scheduling.ts`**

```ts
import { providerListResponseSchema, providerScheduleSchema } from "@eyadex/contracts/schedules";
import {
  bookingProfileSchema,
  clinicServiceSchema,
  serviceListResponseSchema,
  type ServiceInput,
} from "@eyadex/contracts/services";
import type { SchedulingApi } from "../scheduling-client";
import type { HttpContext } from "./http-context";

const service = (id: string) => `/v1/services/${encodeURIComponent(id)}`;
const schedule = (id: string) => `/v1/schedules/${encodeURIComponent(id)}`;
const bookingProfile = (id: string) => `/v1/users/${encodeURIComponent(id)}/booking-profile`;

/** The form's fields, and nothing else the caller's object may carry. */
const toServiceBody = (input: ServiceInput): ServiceInput => ({
  nameAr: input.nameAr,
  nameEn: input.nameEn,
  durationMinutes: input.durationMinutes,
});

export function createHttpScheduling(ctx: HttpContext): SchedulingApi {
  const { transport } = ctx;
  return {
    async listServices(_persona, query) {
      const page = await transport.send("GET", "/v1/services", {
        schema: serviceListResponseSchema,
        query: { cursor: query.cursor, limit: query.limit, status: query.status },
      });
      return { items: page.items, nextCursor: page.nextCursor, total: page.total };
    },
    createService: (_persona, input, idempotencyKey) =>
      transport.send("POST", "/v1/services", {
        schema: clinicServiceSchema,
        body: toServiceBody(input),
        idempotencyKey,
      }),
    updateService: (_persona, serviceId, input) =>
      transport.send("PUT", service(serviceId), {
        schema: clinicServiceSchema,
        body: toServiceBody(input),
      }),
    deactivateService: (_persona, serviceId) =>
      transport.send("POST", `${service(serviceId)}/deactivate`, { schema: clinicServiceSchema }),
    reactivateService: (_persona, serviceId) =>
      transport.send("POST", `${service(serviceId)}/reactivate`, { schema: clinicServiceSchema }),
    getBookingProfile: (_persona, memberId) =>
      transport.send("GET", bookingProfile(memberId), { schema: bookingProfileSchema }),
    setBookingProfile: (_persona, memberId, input) =>
      transport.send("PUT", bookingProfile(memberId), {
        schema: bookingProfileSchema,
        body: {
          acceptsAppointments: input.acceptsAppointments,
          defaultDurationMinutes: input.defaultDurationMinutes,
        },
      }),
    async listProviders() {
      const list = await transport.send("GET", "/v1/schedules/providers", {
        schema: providerListResponseSchema,
      });
      return list.items;
    },
    getProviderSchedule: (_persona, membershipId) =>
      transport.send("GET", schedule(membershipId), { schema: providerScheduleSchema }),
    replaceBranchSchedule: (_persona, membershipId, branchId, input) =>
      transport.send("PUT", `${schedule(membershipId)}/branches/${encodeURIComponent(branchId)}`, {
        schema: providerScheduleSchema,
        body: {
          shifts: input.shifts.map((s) => ({
            weekday: s.weekday,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
          })),
        },
      }),
    addTimeOff: (_persona, membershipId, input) =>
      transport.send("POST", `${schedule(membershipId)}/time-off`, {
        schema: providerScheduleSchema,
        body: { startsAt: input.startsAt, endsAt: input.endsAt, note: input.note },
      }),
    cancelTimeOff: (_persona, membershipId, timeOffId) =>
      transport.send(
        "POST",
        `${schedule(membershipId)}/time-off/${encodeURIComponent(timeOffId)}/cancel`,
        { schema: providerScheduleSchema },
      ),
  };
}
```

`http-adapter.ts`: `import { createHttpScheduling } from "./http-scheduling";` and `scheduling: createHttpScheduling(ctx),` after `patients`.

`mock-adapter.ts` (until Task 14): add

```ts
import { ApiError } from "../api-error";
import type { SchedulingApi } from "../scheduling-client";

const notYet = () => Promise.reject(new ApiError("not_implemented"));
const pendingScheduling = Object.fromEntries(
  [
    "listServices",
    "createService",
    "updateService",
    "deactivateService",
    "reactivateService",
    "getBookingProfile",
    "setBookingProfile",
    "listProviders",
    "getProviderSchedule",
    "replaceBranchSchedule",
    "addTimeOff",
    "cancelTimeOff",
  ].map((name) => [name, notYet]),
) as unknown as SchedulingApi;
```

and `scheduling: pendingScheduling,` after `patients`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @eyadex/web exec vitest run src/shared/api/http && pnpm --filter @eyadex/web typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/shared/api/scheduling-client.ts apps/web/src/shared/api/api-client.ts apps/web/src/shared/api/http/http-scheduling.ts apps/web/src/shared/api/http/http-adapter.ts apps/web/src/shared/api/http/__tests__/scheduling-routes.test.ts apps/web/src/shared/api/mock/mock-adapter.ts
git commit -m "feat(web): scheduling namespace of the ApiClient and its HTTP adapter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14: Web — the mock adapter enforces the same rules (check order, scope, D-6, D-12, D-14, D-15)

**Files:**

- Create: `apps/web/src/shared/api/mock/mock-scheduling-rules.ts`, `mock-services.ts`, `mock-schedules.ts`, `seed-scheduling.ts`
- Modify: `apps/web/src/shared/api/mock/mock-store.ts` (types + 5 state fields), `seed.ts` (initial arrays + one call), `mock-adapter.ts` (replace `pendingScheduling`)
- Test: `apps/web/src/services/services-mock.test.ts`, `apps/web/src/schedules/schedules-mock.test.ts`

**Interfaces:**

- Consumes: `SchedulingApi` (Task 13); `resolveActor`, `clinicBlockReason`, `effectivePermissions`, `authorize` (`mock-actor.ts`); `writeClinicAudit` (`mock-audit.ts`); `actorReplayKey` (`mock-idempotency.ts`); `paginate` (`mock-user-rules.ts`); `findShiftOverlap` (contracts).
- Produces: `MockState.services: StoredService[]`, `idempotentServices?`, `bookingProfiles: Record<string, BookingProfileInput>`, `scheduleRows: StoredShift[]`, `timeOff: StoredTimeOff[]`; `createMockServices()` and `createMockSchedules()` whose spread is `ApiClient["scheduling"]`; `seedScheduling(state, clinicId, makeId, createdAt)` (three services; every active doctor bookable, Sunday–Thursday 09:00–13:00 and 17:00–21:00 in its first branch).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/services/services-mock.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  PLATFORM,
  api,
  as,
  clinicIdAt,
  getState,
  resetMockData,
} from "@/shared/api/mock/mock-test-kit";
import { errorCodeOf } from "@/shared/api/api-error";

const admin = () => as("clinic_admin");
const page = { cursor: null, limit: 50, status: null };
const svc = (name: string, minutes = 30) => ({
  nameAr: `خدمة ${name}`,
  nameEn: `Service ${name}`,
  durationMinutes: minutes,
});
const fails = async (p: Promise<unknown>) =>
  errorCodeOf(
    await p.then(
      () => null,
      (e) => e,
    ),
  );

beforeEach(() => resetMockData());

describe("services (D-12) in the mock, as the API", () => {
  it("lists the seeded services and creates one with one audit row; a replay returns it", async () => {
    expect((await api.scheduling.listServices(admin(), page)).total).toBe(3);
    const key = crypto.randomUUID();
    const made = await api.scheduling.createService(admin(), svc("a"), key);
    expect(await api.scheduling.createService(admin(), svc("a"), key)).toEqual(made);
    expect(await fails(api.scheduling.createService(admin(), svc("b"), key))).toBe(
      "idempotency_conflict",
    );
    const rows = getState().clinicAudit.filter((e) => e.entityId === made.id);
    expect(rows.map((e) => [e.action, e.entity, e.category])).toEqual([
      ["service.created", "clinic_service", "administrative"],
    ]);
  });

  it("names are unique per language ignoring case and spaces; 5–480 minutes", async () => {
    await api.scheduling.createService(admin(), svc("dup"), crypto.randomUUID());
    const dup = { ...svc("x"), nameEn: " SERVICE DUP " };
    expect(await fails(api.scheduling.createService(admin(), dup, crypto.randomUUID()))).toBe(
      "service_name_taken",
    );
    expect(
      await fails(api.scheduling.createService(admin(), svc("y", 4), crypto.randomUUID())),
    ).toBe("validation");
  });

  it("deactivate and reactivate keep the service (no delete)", async () => {
    const made = await api.scheduling.createService(admin(), svc("s"), crypto.randomUUID());
    expect((await api.scheduling.deactivateService(admin(), made.id)).status).toBe("inactive");
    expect((await api.scheduling.reactivateService(admin(), made.id)).status).toBe("active");
  });

  it("NEGATIVE: no services key is forbidden; the module off is module_disabled first", async () => {
    expect(await fails(api.scheduling.listServices(as("receptionist"), page))).toBe("forbidden");
    await api.platform.setClinicFeature(PLATFORM, clinicIdAt(0), "appointments", false);
    expect(await fails(api.scheduling.listServices(as("receptionist"), page))).toBe(
      "module_disabled",
    );
    expect(await fails(api.scheduling.listServices(admin(), page))).toBe("module_disabled");
  });
});

describe("the platform audit (ADR-0026 §8)", () => {
  it("NEGATIVE: never shows the module's configuration rows", async () => {
    await api.scheduling.createService(admin(), svc("p"), crypto.randomUUID());
    const query = {
      cursor: null,
      limit: 100,
      actor: "",
      action: null,
      from: null,
      to: null,
      entity: null,
      source: null,
      clinicId: null,
    };
    const items = (await api.audit.platformList(PLATFORM, query)).items;
    expect(items.some((e) => e.action.startsWith("service."))).toBe(false);
  });
});

describe("booking profile (D-1, D-15)", () => {
  it("defaults to not bookable, 20 minutes; the admin changes it with one audit row", async () => {
    // A receptionist of the seed: not seeded as bookable (only doctors are).
    const member = getState().members.find((m) => {
      const role = getState().roles.find((r) => r.id === m.roleId);
      return (
        m.clinicId === clinicIdAt(0) && m.status === "active" && role?.systemKey === "receptionist"
      );
    })!;
    expect(await api.scheduling.getBookingProfile(admin(), member.id)).toEqual({
      memberId: member.id,
      acceptsAppointments: false,
      defaultDurationMinutes: 20,
    });
    const input = { acceptsAppointments: true, defaultDurationMinutes: 40 };
    expect(await api.scheduling.setBookingProfile(admin(), member.id, input)).toEqual({
      memberId: member.id,
      ...input,
    });
    const rows = getState().clinicAudit.filter((e) => e.action === "user.booking_changed");
    expect(rows).toHaveLength(1);
    expect(
      await fails(api.scheduling.setBookingProfile(as("receptionist"), member.id, input)),
    ).toBe("forbidden");
  });
});
```

Create `apps/web/src/schedules/schedules-mock.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { errorCodeOf } from "@/shared/api/api-error";

const admin = () => as("clinic_admin");
const fails = async (p: Promise<unknown>) =>
  errorCodeOf(
    await p.then(
      () => null,
      (e) => e,
    ),
  );
const week = (...rows: [number, string, string][]) => ({
  shifts: rows.map(([weekday, startsAt, endsAt]) => ({ weekday, startsAt, endsAt })),
});
const doctor = () =>
  getState().members.find((m) => {
    const role = getState().roles.find((r) => r.id === m.roleId);
    return m.clinicId === clinicIdAt(0) && m.status === "active" && role?.systemKey === "doctor";
  })!;

beforeEach(() => resetMockData());

describe("weekly schedules (D-6, D-14) in the mock, as the API", () => {
  it("lists the seeded bookable doctor and saves a week with one audit row", async () => {
    const d = doctor();
    expect((await api.scheduling.listProviders(admin())).map((p) => p.membershipId)).toContain(
      d.id,
    );
    const branchId = d.branchIds[0]!;
    const saved = await api.scheduling.replaceBranchSchedule(
      admin(),
      d.id,
      branchId,
      week([0, "20:00", "24:00"], [1, "00:00", "01:00"]),
    );
    expect(saved.shifts.filter((s) => s.branchId === branchId)).toHaveLength(2);
    const rows = getState().clinicAudit.filter((e) => e.action === "schedule.replaced");
    expect(rows).toHaveLength(1);
  });

  it("refuses overlaps, a branch the provider does not work in, and a member not bookable", async () => {
    const d = doctor();
    const branchId = d.branchIds[0]!;
    const clash = week([2, "08:00", "10:00"], [2, "09:00", "11:00"]);
    expect(await fails(api.scheduling.replaceBranchSchedule(admin(), d.id, branchId, clash))).toBe(
      "schedule_overlap",
    );
    const other = getState().branches.find(
      (b) => b.clinicId === clinicIdAt(0) && b.id !== branchId,
    )!;
    expect(
      await fails(
        api.scheduling.replaceBranchSchedule(admin(), d.id, other.id, week([3, "08:00", "09:00"])),
      ),
    ).toBe("provider_not_in_branch");
    getState().bookingProfiles[d.id] = { acceptsAppointments: false, defaultDurationMinutes: 20 };
    expect(
      await fails(
        api.scheduling.replaceBranchSchedule(admin(), d.id, branchId, week([3, "08:00", "09:00"])),
      ),
    ).toBe("provider_not_bookable");
  });

  it("time off: added, shown, cancelled (never deleted); needs the clinic-scope key", async () => {
    const d = doctor();
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const added = await api.scheduling.addTimeOff(admin(), d.id, {
      startsAt: start,
      endsAt: end,
      note: "x",
    });
    const off = added.timeOff.at(-1)!;
    const after = await api.scheduling.cancelTimeOff(admin(), d.id, off.id);
    expect(after.timeOff.map((t) => t.id)).not.toContain(off.id);
    expect(getState().timeOff.find((t) => t.id === off.id)?.cancelledAt).not.toBeNull();
    const audit = getState().clinicAudit.filter((e) => e.entityId === off.id);
    expect(JSON.stringify(audit)).not.toContain('"note"');
  });

  it("NEGATIVE: a branch-scope editor reaches only its branches", async () => {
    const receptionist = getState().roles.find(
      (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist",
    )!;
    receptionist.permissions.push("view:schedules:branch", "update:schedules:branch");
    const desk = getState().members.find(
      (m) => m.clinicId === clinicIdAt(0) && m.roleId === receptionist.id && m.status === "active",
    )!;
    const deskBranch = desk.branchIds[0]!;
    const visible = (await api.scheduling.listProviders(as("receptionist"))).map(
      (p) => p.membershipId,
    );
    const d = doctor();
    expect(visible.includes(d.id)).toBe(d.branchIds.includes(deskBranch));
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect(
      await fails(
        api.scheduling.addTimeOff(as("receptionist"), d.id, {
          startsAt: start,
          endsAt: end,
          note: null,
        }),
      ),
    ).toBe("forbidden");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @eyadex/web exec vitest run src/services/services-mock.test.ts src/schedules/schedules-mock.test.ts`
Expected: FAIL — `not_implemented` from `pendingScheduling`.

- [ ] **Step 3: Store types, state and seed**

`mock-store.ts` — add imports `import type { ScheduleShift, TimeOff } from "@eyadex/contracts/schedules";` and `import type { BookingProfileInput, ClinicService } from "@eyadex/contracts/services";`, the types after the imports:

```ts
export type StoredService = ClinicService & { clinicId: string };
export type StoredShift = ScheduleShift & { clinicId: string; id: string; membershipId: string };
export type StoredTimeOff = TimeOff & {
  clinicId: string;
  membershipId: string;
  cancelledAt: string | null;
};
```

and in `MockState`, before `platformAccounts`:

```ts
  /** Appointments module (slice A1, ADR-0026). */
  services: StoredService[];
  /** Idempotency-Key replay for service creates, as above: key -> service id + request fingerprint. */
  idempotentServices?: Record<string, { serviceId: string; fingerprint: string }>;
  /** By member id; a member with no entry is not bookable, 20 minutes (D-15). */
  bookingProfiles: Record<string, BookingProfileInput>;
  scheduleRows: StoredShift[];
  timeOff: StoredTimeOff[];
```

Create `seed-scheduling.ts`:

```ts
import type { MockState } from "./mock-store";

const SERVICES: [string, string, number][] = [
  ["استشارة", "Consultation", 20],
  ["جلسة ليزر", "Laser session", 45],
  ["متابعة", "Follow-up", 15],
];
const DAYS = [0, 1, 2, 3, 4];
const SHIFTS: [string, string][] = [
  ["09:00", "13:00"],
  ["17:00", "21:00"],
];

/**
 * Demo data for the appointments settings: three services, and every active doctor of the seed
 * bookable, Sunday–Thursday 09:00–13:00 and 17:00–21:00 in its first branch. Which members are seeded
 * as bookable is demo content, not an access rule.
 */
export function seedScheduling(
  state: MockState,
  clinicId: string,
  makeId: () => string,
  createdAt: string,
): void {
  for (const [nameAr, nameEn, durationMinutes] of SERVICES) {
    state.services.push({
      id: makeId(),
      clinicId,
      nameAr,
      nameEn,
      durationMinutes,
      status: "active",
      createdAt,
    });
  }
  const doctorRoles = state.roles
    .filter((r) => r.clinicId === clinicId && r.systemKey === "doctor")
    .map((r) => r.id);
  const doctors = state.members.filter(
    (m) => m.clinicId === clinicId && m.status === "active" && doctorRoles.includes(m.roleId),
  );
  for (const member of doctors) {
    state.bookingProfiles[member.id] = { acceptsAppointments: true, defaultDurationMinutes: 20 };
    const branchId = member.branchIds[0];
    if (branchId === undefined) continue;
    for (const weekday of DAYS) {
      for (const [startsAt, endsAt] of SHIFTS) {
        state.scheduleRows.push({
          id: makeId(),
          clinicId,
          membershipId: member.id,
          branchId,
          weekday,
          startsAt,
          endsAt,
        });
      }
    }
  }
}
```

`seed.ts` — `import { seedScheduling } from "./seed-scheduling";`, add `services: [], bookingProfiles: {}, scheduleRows: [], timeOff: [],` to the initial `state` object after `patientCounters: {},`, and right after `state.patientCounters[clinicId] = patientCount;` add `seedScheduling(state, clinicId, makeId, createdAt);`.

- [ ] **Step 4: `mock-scheduling-rules.ts`**

```ts
import { NO_FEATURES } from "@eyadex/contracts/clinics";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import { clinicBlockReason, effectivePermissions, resolveActor, type Actor } from "./mock-actor";
import type { MockState, StoredShift } from "./mock-store";

/** Every branch, or a branch list: the reach of one action (as the API's `Reach`). */
export type Reach = { all: true } | { all: false; branchIds: readonly string[] };
export type SchedulingAccess = Actor & { actorName: string; reach: Reach };
type MemberReach = { allBranches: boolean; branchIds: readonly string[] };

/** The action-independent guards, in the API's order: active user, clinic access, module. */
export function guardAppointments(db: MockState, persona: Persona): Actor {
  const actor = resolveActor(db, persona);
  if (clinicBlockReason(actor.clinic)) throw new ApiError("subscription_blocked");
  if (!(db.features[actor.clinic.id] ?? NO_FEATURES).appointments) {
    throw new ApiError("module_disabled");
  }
  return actor;
}

/** A schedules action at its scope: the clinic key reaches every branch, the branch key the member's. */
export function authorizeSchedules(
  db: MockState,
  persona: Persona,
  action: "view" | "update",
  clinicOnly = false,
): SchedulingAccess {
  const actor = guardAppointments(db, persona);
  const keys = effectivePermissions(db, actor);
  const base = { ...actor, actorName: actor.member.fullName };
  if (keys.includes(`${action}:schedules:clinic`)) return { ...base, reach: { all: true } };
  if (!clinicOnly && keys.includes(`${action}:schedules:branch`)) {
    const { allBranches, branchIds } = actor.member;
    return { ...base, reach: allBranches ? { all: true } : { all: false, branchIds } };
  }
  throw new ApiError("forbidden");
}

export const reachCovers = (reach: Reach, branchId: string) =>
  reach.all || reach.branchIds.includes(branchId);

export function providerWithin(reach: Reach, member: MemberReach): boolean {
  if (reach.all) return true;
  if (member.allBranches) return reach.branchIds.length > 0;
  return member.branchIds.some((id) => reach.branchIds.includes(id));
}

export const worksIn = (member: MemberReach, branchId: string) =>
  member.allBranches || member.branchIds.includes(branchId);

export const shiftLabel = (s: Pick<StoredShift, "weekday" | "startsAt" | "endsAt">) =>
  `${s.weekday} ${s.startsAt}-${s.endsAt}`;

export const profileOf = (db: MockState, memberId: string) =>
  db.bookingProfiles[memberId] ?? { acceptsAppointments: false, defaultDurationMinutes: 20 };
```

- [ ] **Step 5: `mock-services.ts`**

```ts
import {
  bookingProfileInputSchema,
  serviceInputSchema,
  serviceListQuerySchema,
  type ClinicService,
  type ServiceInput,
  type ServiceStatus,
} from "@eyadex/contracts/services";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import type { SchedulingApi } from "../scheduling-client";
import { authorize } from "./mock-actor";
import { writeClinicAudit } from "./mock-audit";
import { actorReplayKey } from "./mock-idempotency";
import { guardAppointments, profileOf } from "./mock-scheduling-rules";
import { delay, getState, newId, persist, type MockState, type StoredService } from "./mock-store";
import { paginate } from "./mock-user-rules";

type ServicesApi = Pick<
  SchedulingApi,
  | "listServices"
  | "createService"
  | "updateService"
  | "deactivateService"
  | "reactivateService"
  | "getBookingProfile"
  | "setBookingProfile"
>;

function parseService(raw: ServiceInput): ServiceInput {
  const parsed = serviceInputSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("validation");
  return parsed.data;
}

// The API's order: module before the permission (guardAppointments first), then the key itself.
function access(
  db: MockState,
  persona: Persona,
  action: "view" | "create" | "update" | "deactivate",
) {
  guardAppointments(db, persona);
  return authorize(db, persona, action, "services");
}

const same = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

function enforceNameFree(
  db: MockState,
  clinicId: string,
  input: ServiceInput,
  exceptId: string | null,
) {
  const taken = db.services.some(
    (s) =>
      s.clinicId === clinicId &&
      s.id !== exceptId &&
      (same(s.nameAr, input.nameAr) || same(s.nameEn, input.nameEn)),
  );
  if (taken) throw new ApiError("service_name_taken");
}

function findService(db: MockState, clinicId: string, id: string): StoredService {
  const service = db.services.find((s) => s.clinicId === clinicId && s.id === id);
  if (!service) throw new ApiError("not_found");
  return service;
}

const snapshot = (s: StoredService) => ({
  id: s.id,
  nameAr: s.nameAr,
  nameEn: s.nameEn,
  durationMinutes: s.durationMinutes,
  status: s.status,
});

const view = (s: StoredService): ClinicService => ({
  id: s.id,
  nameAr: s.nameAr,
  nameEn: s.nameEn,
  durationMinutes: s.durationMinutes,
  status: s.status,
  createdAt: s.createdAt,
});

export function createMockServices(): ServicesApi {
  async function setStatus(persona: Persona, id: string, status: ServiceStatus) {
    await delay();
    const db = getState();
    const { clinic, actorName } = access(db, persona, "deactivate");
    const service = findService(db, clinic.id, id);
    if (service.status === status) return view(service);
    const before = snapshot(service);
    service.status = status;
    const action = status === "inactive" ? "service.deactivated" : "service.reactivated";
    writeClinicAudit(db, {
      clinicId: clinic.id,
      actorName,
      action,
      entity: "clinic_service",
      before,
      after: snapshot(service),
    });
    persist();
    return view(service);
  }

  return {
    async listServices(persona, rawQuery) {
      await delay();
      const parsed = serviceListQuerySchema.safeParse(rawQuery);
      if (!parsed.success) throw new ApiError("validation");
      const db = getState();
      const { clinic } = access(db, persona, "view");
      const rows = db.services
        .filter((s) => s.clinicId === clinic.id)
        .filter((s) => !parsed.data.status || s.status === parsed.data.status)
        .map(view);
      return paginate(rows, parsed.data.cursor, parsed.data.limit);
    },
    async createService(persona, rawInput, idempotencyKey) {
      await delay();
      const input = parseService(rawInput);
      const db = getState();
      const { clinic, member, actorName } = access(db, persona, "create");
      const replayKey = actorReplayKey(clinic.id, member.id, idempotencyKey);
      const fingerprint = JSON.stringify(input);
      const previous = db.idempotentServices?.[replayKey];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
        return view(findService(db, clinic.id, previous.serviceId));
      }
      enforceNameFree(db, clinic.id, input, null);
      const service: StoredService = {
        id: newId(),
        clinicId: clinic.id,
        ...input,
        status: "active",
        createdAt: new Date().toISOString(),
      };
      db.services.push(service);
      db.idempotentServices = {
        ...db.idempotentServices,
        [replayKey]: { serviceId: service.id, fingerprint },
      };
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "service.created",
        entity: "clinic_service",
        before: null,
        after: snapshot(service),
      });
      persist();
      return view(service);
    },
    async updateService(persona, id, rawInput) {
      await delay();
      const input = parseService(rawInput);
      const db = getState();
      const { clinic, actorName } = access(db, persona, "update");
      const service = findService(db, clinic.id, id);
      const unchanged =
        service.nameAr === input.nameAr &&
        service.nameEn === input.nameEn &&
        service.durationMinutes === input.durationMinutes;
      if (unchanged) return view(service);
      enforceNameFree(db, clinic.id, input, id);
      const before = snapshot(service);
      Object.assign(service, input);
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "service.updated",
        entity: "clinic_service",
        before,
        after: snapshot(service),
      });
      persist();
      return view(service);
    },
    deactivateService: (persona, id) => setStatus(persona, id, "inactive"),
    reactivateService: (persona, id) => setStatus(persona, id, "active"),
    async getBookingProfile(persona, memberId) {
      await delay();
      const db = getState();
      guardAppointments(db, persona);
      const { clinic } = authorize(db, persona, "view", "users");
      if (!db.members.some((m) => m.clinicId === clinic.id && m.id === memberId)) {
        throw new ApiError("not_found");
      }
      return { memberId, ...profileOf(db, memberId) };
    },
    async setBookingProfile(persona, memberId, rawInput) {
      await delay();
      const parsed = bookingProfileInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new ApiError("validation");
      const db = getState();
      guardAppointments(db, persona);
      const { clinic, actorName } = authorize(db, persona, "update", "users");
      const member = db.members.find((m) => m.clinicId === clinic.id && m.id === memberId);
      if (!member) throw new ApiError("not_found");
      const before = profileOf(db, memberId);
      const next = parsed.data;
      const same =
        before.acceptsAppointments === next.acceptsAppointments &&
        before.defaultDurationMinutes === next.defaultDurationMinutes;
      if (!same) {
        db.bookingProfiles[memberId] = { ...next };
        const person = { id: memberId, fullName: member.fullName };
        writeClinicAudit(db, {
          clinicId: clinic.id,
          actorName,
          action: "user.booking_changed",
          entity: "user",
          before: { ...person, ...before },
          after: { ...person, ...next },
        });
        persist();
      }
      return { memberId, ...next };
    },
  };
}
```

- [ ] **Step 6: `mock-schedules.ts`**

```ts
import {
  branchScheduleInputSchema,
  findShiftOverlap,
  timeOffInputSchema,
} from "@eyadex/contracts/schedules";
import type { ProviderSchedule } from "@eyadex/contracts/schedules";
import type { MembershipUser } from "@eyadex/contracts/users";
import { ApiError } from "../api-error";
import type { SchedulingApi } from "../scheduling-client";
import { writeClinicAudit } from "./mock-audit";
import {
  authorizeSchedules,
  profileOf,
  providerWithin,
  reachCovers,
  shiftLabel,
  worksIn,
  type SchedulingAccess,
} from "./mock-scheduling-rules";
import { delay, getState, newId, persist, type MockState, type StoredTimeOff } from "./mock-store";

type SchedulesApi = Pick<
  SchedulingApi,
  "listProviders" | "getProviderSchedule" | "replaceBranchSchedule" | "addTimeOff" | "cancelTimeOff"
>;

const summary = (db: MockState, m: MembershipUser) => ({
  membershipId: m.id,
  fullName: m.fullName,
  defaultDurationMinutes: profileOf(db, m.id).defaultDurationMinutes,
  allBranches: m.allBranches,
  branchIds: [...m.branchIds],
});

/** A member outside the action's reach is not_found, never forbidden: members can't be probed. */
function visible(db: MockState, a: SchedulingAccess, id: string): MembershipUser {
  const member = db.members.find((m) => m.clinicId === a.clinic.id && m.id === id);
  if (!member || !providerWithin(a.reach, member)) throw new ApiError("not_found");
  return member;
}

function bookable(db: MockState, a: SchedulingAccess, id: string): MembershipUser {
  const member = visible(db, a, id);
  if (member.status !== "active" || !profileOf(db, id).acceptsAppointments) {
    throw new ApiError("provider_not_bookable");
  }
  return member;
}

function scheduleOf(db: MockState, a: SchedulingAccess, member: MembershipUser): ProviderSchedule {
  const branches = db.branches.filter(
    (b) => b.clinicId === a.clinic.id && worksIn(member, b.id) && reachCovers(a.reach, b.id),
  );
  const ids = new Set(branches.map((b) => b.id));
  const now = Date.now();
  return {
    provider: summary(db, member),
    branches: branches.map(({ id, nameAr, nameEn, isActive }) => ({
      id,
      nameAr,
      nameEn,
      isActive,
    })),
    shifts: db.scheduleRows
      .filter(
        (r) => r.clinicId === a.clinic.id && r.membershipId === member.id && ids.has(r.branchId),
      )
      .sort((x, y) => x.weekday - y.weekday || x.startsAt.localeCompare(y.startsAt))
      .map(({ branchId, weekday, startsAt, endsAt }) => ({ branchId, weekday, startsAt, endsAt })),
    timeOff: db.timeOff
      .filter((t) => t.clinicId === a.clinic.id && t.membershipId === member.id)
      .filter((t) => t.cancelledAt === null && new Date(t.endsAt).getTime() > now)
      .sort((x, y) => x.startsAt.localeCompare(y.startsAt))
      .map(({ id, startsAt, endsAt, note }) => ({ id, startsAt, endsAt, note })),
  };
}

// The note is free text about a person's absence: it never reaches an audit snapshot (ADR-0026 §7).
const offSnapshot = (t: StoredTimeOff, name: string) => ({
  id: t.id,
  providerName: name,
  startsAt: t.startsAt,
  endsAt: t.endsAt,
  cancelled: t.cancelledAt !== null,
});

export function createMockSchedules(): SchedulesApi {
  return {
    async listProviders(persona) {
      await delay();
      const db = getState();
      const a = authorizeSchedules(db, persona, "view");
      return db.members
        .filter((m) => m.clinicId === a.clinic.id && m.status === "active")
        .filter((m) => profileOf(db, m.id).acceptsAppointments && providerWithin(a.reach, m))
        .sort((x, y) => x.fullName.localeCompare(y.fullName))
        .map((m) => summary(db, m));
    },
    async getProviderSchedule(persona, id) {
      await delay();
      const db = getState();
      const a = authorizeSchedules(db, persona, "view");
      return scheduleOf(db, a, visible(db, a, id));
    },
    async replaceBranchSchedule(persona, id, branchId, rawInput) {
      await delay();
      const parsed = branchScheduleInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new ApiError("validation");
      const db = getState();
      const a = authorizeSchedules(db, persona, "update");
      const member = bookable(db, a, id);
      const branch = db.branches.find((b) => b.clinicId === a.clinic.id && b.id === branchId);
      if (!branch) throw new ApiError("not_found");
      if (!reachCovers(a.reach, branchId)) throw new ApiError("forbidden");
      if (!branch.isActive) throw new ApiError("branch_inactive");
      if (!worksIn(member, branchId)) throw new ApiError("provider_not_in_branch");
      const mineOf = (r: (typeof db.scheduleRows)[number]) =>
        r.clinicId === a.clinic.id && r.membershipId === id;
      const current = db.scheduleRows.filter(mineOf);
      const others = current.filter((r) => r.branchId !== branchId);
      if (findShiftOverlap([...others, ...parsed.data.shifts]))
        throw new ApiError("schedule_overlap");
      const before = current
        .filter((r) => r.branchId === branchId)
        .map(shiftLabel)
        .sort();
      const after = parsed.data.shifts.map(shiftLabel).sort();
      if (before.join("|") !== after.join("|")) {
        db.scheduleRows = db.scheduleRows
          .filter((r) => !(mineOf(r) && r.branchId === branchId))
          .concat(
            parsed.data.shifts.map((s) => ({
              ...s,
              id: newId(),
              clinicId: a.clinic.id,
              membershipId: id,
              branchId,
            })),
          );
        const base = { id, providerName: member.fullName, branchId };
        writeClinicAudit(db, {
          clinicId: a.clinic.id,
          actorName: a.actorName,
          action: "schedule.replaced",
          entity: "provider_schedule",
          before: { ...base, shifts: before },
          after: { ...base, shifts: after },
        });
        persist();
      }
      return scheduleOf(db, a, member);
    },
    async addTimeOff(persona, id, rawInput) {
      await delay();
      const parsed = timeOffInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new ApiError("validation");
      const db = getState();
      const a = authorizeSchedules(db, persona, "update", true);
      const member = bookable(db, a, id);
      const note = parsed.data.note?.trim() || null;
      const off: StoredTimeOff = {
        id: newId(),
        clinicId: a.clinic.id,
        membershipId: id,
        startsAt: new Date(parsed.data.startsAt).toISOString(),
        endsAt: new Date(parsed.data.endsAt).toISOString(),
        note,
        cancelledAt: null,
      };
      db.timeOff.push(off);
      writeClinicAudit(db, {
        clinicId: a.clinic.id,
        actorName: a.actorName,
        action: "time_off.added",
        entity: "provider_time_off",
        before: null,
        after: offSnapshot(off, member.fullName),
      });
      persist();
      return scheduleOf(db, a, member);
    },
    async cancelTimeOff(persona, id, timeOffId) {
      await delay();
      const db = getState();
      const a = authorizeSchedules(db, persona, "update", true);
      const member = visible(db, a, id);
      const off = db.timeOff.find(
        (t) => t.clinicId === a.clinic.id && t.membershipId === id && t.id === timeOffId,
      );
      if (!off) throw new ApiError("not_found");
      if (off.cancelledAt === null) {
        const before = offSnapshot(off, member.fullName);
        off.cancelledAt = new Date().toISOString();
        writeClinicAudit(db, {
          clinicId: a.clinic.id,
          actorName: a.actorName,
          action: "time_off.cancelled",
          entity: "provider_time_off",
          before,
          after: offSnapshot(off, member.fullName),
        });
        persist();
      }
      return scheduleOf(db, a, member);
    },
  };
}
```

`mock-adapter.ts` — remove the Task 13 `pendingScheduling` block and its two imports, add `import { createMockSchedules } from "./mock-schedules";` and `import { createMockServices } from "./mock-services";`, and set:

```ts
    scheduling: { ...createMockServices(), ...createMockSchedules() },
```

- [ ] **Step 7: Run the tests**

Run: `pnpm exec prettier --write apps/web/src/shared/api/mock apps/web/src/services apps/web/src/schedules && pnpm --filter @eyadex/web exec vitest run src/services src/schedules src/shared/api/mock && pnpm --filter @eyadex/web typecheck && pnpm --filter @eyadex/web lint && wc -l apps/web/src/shared/api/mock/*.ts | sort -n | tail -3`
Expected: PASS; typecheck and lint exit 0; no file above 300 lines (if `mock-schedules.ts` passes 300 after prettier, move `scheduleOf` and `offSnapshot` into `mock-scheduling-rules.ts`).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/shared/api/mock apps/web/src/services/services-mock.test.ts apps/web/src/schedules/schedules-mock.test.ts
git commit -m "feat(web): mock services, booking profiles, schedules and time off with the API's rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 15: Web — the services screen (`/clinic/services`), navigation and its strings

**Files:**

- Create: `apps/web/src/services/services-page.tsx`, `services-content.tsx`, `use-service-columns.tsx`, `service-form-dialog.tsx`, `service-status-dialog.tsx`, `service-status-badge.tsx`, `service-queries.ts`; `apps/web/src/routes/clinic.services.tsx`; `apps/web/src/shared/shell/nav-items.test.ts`
- Modify: `apps/web/src/shared/shell/nav-items.ts`, `apps/web/src/shared/i18n/en-scheduling.ts`, `ar-scheduling.ts` (add `enScheduling` / `arScheduling` with `services`), `en.ts` / `ar.ts` (spread + `nav.services`, `nav.schedules` + `validation.time`, `validation.timeOrder`), `apps/web/src/routeTree.gen.ts` (regenerated by the build)

**Interfaces:**

- Consumes: `ApiClient["scheduling"]` (Tasks 13–14); `can`, `RequirePermission`, `DataTable`, `CursorPager`, `FilterSelect`, `RowActionsMenu`, `PageHeader`, `StatusPanel`, `ConfirmActionDialog`, `TextField`, `NumberField`.
- Produces: route `/clinic/services` (`ServicesPage`, gated by `view:services:*`); nav entry `/clinic/services` (resource `services`; the `/clinic/schedules` entry comes with its route in Task 16, since `Link` only accepts registered paths); i18n `services.*`, `nav.services`, `nav.schedules`, `validation.time`, `validation.timeOrder`; `serviceKeys`, `useServiceList(query)`, `useRefreshServices()`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/shared/shell/nav-items.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CLINIC_NAV } from "./nav-items";

describe("clinic navigation", () => {
  it("reaches the appointments settings by permission (and so by module), never by role", () => {
    const resourceOf = (to: string) => CLINIC_NAV.find((item) => item.to === to)?.resource;
    expect(resourceOf("/clinic/services")).toBe("services");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @eyadex/web exec vitest run src/shared/shell/nav-items.test.ts`
Expected: FAIL — `expected undefined to be 'services'`.

- [ ] **Step 3: Navigation and strings**

`nav-items.ts`: add `ListChecks` to the lucide import, `| "/clinic/services"` to `NavPath` (after `"/clinic/patients"`), and after the patients entry of `CLINIC_NAV`:

```ts
  { to: "/clinic/services", label: "nav.services", icon: ListChecks, resource: "services" },
```

`en.ts` `nav`: `services: "Services",` `schedules: "Work schedules",`; `validation`: `time: "Enter a time as HH:MM (24:00 only as an end)",` `timeOrder: "The end must be after the start",`; import `enScheduling` beside `enSchedulingErrors` and add `  ...enScheduling,` after `  ...enSettings,`.
`ar.ts` `nav`: `services: "الخدمات",` `schedules: "جداول العمل",`; `validation`: `time: "اكتب الوقت بصيغة HH:MM (24:00 كنهاية فقط)",` `timeOrder: "يجب أن تكون النهاية بعد البداية",`; import `arScheduling` and add `  ...arScheduling,` after `  ...arSettings,`.

In `en-scheduling.ts` add:

```ts
export const enScheduling = {
  services: {
    title: "Services",
    subtitle:
      "The clinic's services and how long each one lasts. Prices come with the finance phase.",
    new: "New service",
    anyStatus: "Any status",
    columns: { name: "Service", duration: "Duration", status: "Status", actions: "Actions" },
    minutes: "{count} min",
    status: { active: "Active", inactive: "Inactive" },
    createTitle: "New service",
    editTitle: "Edit service",
    formSubtitle: "Names in both languages and the usual length of the service.",
    fields: {
      nameAr: "Name (Arabic)",
      nameEn: "Name (English)",
      durationMinutes: "Duration (minutes)",
      durationHint: "5 to 480 minutes",
    },
    created: "Service created",
    updated: "Service saved",
    deactivated: "Service deactivated",
    reactivated: "Service reactivated",
    deactivate: "Deactivate",
    reactivate: "Reactivate",
    deactivateTitle: "Deactivate this service?",
    deactivateBody: "It can no longer be chosen for new bookings. It can be reactivated later.",
    reactivateTitle: "Reactivate this service?",
    reactivateBody: "It can be chosen for bookings again.",
    empty: "No services yet",
    emptyBody: "Add the services your clinic offers so bookings can use their duration.",
    loadError: "Services could not be loaded",
  },
};
```

In `ar-scheduling.ts` add:

```ts
export const arScheduling = {
  services: {
    title: "الخدمات",
    subtitle: "خدمات العيادة ومدة كل خدمة. الأسعار تأتي مع مرحلة المالية.",
    new: "خدمة جديدة",
    anyStatus: "كل الحالات",
    columns: { name: "الخدمة", duration: "المدة", status: "الحالة", actions: "الإجراءات" },
    minutes: "{count} دقيقة",
    status: { active: "نشطة", inactive: "معطّلة" },
    createTitle: "خدمة جديدة",
    editTitle: "تعديل الخدمة",
    formSubtitle: "الاسم باللغتين والمدة المعتادة للخدمة.",
    fields: {
      nameAr: "الاسم (عربي)",
      nameEn: "الاسم (إنجليزي)",
      durationMinutes: "المدة (دقائق)",
      durationHint: "من 5 إلى 480 دقيقة",
    },
    created: "تم إنشاء الخدمة",
    updated: "تم حفظ الخدمة",
    deactivated: "تم تعطيل الخدمة",
    reactivated: "تمت إعادة تفعيل الخدمة",
    deactivate: "تعطيل",
    reactivate: "إعادة تفعيل",
    deactivateTitle: "تعطيل هذه الخدمة؟",
    deactivateBody: "لن يمكن اختيارها في الحجوزات الجديدة. يمكن إعادة تفعيلها لاحقًا.",
    reactivateTitle: "إعادة تفعيل هذه الخدمة؟",
    reactivateBody: "سيمكن اختيارها في الحجوزات من جديد.",
    empty: "لا توجد خدمات بعد",
    emptyBody: "أضف خدمات العيادة ليستخدم الحجز مدتها.",
    loadError: "تعذّر تحميل الخدمات",
  },
};
```

- [ ] **Step 4: Queries, badge, columns**

`services/service-queries.ts`:

```ts
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServiceListQuery } from "@eyadex/contracts/services";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const serviceKeys = { all: ["clinic", "services"] as const };

/** Typed API errors are final answers; only unknown failures are retried. */
const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

export function useServiceList(query: ServiceListQuery) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: [...serviceKeys.all, "list", query, persona.kind, persona.clinicId, persona.memberId],
    queryFn: () => api.scheduling.listServices(persona, query),
    enabled: ready && persona.kind !== "platform_admin" && Boolean(persona.clinicId),
    retry,
    placeholderData: keepPreviousData,
  });
}

export function useRefreshServices() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: serviceKeys.all });
}
```

`services/service-status-badge.tsx`:

```tsx
import { Circle } from "lucide-react";
import type { ServiceStatus } from "@eyadex/contracts/services";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n/i18n-provider";

export function ServiceStatusBadge({ status }: { status: ServiceStatus }) {
  const { t } = useI18n();
  return (
    <Badge
      variant={status === "active" ? "default" : "secondary"}
      className="gap-1.5 whitespace-nowrap"
    >
      <Circle className="size-1.5 fill-current" />
      {t(`services.status.${status}`)}
    </Badge>
  );
}
```

`services/use-service-columns.tsx`:

```tsx
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Edit3, Power, RotateCcw } from "lucide-react";
import type { ClinicService } from "@eyadex/contracts/services";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { RowActionsMenu, type RowAction } from "@/shared/table/row-actions-menu";
import { ServiceStatusBadge } from "./service-status-badge";

type Handlers = {
  mayUpdate: boolean;
  mayDeactivate: boolean;
  onEdit: (service: ClinicService) => void;
  onStatus: (service: ClinicService) => void;
};

export function useServiceColumns(h: Handlers): ColumnDef<ClinicService, unknown>[] {
  const { t, pick } = useI18n();
  const { mayUpdate, mayDeactivate, onEdit, onStatus } = h;
  return useMemo(() => {
    const cols: ColumnDef<ClinicService, unknown>[] = [
      {
        id: "name",
        header: t("services.columns.name"),
        cell: ({ row }) => (
          <div className="min-w-36">
            <div className="font-medium">{pick(row.original.nameAr, row.original.nameEn)}</div>
            <div className="text-xs text-muted-foreground">
              {pick(row.original.nameEn, row.original.nameAr)}
            </div>
          </div>
        ),
      },
      {
        id: "duration",
        header: t("services.columns.duration"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {t("services.minutes", { count: row.original.durationMinutes })}
          </span>
        ),
      },
      {
        id: "status",
        header: t("services.columns.status"),
        cell: ({ row }) => <ServiceStatusBadge status={row.original.status} />,
      },
    ];
    if (mayUpdate || mayDeactivate) {
      cols.push({
        id: "actions",
        header: () => <span className="sr-only">{t("services.columns.actions")}</span>,
        cell: ({ row }) => {
          const service = row.original;
          const actions: RowAction[] = [];
          if (mayUpdate)
            actions.push({ label: t("common.edit"), icon: Edit3, onSelect: () => onEdit(service) });
          if (mayDeactivate) {
            const active = service.status === "active";
            actions.push({
              label: t(active ? "services.deactivate" : "services.reactivate"),
              icon: active ? Power : RotateCcw,
              onSelect: () => onStatus(service),
            });
          }
          return <RowActionsMenu label={t("services.columns.actions")} actions={actions} />;
        },
      });
    }
    return cols;
  }, [t, pick, mayUpdate, mayDeactivate, onEdit, onStatus]);
}
```

- [ ] **Step 5: Form and status dialogs**

`services/service-form-dialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DEFAULT_PROVIDER_DURATION_MINUTES,
  serviceInputSchema,
  type ClinicService,
  type ServiceInput,
} from "@eyadex/contracts/services";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { NumberField, TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { useRefreshServices } from "./service-queries";

const EMPTY: ServiceInput = {
  nameAr: "",
  nameEn: "",
  durationMinutes: DEFAULT_PROVIDER_DURATION_MINUTES,
};

export function ServiceFormDialog({
  open,
  service,
  onOpenChange,
}: {
  open: boolean;
  service: ClinicService | null;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshServices();
  const form = useForm<ServiceInput>({
    resolver: zodResolver(serviceInputSchema),
    defaultValues: EMPTY,
  });
  // One key per opening of the form: a retry of the same submit replays, a new form is a new service.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (open) setIdempotencyKey(crypto.randomUUID());
    form.reset(
      service
        ? {
            nameAr: service.nameAr,
            nameEn: service.nameEn,
            durationMinutes: service.durationMinutes,
          }
        : EMPTY,
    );
  }, [open, service, form]);

  const mutation = useMutation({
    mutationFn: (input: ServiceInput) =>
      service
        ? api.scheduling.updateService(persona, service.id, input)
        : api.scheduling.createService(persona, input, idempotencyKey),
    onSuccess: () => {
      refresh();
      toast.success(t(service ? "services.updated" : "services.created"));
      onOpenChange(false);
    },
    onError: (error) => toast.error(t(`errors.${errorCodeOf(error)}`)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t(service ? "services.editTitle" : "services.createTitle")}</DialogTitle>
          <DialogDescription>{t("services.formSubtitle")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="service-form"
            className="flex flex-col gap-5 py-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <TextField
              control={form.control}
              name="nameAr"
              label={t("services.fields.nameAr")}
              dir="rtl"
            />
            <TextField
              control={form.control}
              name="nameEn"
              label={t("services.fields.nameEn")}
              dir="ltr"
            />
            <NumberField
              control={form.control}
              name="durationMinutes"
              label={t("services.fields.durationMinutes")}
              hint={t("services.fields.durationHint")}
            />
          </form>
        </Form>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="service-form" disabled={mutation.isPending}>
            {service ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`services/service-status-dialog.tsx`:

```tsx
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ClinicService } from "@eyadex/contracts/services";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { ConfirmActionDialog } from "@/shared/shell/confirm-action-dialog";
import { useRefreshServices } from "./service-queries";

export function ServiceStatusDialog({
  service,
  onClose,
}: {
  service: ClinicService | null;
  onClose: () => void;
}) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshServices();
  const active = service?.status === "active";
  const mutation = useMutation({
    mutationFn: (s: ClinicService) =>
      s.status === "active"
        ? api.scheduling.deactivateService(persona, s.id)
        : api.scheduling.reactivateService(persona, s.id),
    onSuccess: (s) => {
      refresh();
      toast.success(t(s.status === "active" ? "services.reactivated" : "services.deactivated"));
      onClose();
    },
    onError: (error) => toast.error(t(`errors.${errorCodeOf(error)}`)),
  });
  return (
    <ConfirmActionDialog
      open={Boolean(service)}
      title={t(active ? "services.deactivateTitle" : "services.reactivateTitle")}
      body={t(active ? "services.deactivateBody" : "services.reactivateBody")}
      confirmLabel={t(active ? "services.deactivate" : "services.reactivate")}
      cancelLabel={t("common.cancel")}
      pending={mutation.isPending}
      onConfirm={() => service && mutation.mutate(service)}
      onClose={onClose}
    />
  );
}
```

- [ ] **Step 6: Page, content, route**

`services/services-content.tsx`:

```tsx
import { useCallback, useState } from "react";
import { AlertCircle, ListChecks, Plus } from "lucide-react";
import { serviceStatusSchema, type ClinicService } from "@eyadex/contracts/services";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { CursorPager } from "@/shared/table/cursor-pager";
import { DataTable } from "@/shared/table/data-table";
import { FilterSelect } from "@/shared/table/filter-select";
import { useCursorPages } from "@/shared/table/use-cursor-pages";
import { ServiceFormDialog } from "./service-form-dialog";
import { useServiceList } from "./service-queries";
import { ServiceStatusDialog } from "./service-status-dialog";
import { useServiceColumns } from "./use-service-columns";

const PAGE_SIZE = 20;

export function ServicesContent() {
  const { t } = useI18n();
  const { session } = useSession();
  const pages = useCursorPages();
  const [status, setStatus] = useState<string | null>("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClinicService | null>(null);
  const [statusTarget, setStatusTarget] = useState<ClinicService | null>(null);
  const permissions = session?.permissions ?? [];
  const list = useServiceList({
    cursor: pages.cursor,
    limit: PAGE_SIZE,
    status: status ? serviceStatusSchema.parse(status) : null,
  });
  const columns = useServiceColumns({
    mayUpdate: can(permissions, "update", "services"),
    mayDeactivate: can(permissions, "deactivate", "services"),
    onEdit: useCallback((s: ClinicService) => {
      setEditing(s);
      setFormOpen(true);
    }, []),
    onStatus: useCallback((s: ClinicService) => setStatusTarget(s), []),
  });

  if (list.isError) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("services.loadError")}
        body={t(`errors.${errorCodeOf(list.error)}`)}
        action={<Button onClick={() => void list.refetch()}>{t("common.tryAgain")}</Button>}
      />
    );
  }

  const items = list.data?.items ?? [];
  return (
    <div>
      <PageHeader
        title={t("services.title")}
        subtitle={t("services.subtitle")}
        actions={
          can(permissions, "create", "services") && (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t("services.new")}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <FilterSelect
          label={t("services.columns.status")}
          value={status}
          anyLabel={t("services.anyStatus")}
          options={serviceStatusSchema.options.map((s) => ({
            value: s,
            label: t(`services.status.${s}`),
          }))}
          onChange={(value) => {
            setStatus(value);
            pages.reset();
          }}
        />
      </div>
      {!list.isLoading && items.length === 0 ? (
        <StatusPanel icon={ListChecks} title={t("services.empty")} body={t("services.emptyBody")} />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <DataTable
              columns={columns}
              data={items}
              isLoading={list.isLoading}
              stickyEndColumnId="actions"
            />
          </div>
        </div>
      )}
      <CursorPager
        count={items.length}
        total={list.data?.total ?? 0}
        canPrevious={pages.canPrevious}
        canNext={Boolean(list.data?.nextCursor)}
        onPrevious={pages.previous}
        onNext={() => pages.next(list.data?.nextCursor ?? null)}
      />
      <ServiceFormDialog
        open={formOpen}
        service={editing}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
      />
      <ServiceStatusDialog service={statusTarget} onClose={() => setStatusTarget(null)} />
    </div>
  );
}
```

`services/services-page.tsx`:

```tsx
import { RequirePermission } from "@/shared/permissions/require-permission";
import { ServicesContent } from "./services-content";

export function ServicesPage() {
  return (
    <RequirePermission resource="services">
      <ServicesContent />
    </RequirePermission>
  );
}
```

`routes/clinic.services.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { ServicesPage } from "@/services/services-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/services")({
  head: () => pageHead("Services", "The clinic's services and their durations."),
  component: ServicesPage,
});
```

- [ ] **Step 7: Regenerate the route tree and run the checks**

Run: `pnpm exec prettier --write apps/web/src/services apps/web/src/shared/i18n apps/web/src/shared/shell apps/web/src/routes && pnpm --filter @eyadex/web build && pnpm --filter @eyadex/web exec vitest run src/shared/shell src/test src/services && pnpm --filter @eyadex/web typecheck && pnpm --filter @eyadex/web lint`
Expected: the build rewrites `src/routeTree.gen.ts` with `/clinic/services`; tests PASS; typecheck and lint exit 0.

Then open the app (`pnpm dev`, mock mode), sign in as the clinic admin and check `/clinic/services` in Arabic and English at 1440px and 390px: list, empty state (filter "inactive"), create, edit, deactivate, reactivate, toasts; as the receptionist persona the menu has no Services entry and the URL shows the forbidden page.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/services apps/web/src/routes/clinic.services.tsx apps/web/src/routeTree.gen.ts apps/web/src/shared/shell/nav-items.ts apps/web/src/shared/shell/nav-items.test.ts apps/web/src/shared/i18n
git commit -m "feat(web): clinic services screen behind view:services and the appointments module

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 16: Web — the work schedules screen (`/clinic/schedules`): weekly hours per branch and time off

**Files:**

- Create: `apps/web/src/schedules/schedules-page.tsx`, `schedules-content.tsx`, `schedule-queries.ts`, `schedule-forms.ts`, `weekly-schedule-editor.tsx`, `time-off-panel.tsx`, `time-off-dialog.tsx`, `apps/web/src/routes/clinic.schedules.tsx`
- Modify: `apps/web/src/shared/i18n/en-scheduling.ts`, `ar-scheduling.ts` (`schedules` section), `apps/web/src/shared/shell/nav-items.ts` (the schedules entry), `apps/web/src/routeTree.gen.ts` (regenerated)
- Test: `apps/web/src/schedules/schedule-forms.test.ts`, `apps/web/src/shared/shell/nav-items.test.ts` (one more assertion)

**Interfaces:**

- Consumes: `ApiClient["scheduling"]`; `branchScheduleInputSchema`, `ProviderSchedule`, `TimeOffInput`, `wallMinutes` (contracts); `wallToInstant`, `instantToWall` (`@eyadex/contracts/clinic-time`); `session.clinic.timezone`.
- Produces: route `/clinic/schedules` (`SchedulesPage`, gated by `view:schedules:*`); pure helpers in `schedule-forms.ts`: `WEEKDAY_KEYS`, `type WeekRow = { key: string; weekday: number; startsAt: string; endsAt: string }`, `rowsForBranch(schedule: ProviderSchedule, branchId: string): WeekRow[]`, `toWeekInput(rows: WeekRow[]): BranchScheduleInput`, `timeOffFormSchema`, `type TimeOffForm`, `toTimeOffInput(form: TimeOffForm, timeZone: string): TimeOffInput`, `wallLabel(iso: string, timeZone: string): string`; `scheduleKeys`, `useProviders()`, `useProviderSchedule(membershipId: string | null)`, `useRefreshSchedules()`; i18n `schedules.*`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/schedules/schedule-forms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ProviderSchedule } from "@eyadex/contracts/schedules";
import { rowsForBranch, toTimeOffInput, toWeekInput, wallLabel } from "./schedule-forms";

const schedule: ProviderSchedule = {
  provider: {
    membershipId: "0190a000-0000-7000-8000-000000000001",
    fullName: "Dr A",
    defaultDurationMinutes: 20,
    allBranches: true,
    branchIds: [],
  },
  branches: [],
  shifts: [
    { branchId: "b", weekday: 1, startsAt: "00:00", endsAt: "01:00" },
    { branchId: "a", weekday: 0, startsAt: "09:00", endsAt: "13:00" },
    { branchId: "b", weekday: 0, startsAt: "20:00", endsAt: "24:00" },
  ],
  timeOff: [],
};

describe("schedule form helpers", () => {
  it("one branch's rows, in week order, keyed for React", () => {
    const rows = rowsForBranch(schedule, "b");
    expect(rows.map((r) => [r.weekday, r.startsAt, r.endsAt])).toEqual([
      [0, "20:00", "24:00"],
      [1, "00:00", "01:00"],
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("sends the rows without their keys", () => {
    expect(toWeekInput(rowsForBranch(schedule, "a"))).toEqual({
      shifts: [{ weekday: 0, startsAt: "09:00", endsAt: "13:00" }],
    });
  });

  it("time off typed in clinic wall time becomes instants; a blank note is null", () => {
    const form = {
      startDate: "2026-10-11",
      startTime: "09:00",
      endDate: "2026-10-11",
      endTime: "13:00",
      note: "  ",
    };
    expect(toTimeOffInput(form, "Asia/Kuwait")).toEqual({
      startsAt: "2026-10-11T06:00:00.000Z",
      endsAt: "2026-10-11T10:00:00.000Z",
      note: null,
    });
    expect(wallLabel("2026-10-11T06:00:00.000Z", "Asia/Kuwait")).toBe("2026-10-11 09:00");
  });
});
```

In `nav-items.test.ts` add to the test: `expect(resourceOf("/clinic/schedules")).toBe("schedules");`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @eyadex/web exec vitest run src/schedules/schedule-forms.test.ts src/shared/shell/nav-items.test.ts`
Expected: FAIL — `Failed to resolve import "./schedule-forms"` and `expected undefined to be 'schedules'`.

- [ ] **Step 3: `schedules/schedule-forms.ts`**

```ts
import { z } from "zod";
import { instantToWall, wallToInstant } from "@eyadex/contracts/clinic-time";
import {
  wallMinutes,
  type BranchScheduleInput,
  type ProviderSchedule,
  type TimeOffInput,
} from "@eyadex/contracts/schedules";

/** i18n keys of the weekdays, index = the contract's weekday (0 = Sunday). */
export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** One editable row; `key` only keeps React's list stable while rows are added and removed. */
export type WeekRow = { key: string; weekday: number; startsAt: string; endsAt: string };

export function rowsForBranch(schedule: ProviderSchedule, branchId: string): WeekRow[] {
  return schedule.shifts
    .filter((s) => s.branchId === branchId)
    .sort((a, b) => a.weekday - b.weekday || wallMinutes(a.startsAt) - wallMinutes(b.startsAt))
    .map((s) => ({
      key: crypto.randomUUID(),
      weekday: s.weekday,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
    }));
}

export function toWeekInput(rows: WeekRow[]): BranchScheduleInput {
  return { shifts: rows.map(({ weekday, startsAt, endsAt }) => ({ weekday, startsAt, endsAt })) };
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.dateRequired");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "validation.time");

/** The dialog's fields: clinic wall-clock dates and times (the API takes instants). */
export const timeOffFormSchema = z.object({
  startDate: date,
  startTime: time,
  endDate: date,
  endTime: time,
  note: z.string().max(200, "validation.tooLong"),
});
export type TimeOffForm = z.infer<typeof timeOffFormSchema>;

export function toTimeOffInput(form: TimeOffForm, timeZone: string): TimeOffInput {
  return {
    startsAt: wallToInstant(form.startDate, form.startTime, timeZone),
    endsAt: wallToInstant(form.endDate, form.endTime, timeZone),
    note: form.note.trim() === "" ? null : form.note.trim(),
  };
}

/** `YYYY-MM-DD HH:MM` in the clinic's zone. */
export function wallLabel(iso: string, timeZone: string): string {
  const { date: d, time: t } = instantToWall(iso, timeZone);
  return `${d} ${t}`;
}
```

- [ ] **Step 4: Strings**

Append to `enScheduling` (after `services`):

```ts
  schedules: {
    title: "Work schedules",
    subtitle: "Weekly working hours per branch and time off, in the clinic's time zone ({zone}).",
    provider: "Provider",
    pickProvider: "Choose a provider",
    noProviders: "Nobody accepts appointments yet",
    noProvidersBody: "Turn on \"Accepts appointments\" for a user from the Users screen.",
    branch: "Branch",
    weekTitle: "Weekly hours",
    weekHint: "A shift that ends at 24:00 continues into the next day's shift that starts at 00:00.",
    weekday: "Day",
    startsAt: "From",
    endsAt: "To",
    addShift: "Add hours",
    removeShift: "Remove these hours",
    saveWeek: "Save week",
    saved: "Week saved",
    noShifts: "No working hours in this branch",
    weekdays: {
      sun: "Sunday",
      mon: "Monday",
      tue: "Tuesday",
      wed: "Wednesday",
      thu: "Thursday",
      fri: "Friday",
      sat: "Saturday",
    },
    timeOffTitle: "Time off",
    addTimeOff: "Add time off",
    noTimeOff: "No upcoming time off",
    cancelTimeOff: "Cancel time off",
    cancelTitle: "Cancel this time off?",
    cancelBody: "The provider can be booked again in this period.",
    timeOffAdded: "Time off added",
    timeOffCancelled: "Time off cancelled",
    fields: {
      startDate: "Start date",
      startTime: "Start time",
      endDate: "End date",
      endTime: "End time",
      note: "Note (optional)",
    },
    loadError: "The schedule could not be loaded",
  },
```

and to `arScheduling`:

```ts
  schedules: {
    title: "جداول العمل",
    subtitle: "ساعات العمل الأسبوعية لكل فرع والإجازات، بتوقيت العيادة ({zone}).",
    provider: "مقدّم الخدمة",
    pickProvider: "اختر مقدّم الخدمة",
    noProviders: "لا يوجد من يستقبل المواعيد بعد",
    noProvidersBody: "فعّل «يستقبل المواعيد» لمستخدم من شاشة المستخدمين.",
    branch: "الفرع",
    weekTitle: "ساعات العمل الأسبوعية",
    weekHint: "الفترة التي تنتهي عند 24:00 تتصل بفترة اليوم التالي التي تبدأ عند 00:00.",
    weekday: "اليوم",
    startsAt: "من",
    endsAt: "إلى",
    addShift: "إضافة فترة",
    removeShift: "حذف هذه الفترة",
    saveWeek: "حفظ الأسبوع",
    saved: "تم حفظ الأسبوع",
    noShifts: "لا توجد ساعات عمل في هذا الفرع",
    weekdays: {
      sun: "الأحد",
      mon: "الإثنين",
      tue: "الثلاثاء",
      wed: "الأربعاء",
      thu: "الخميس",
      fri: "الجمعة",
      sat: "السبت",
    },
    timeOffTitle: "الإجازات",
    addTimeOff: "إضافة إجازة",
    noTimeOff: "لا توجد إجازات قادمة",
    cancelTimeOff: "إلغاء الإجازة",
    cancelTitle: "إلغاء هذه الإجازة؟",
    cancelBody: "سيصبح الحجز مع مقدّم الخدمة متاحًا في هذه الفترة من جديد.",
    timeOffAdded: "تمت إضافة الإجازة",
    timeOffCancelled: "تم إلغاء الإجازة",
    fields: {
      startDate: "تاريخ البداية",
      startTime: "وقت البداية",
      endDate: "تاريخ النهاية",
      endTime: "وقت النهاية",
      note: "ملاحظة (اختياري)",
    },
    loadError: "تعذّر تحميل الجدول",
  },
```

- [ ] **Step 5: Queries**

`schedules/schedule-queries.ts`:

```ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const scheduleKeys = { all: ["clinic", "schedules"] as const };

const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

function usePersonaKey() {
  const { persona, ready } = usePersona();
  return {
    persona,
    enabled: ready && persona.kind !== "platform_admin" && Boolean(persona.clinicId),
    key: [persona.kind, persona.clinicId, persona.memberId] as const,
  };
}

export function useProviders() {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...scheduleKeys.all, "providers", ...key],
    queryFn: () => api.scheduling.listProviders(persona),
    enabled,
    retry,
  });
}

export function useProviderSchedule(membershipId: string | null) {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...scheduleKeys.all, "provider", membershipId, ...key],
    queryFn: () => api.scheduling.getProviderSchedule(persona, membershipId ?? ""),
    enabled: enabled && membershipId !== null,
    retry,
  });
}

export function useRefreshSchedules() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
}
```

- [ ] **Step 6: The weekly editor**

`schedules/weekly-schedule-editor.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { branchScheduleInputSchema, type ProviderSchedule } from "@eyadex/contracts/schedules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { WEEKDAY_KEYS, rowsForBranch, toWeekInput, type WeekRow } from "./schedule-forms";
import { useRefreshSchedules } from "./schedule-queries";

type Props = { schedule: ProviderSchedule; branchId: string; mayEdit: boolean };

export function WeeklyScheduleEditor({ schedule, branchId, mayEdit }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t, tDynamic } = useI18n();
  const refresh = useRefreshSchedules();
  const [rows, setRows] = useState<WeekRow[]>(() => rowsForBranch(schedule, branchId));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRows(rowsForBranch(schedule, branchId));
    setError(null);
  }, [schedule, branchId]);

  const mutation = useMutation({
    mutationFn: () =>
      api.scheduling.replaceBranchSchedule(
        persona,
        schedule.provider.membershipId,
        branchId,
        toWeekInput(rows),
      ),
    onSuccess: () => {
      refresh();
      toast.success(t("schedules.saved"));
    },
    onError: (e) => setError(t(`errors.${errorCodeOf(e)}`)),
  });

  const edit = (key: string, patch: Partial<WeekRow>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const save = () => {
    const parsed = branchScheduleInputSchema.safeParse(toWeekInput(rows));
    if (!parsed.success) {
      setError(tDynamic(parsed.error.issues[0]?.message ?? "errors.validation"));
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div>
        <h2 className="font-semibold">{t("schedules.weekTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("schedules.weekHint")}</p>
      </div>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("schedules.noShifts")}</p>
      )}
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
          <Select
            value={String(row.weekday)}
            disabled={!mayEdit}
            onValueChange={(v) => edit(row.key, { weekday: Number(v) })}
          >
            <SelectTrigger aria-label={t("schedules.weekday")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAY_KEYS.map((day, index) => (
                <SelectItem key={day} value={String(index)}>
                  {t(`schedules.weekdays.${day}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="w-24"
            dir="ltr"
            inputMode="numeric"
            placeholder="09:00"
            aria-label={t("schedules.startsAt")}
            disabled={!mayEdit}
            value={row.startsAt}
            onChange={(e) => edit(row.key, { startsAt: e.target.value })}
          />
          <Input
            className="w-24"
            dir="ltr"
            inputMode="numeric"
            placeholder="13:00"
            aria-label={t("schedules.endsAt")}
            disabled={!mayEdit}
            value={row.endsAt}
            onChange={(e) => edit(row.key, { endsAt: e.target.value })}
          />
          {mayEdit && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("schedules.removeShift")}
              onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {mayEdit && (
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setRows((current) => [
                ...current,
                { key: crypto.randomUUID(), weekday: 0, startsAt: "09:00", endsAt: "13:00" },
              ])
            }
          >
            <Plus className="size-4" />
            {t("schedules.addShift")}
          </Button>
          <Button onClick={save} disabled={mutation.isPending}>
            {t("schedules.saveWeek")}
          </Button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Time off panel and dialog**

`schedules/time-off-dialog.tsx`:

```tsx
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { timeOffFormSchema, toTimeOffInput, type TimeOffForm } from "./schedule-forms";
import { useRefreshSchedules } from "./schedule-queries";

const EMPTY: TimeOffForm = {
  startDate: "",
  startTime: "08:00",
  endDate: "",
  endTime: "20:00",
  note: "",
};

type Props = { membershipId: string | null; timeZone: string; onClose: () => void };

export function TimeOffDialog({ membershipId, timeZone, onClose }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshSchedules();
  const form = useForm<TimeOffForm>({
    resolver: zodResolver(timeOffFormSchema),
    defaultValues: EMPTY,
  });
  useEffect(() => form.reset(EMPTY), [membershipId, form]);
  const mutation = useMutation({
    mutationFn: (values: TimeOffForm) =>
      api.scheduling.addTimeOff(persona, membershipId ?? "", toTimeOffInput(values, timeZone)),
    onSuccess: () => {
      refresh();
      toast.success(t("schedules.timeOffAdded"));
      onClose();
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  return (
    <Dialog open={membershipId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("schedules.addTimeOff")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            id="time-off-form"
            className="grid grid-cols-2 gap-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <TextField
              control={form.control}
              name="startDate"
              type="date"
              label={t("schedules.fields.startDate")}
            />
            <TextField
              control={form.control}
              name="startTime"
              dir="ltr"
              label={t("schedules.fields.startTime")}
            />
            <TextField
              control={form.control}
              name="endDate"
              type="date"
              label={t("schedules.fields.endDate")}
            />
            <TextField
              control={form.control}
              name="endTime"
              dir="ltr"
              label={t("schedules.fields.endTime")}
            />
            <div className="col-span-2">
              <TextField control={form.control} name="note" label={t("schedules.fields.note")} />
            </div>
          </form>
        </Form>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="time-off-form" disabled={mutation.isPending}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`schedules/time-off-panel.tsx`:

```tsx
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { ProviderSchedule, TimeOff } from "@eyadex/contracts/schedules";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { ConfirmActionDialog } from "@/shared/shell/confirm-action-dialog";
import { wallLabel } from "./schedule-forms";
import { useRefreshSchedules } from "./schedule-queries";
import { TimeOffDialog } from "./time-off-dialog";

type Props = { schedule: ProviderSchedule; timeZone: string; mayEdit: boolean };

export function TimeOffPanel({ schedule, timeZone, mayEdit }: Props) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const refresh = useRefreshSchedules();
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<TimeOff | null>(null);
  const membershipId = schedule.provider.membershipId;
  const cancel = useMutation({
    mutationFn: (off: TimeOff) => api.scheduling.cancelTimeOff(persona, membershipId, off.id),
    onSuccess: () => {
      refresh();
      toast.success(t("schedules.timeOffCancelled"));
      setTarget(null);
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t("schedules.timeOffTitle")}</h2>
        {mayEdit && (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t("schedules.addTimeOff")}
          </Button>
        )}
      </div>
      {schedule.timeOff.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("schedules.noTimeOff")}</p>
      )}
      <ul className="flex flex-col gap-2">
        {schedule.timeOff.map((off) => (
          <li
            key={off.id}
            className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
          >
            <div>
              <div dir="ltr" className="text-start font-medium">
                {wallLabel(off.startsAt, timeZone)} → {wallLabel(off.endsAt, timeZone)}
              </div>
              {off.note && <div className="text-muted-foreground">{off.note}</div>}
            </div>
            {mayEdit && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("schedules.cancelTimeOff")}
                onClick={() => setTarget(off)}
              >
                <X className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <TimeOffDialog
        membershipId={adding ? membershipId : null}
        timeZone={timeZone}
        onClose={() => setAdding(false)}
      />
      <ConfirmActionDialog
        open={target !== null}
        title={t("schedules.cancelTitle")}
        body={t("schedules.cancelBody")}
        confirmLabel={t("schedules.cancelTimeOff")}
        cancelLabel={t("common.cancel")}
        pending={cancel.isPending}
        onConfirm={() => target && cancel.mutate(target)}
        onClose={() => setTarget(null)}
      />
    </section>
  );
}
```

- [ ] **Step 8: Content, page, route**

`schedules/schedules-content.tsx`:

```tsx
import { useEffect, useState } from "react";
import { AlertCircle, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { FilterSelect } from "@/shared/table/filter-select";
import { useProviderSchedule, useProviders } from "./schedule-queries";
import { TimeOffPanel } from "./time-off-panel";
import { WeeklyScheduleEditor } from "./weekly-schedule-editor";

export function SchedulesContent() {
  const { t, pick } = useI18n();
  const { session } = useSession();
  const permissions = session?.permissions ?? [];
  const timeZone = session?.clinic?.timezone ?? "Asia/Kuwait";
  const providers = useProviders();
  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const schedule = useProviderSchedule(membershipId);
  useEffect(() => {
    if (membershipId === null && providers.data?.[0])
      setMembershipId(providers.data[0].membershipId);
  }, [providers.data, membershipId]);
  useEffect(() => {
    const branches = schedule.data?.branches ?? [];
    if (!branches.some((b) => b.id === branchId)) setBranchId(branches[0]?.id ?? null);
  }, [schedule.data, branchId]);

  const failed = providers.error ?? schedule.error;
  if (failed) {
    return (
      <StatusPanel
        icon={AlertCircle}
        title={t("schedules.loadError")}
        body={t(`errors.${errorCodeOf(failed)}`)}
        action={<Button onClick={() => void providers.refetch()}>{t("common.tryAgain")}</Button>}
      />
    );
  }
  const header = (
    <PageHeader
      title={t("schedules.title")}
      subtitle={t("schedules.subtitle", { zone: timeZone })}
    />
  );
  if (providers.isLoading) return <LoadingBlock />;
  if ((providers.data ?? []).length === 0) {
    return (
      <div>
        {header}
        <StatusPanel
          icon={CalendarClock}
          title={t("schedules.noProviders")}
          body={t("schedules.noProvidersBody")}
        />
      </div>
    );
  }
  return (
    <div>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <FilterSelect
          label={t("schedules.provider")}
          value={membershipId}
          anyLabel={t("schedules.pickProvider")}
          options={(providers.data ?? []).map((p) => ({
            value: p.membershipId,
            label: p.fullName,
          }))}
          onChange={setMembershipId}
        />
        <FilterSelect
          label={t("schedules.branch")}
          value={branchId}
          anyLabel={t("schedules.branch")}
          options={(schedule.data?.branches ?? []).map((b) => ({
            value: b.id,
            label: pick(b.nameAr, b.nameEn),
          }))}
          onChange={setBranchId}
        />
      </div>
      {schedule.isLoading && <LoadingBlock />}
      {schedule.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          {branchId && (
            <WeeklyScheduleEditor
              schedule={schedule.data}
              branchId={branchId}
              mayEdit={can(permissions, "update", "schedules")}
            />
          )}
          <TimeOffPanel
            schedule={schedule.data}
            timeZone={timeZone}
            mayEdit={permissions.includes("update:schedules:clinic")}
          />
        </div>
      )}
    </div>
  );
}
```

`schedules/schedules-page.tsx`:

```tsx
import { RequirePermission } from "@/shared/permissions/require-permission";
import { SchedulesContent } from "./schedules-content";

export function SchedulesPage() {
  return (
    <RequirePermission resource="schedules">
      <SchedulesContent />
    </RequirePermission>
  );
}
```

`routes/clinic.schedules.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { SchedulesPage } from "@/schedules/schedules-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/schedules")({
  head: () => pageHead("Work schedules", "Weekly working hours and time off per provider."),
  component: SchedulesPage,
});
```

(`permissions.includes("update:schedules:clinic")` mirrors the time-off routes' key exactly: a branch-scope editor cannot add time off, the API refuses it too.)

`nav-items.ts`: add `CalendarClock` to the lucide import, `| "/clinic/schedules"` to `NavPath`, and after the services entry:

```ts
  { to: "/clinic/schedules", label: "nav.schedules", icon: CalendarClock, resource: "schedules" },
```

- [ ] **Step 9: Regenerate, test, look**

Run: `pnpm exec prettier --write apps/web/src/schedules apps/web/src/shared/i18n apps/web/src/shared/shell apps/web/src/routes && pnpm --filter @eyadex/web build && pnpm --filter @eyadex/web exec vitest run src/schedules src/shared/shell src/test && pnpm --filter @eyadex/web typecheck && pnpm --filter @eyadex/web lint`
Expected: the build adds `/clinic/schedules` to `routeTree.gen.ts`; tests PASS; typecheck and lint exit 0.

Then in `pnpm dev` (mock), ar + en, 1440px and 390px: the admin picks the seeded doctor, edits the week (add a Sunday 20:00–24:00 and a Monday 00:00–01:00 row, save), sees the overlap error when two rows overlap, adds and cancels a time off; the receptionist persona has no Schedules menu entry.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/schedules apps/web/src/routes/clinic.schedules.tsx apps/web/src/routeTree.gen.ts apps/web/src/shared/i18n apps/web/src/shared/shell
git commit -m "feat(web): work schedules screen - weekly hours per branch and time off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 17: Web — booking settings on the user editor (D-1, D-15)

**Files:**

- Create: `apps/web/src/users/booking-access.ts`, `apps/web/src/users/booking-profile-dialog.tsx`
- Modify: `apps/web/src/users/use-user-columns.tsx` (one handler, one action), `apps/web/src/users/users-tab.tsx` (state + dialog), `apps/web/src/shared/i18n/en-scheduling.ts`, `ar-scheduling.ts` (`bookingProfile` section)
- Test: `apps/web/src/users/booking-access.test.ts`

**Interfaces:**

- Consumes: `ApiClient["scheduling"].getBookingProfile / setBookingProfile`; `bookingProfileInputSchema`; `session.features.appointments`.
- Produces: `mayEditBooking(session: Pick<SessionContext, "permissions" | "features">): boolean`; `BookingProfileDialog({ user, onClose })`; row action "Booking settings"; i18n `bookingProfile.*`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/users/booking-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mayEditBooking } from "./booking-access";

const on = { patients: true, appointments: true };
const off = { patients: true, appointments: false };

describe("booking settings on the user editor", () => {
  it("need update:users and the appointments module — permissions only, never a role", () => {
    expect(mayEditBooking({ permissions: ["update:users:clinic"], features: on })).toBe(true);
    expect(mayEditBooking({ permissions: ["update:users:clinic"], features: off })).toBe(false);
    expect(mayEditBooking({ permissions: ["view:users:clinic"], features: on })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @eyadex/web exec vitest run src/users/booking-access.test.ts`
Expected: FAIL — `Failed to resolve import "./booking-access"`.

- [ ] **Step 3: `users/booking-access.ts`**

```ts
import type { SessionContext } from "@eyadex/contracts/session";
import { can } from "@/shared/permissions/can";

/** Hiding the action is UX only: the API refuses without update:users:clinic or with the module off. */
export function mayEditBooking(session: Pick<SessionContext, "permissions" | "features">): boolean {
  return session.features.appointments && can(session.permissions, "update", "users");
}
```

- [ ] **Step 4: Strings**

Append to `enScheduling`:

```ts
  bookingProfile: {
    action: "Booking settings",
    title: "Booking settings",
    subtitle: "Whether {name} can be booked, and how long a booking without a service lasts.",
    accepts: "Accepts appointments",
    acceptsHint: "Shown in the booking dialog and on the work schedules screen.",
    duration: "Default duration (minutes)",
    durationHint: "5 to 480 minutes",
    saved: "Booking settings saved",
  },
```

and to `arScheduling`:

```ts
  bookingProfile: {
    action: "إعدادات الحجز",
    title: "إعدادات الحجز",
    subtitle: "هل يمكن حجز موعد مع {name}، وكم تستغرق الزيارة التي ليست لها خدمة.",
    accepts: "يستقبل المواعيد",
    acceptsHint: "يظهر في نافذة الحجز وفي شاشة جداول العمل.",
    duration: "المدة الافتراضية (دقائق)",
    durationHint: "من 5 إلى 480 دقيقة",
    saved: "تم حفظ إعدادات الحجز",
  },
```

- [ ] **Step 5: `users/booking-profile-dialog.tsx`**

```tsx
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DEFAULT_PROVIDER_DURATION_MINUTES,
  bookingProfileInputSchema,
  type BookingProfileInput,
} from "@eyadex/contracts/services";
import type { MembershipUserView } from "@eyadex/contracts/users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { NumberField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";

const DEFAULTS: BookingProfileInput = {
  acceptsAppointments: false,
  defaultDurationMinutes: DEFAULT_PROVIDER_DURATION_MINUTES,
};

export function BookingProfileDialog({
  user,
  onClose,
}: {
  user: MembershipUserView | null;
  onClose: () => void;
}) {
  const api = useApi();
  const { persona } = usePersona();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const queryKey = ["clinic", "users", "booking", user?.id, persona.clinicId] as const;
  const profile = useQuery({
    queryKey,
    queryFn: () => api.scheduling.getBookingProfile(persona, user?.id ?? ""),
    enabled: user !== null,
  });
  const form = useForm<BookingProfileInput>({
    resolver: zodResolver(bookingProfileInputSchema),
    defaultValues: DEFAULTS,
  });
  useEffect(() => {
    if (profile.data) {
      const { acceptsAppointments, defaultDurationMinutes } = profile.data;
      form.reset({ acceptsAppointments, defaultDurationMinutes });
    }
  }, [profile.data, form]);
  const mutation = useMutation({
    mutationFn: (input: BookingProfileInput) =>
      api.scheduling.setBookingProfile(persona, user?.id ?? "", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["clinic", "schedules"] });
      toast.success(t("bookingProfile.saved"));
      onClose();
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t("bookingProfile.title")}</DialogTitle>
          <DialogDescription>
            {t("bookingProfile.subtitle", { name: user?.fullName ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="booking-profile-form"
            className="flex flex-col gap-5"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <FormField
              control={form.control}
              name="acceptsAppointments"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <div>
                    <FormLabel>{t("bookingProfile.accepts")}</FormLabel>
                    <FormDescription>{t("bookingProfile.acceptsHint")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <NumberField
              control={form.control}
              name="defaultDurationMinutes"
              label={t("bookingProfile.duration")}
              hint={t("bookingProfile.durationHint")}
            />
          </form>
        </Form>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="booking-profile-form"
            disabled={mutation.isPending || profile.isLoading}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: The row action**

`use-user-columns.tsx`: add `CalendarClock` to the lucide import; add `mayBook: boolean;` and `onBooking: (u: MembershipUserView) => void;` to `Handlers`; destructure them; inside `if (mayUpdate) { … }` after the branches action:

```ts
if (mayBook) {
  actions.push({
    label: t("bookingProfile.action"),
    icon: CalendarClock,
    onSelect: () => onBooking(u),
  });
}
```

and add `mayBook, onBooking` to the `useMemo` dependency list.

`users-tab.tsx`: `import { BookingProfileDialog } from "./booking-profile-dialog";`, `import { mayEditBooking } from "./booking-access";`, add `const [bookingTarget, setBookingTarget] = useState<MembershipUserView | null>(null);`, pass to `useUserColumns`:

```ts
    mayBook: session ? mayEditBooking(session) : false,
    onBooking: useCallback((u: MembershipUserView) => setBookingTarget(u), []),
```

and render after `<UserStatusDialog … />`:

```tsx
<BookingProfileDialog user={bookingTarget} onClose={() => setBookingTarget(null)} />
```

- [ ] **Step 7: Run the checks**

Run: `pnpm exec prettier --write apps/web/src/users apps/web/src/shared/i18n && pnpm --filter @eyadex/web exec vitest run src/users && pnpm --filter @eyadex/web typecheck && pnpm --filter @eyadex/web lint`
Expected: PASS; typecheck and lint exit 0. In `pnpm dev` (mock), ar + en, 1440px and 390px: the admin opens a user's "Booking settings", turns "Accepts appointments" on with 30 minutes, saves, and the user appears in the Schedules provider list; with the module switched off on the platform clinic page, the action disappears.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/users apps/web/src/shared/i18n
git commit -m "feat(web): booking settings on the user editor (accepts appointments, default duration)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 18: ADR-0026, architecture rules, roadmap

**Files:**

- Create: `docs/adr/0026-appointments-model.md`
- Modify: `CLAUDE.architecture.md` §2.2 (table + the exception sentence) and §3 (deletable tables), `apps/api/AGENTS.md` (one rule line), `roadmap.md` (new section)

**Interfaces:**

- Consumes: every decision taken in Tasks 1–17.
- Produces: the decision record later slices (A2–A4) cite: the provider lock key, the replace semantics, the `own` tiering, the open questions.

- [ ] **Step 1: Write `docs/adr/0026-appointments-model.md`**

```markdown
# ADR-0026 — Appointments model, the provider lock and the `own` scope

- Status: accepted for slice A1 (design owner-approved 2026-10-09, `docs/specs/appointments-design.md`)
- Date: 2026-10-09

## Context

Post-MVP phase 1 adds appointments (PRD §8.3 item 1). The owner settled D-1..D-15. Slice A1 ships the
configuration the bookings of A2 will read: the module flag, its permission keys, the services list, a
member's booking profile, weekly schedules and time off. This record fixes what A1 decides and what A2–A4
inherit.

## Decision

### 1. Module, tables, flag

- `appointments` is a clinic module (D-9) like `patients`: `clinic_features` and `permissions.module` accept it
  (0042). Existing clinics have no row, so the module is off for them until the platform switches it on
  (ADR-0010). A new clinic gets one row per `moduleSchema` option; `appointments` defaults to off in the create
  request until the platform's default-modules setting (SQL 0041, in flight) decides it (§9).
- 0042 adds `clinic_services`, `provider_schedules`, `provider_time_off` (forced RLS, PK `(clinic_id, id)`,
  `eyadex_app` only, `REVOKE ALL` from `eyadex_platform`) and `memberships.accepts_appointments`,
  `memberships.default_duration_minutes` (D-1, D-15). The `appointments` table is A2's.

### 2. Module boundaries

`apps/api/src/modules/appointments` owns services, schedules and time off. It reads members only through its
`ProviderDirectory` port (identity's `PgProviderDirectory`) and branches through `SchedulingBranchReader`
(tenancy's `PgFilingBranches`); both are bound in `appointments.module.ts`, the exception CLAUDE.architecture.md
§2.2 already grants platform and audit. The booking profile lives on the membership, so identity owns
`GET/PUT /v1/users/:id/booking-profile`; the routes are gated by the `appointments` flag.

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
  editor's reach. Overlaps are refused across all the provider's branches (one person, one place).
- D-14 lives in `coversWallInterval` (`@eyadex/contracts/schedules`): back-to-back rows of one branch join, also
  across midnight and from Saturday 24:00 into Sunday 00:00. A2's booking check calls it.
- The drift test maps Drizzle's `time` to `time without time zone` (information_schema's spelling).

### 5. Booking profile (D-1, D-15)

`accepts_appointments` (default false) and `default_duration_minutes` (5–480, default 20) on the membership,
changed under `update:users:clinic` with the users path's locks, then the provider lock; one `user.booking_changed`
row (entity `user`). Only an active member with the flag on has a schedule to edit (`provider_not_bookable`).

### 6. Permissions

- Catalogue (spec §3): `view|create|update|overbook:appointments` (view also `own`), `view|create|update|deactivate:services:clinic`,
  `view|update:schedules` (clinic, branch) — 17 keys, module `appointments`.
- `own` is the narrowest scope: `grantFor` grants it from `own`, `branch` or `clinic` keys, and an `own` key grants
  nothing wider. A3 evaluates it in the appointments and patients queries; `view:patients:own` is added in A3 with
  that query, so no A1 role can hold a key that would silently narrow patient access before it works.
- The locked Clinic Admin holds every clinic-scope key (PRD §5.3 "everything"). New clinics get them from
  `SYSTEM_ROLES`. Existing clinics' locked admin roles get the module's 10 clinic keys from 0042's backfill: a
  locked role refuses every write (ADR-0017), so otherwise no existing clinic could ever open services or
  schedules. No other existing role changes. TODO(spec): spec §3 says "existing clinics' roles are not changed by a
  migration" — confirm the locked admin is the intended exception.
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
clinic-log only: they are not in `platformAuditEntitySchema`, so the platform audit API never returns them
(TODO(spec): the platform sees other administrative clinic rows; staff absence is kept from it).

### 9. Merge with the default-modules work (0041)

Whichever PR lands second resolves, in its merge commit (never a rebase): `createClinicRequestSchema.modules` and
`platformClinicDetailSchema.modules` carry both modules; the default-modules setting is typed from `moduleSchema`
with `appointments: true` as its stored default (D-9); `insertNewClinic` keeps one row per module and takes its
values from 0041's defaulting; a CHECK listing module names in 0041 gains `'appointments'` in a new SQL file.

### 10. Services (D-12)

Clinic-level list, names unique per language ignoring case and spaces (inactive ones included, like roles), 5–480
minutes, deactivated never deleted, create takes an `Idempotency-Key` (as branches, roles, patients).

## Consequences

- A2 books against these tables under the same lock and calls `coversWallInterval` for D-6/D-14.
- CLAUDE.architecture.md §2.2 lists the module; §3 lists `provider_schedules` as the one deletable configuration table.
- Production: 0042's admin backfill must run as the migration owner (superuser); it refuses otherwise.
```

- [ ] **Step 2: Architecture rules, AGENTS, roadmap**

`CLAUDE.architecture.md` §2.2 table — add after the `patients` row:

```markdown
| `appointments` | services, booking-profile reads, weekly schedules, time off (A1); appointments (A2) — ADR-0026 | `tenancy`, `identity` (index.ts: guards, request types; `PgProviderDirectory` bound in `appointments.module.ts`) |
```

and in the sentence after the table change `(platform, audit — ADR-0019 §10)` to `(platform, audit — ADR-0019 §10; appointments — ADR-0026)`.

§3 — change the "Link rows" bullet's first sentence to: `**Link rows** (\`membership_branches\`, \`role_permissions\`, \`invitation_branches\`) and **\`provider_schedules\`** (0042, ADR-0026: a provider's week in one branch is configuration, replaced whole under the provider lock and audited) are the only deletable tables (\`0016\`, \`0042\`); every entity is deactivated or archived instead.`

`apps/api/AGENTS.md` — append:

```markdown
- Appointments (ADR-0026): the module reads members only through `ProviderDirectory` (identity's `PgProviderDirectory`) and branches through `SchedulingBranchReader`, both bound in `appointments.module.ts`; every write about one provider (booking profile, weekly schedule, time off, and from A2 the bookings) holds `lockProvider` (`appointments:<clinicId>:<membershipId>`), after the `roles:` / `users:` locks when it needs those — so an overlap is always decided on rows no other transaction can change.
```

`roadmap.md` — append:

```markdown
## Appointments (post-MVP phase 1, `docs/specs/appointments-design.md`)

- [x] Slice A1: `appointments` module flag, catalogue keys (`overbook`, `own`), services, booking profile on the user editor, weekly schedules per branch (D-14 midnight continuity), time off; admin keys backfilled for existing clinics (ADR-0026, SQL 0042)
- [ ] Slice A2: appointments — book, reschedule, status, cancel, quick file, overbook; branch day view + booking dialog
- [ ] Slice A3: the `own` scope on appointments and patients; new-clinic doctor and receptionist defaults
- [ ] Slice A4: provider week, month, today's queue
```

- [ ] **Step 3: Format and check the docs**

Run: `pnpm exec prettier --write docs/adr/0026-appointments-model.md CLAUDE.architecture.md apps/api/AGENTS.md roadmap.md && pnpm format:check`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0026-appointments-model.md CLAUDE.architecture.md apps/api/AGENTS.md roadmap.md
git commit -m "docs(adr): ADR-0026 appointments model, provider lock, own scope; A1 on the roadmap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 19: Delivery gates

**Files:** none new (fixes go to the file that failed, with a failing-first test).

**Interfaces:** the whole slice.

- [ ] **Step 1: Workspace gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check`
Expected: all exit 0 (lint 0 errors).

- [ ] **Step 2: Database gates**

Run: `MSYS_NO_PATHCONV=1 sh /f/Dev/Worktrees/eyadex/dbcheck.sh eyadex-pg-a1 /f/Dev/Worktrees/eyadex/appt-spec && MSYS_NO_PATHCONV=1 docker exec -e PGUSER=eyadex_owner -e PGPASSWORD=ci-only-owner -e PGHOST=127.0.0.1 -e PGDATABASE=postgres eyadex-pg-a1 sh -c 'cd /work && sh db/tests/admin-keys-backfill.sh && sh db/tests/platform-backfill.sh'`
Expected: `DBCHECK OK`, `admin-keys-backfill: all passed`, `platform-backfill: all passed`.

- [ ] **Step 3: `test:db` of every package the slice touches**

Run (with the `test:db` env of the Global Constraints exported):

```bash
pnpm --filter @eyadex/db... --filter @eyadex/auth... --filter "@eyadex/api^..." --filter "@eyadex/worker^..." build
pnpm --filter @eyadex/db test:db
pnpm --filter @eyadex/api test:db
pnpm --filter @eyadex/worker test:db
pnpm --filter @eyadex/auth test:db
```

Expected: all PASS (`permission-catalogue.db.spec.ts` now sees the 17 rows; the worker's and auth's suites are run because 0042 changes `memberships` and `permissions`, which their fixtures insert into).

- [ ] **Step 4: Deployed build**

Run: `NITRO_PRESET=node-server pnpm build:all`
Expected: exits 0.

- [ ] **Step 5: Failing-first proof for the key rules**

For each of: the cross-branch overlap (`schedules.db.spec.ts` "refuses overlapping rows…"), the provider lock race (D-13 test), the module flag on `/v1/services`, and the RLS probes of `rls-isolation.sql` — temporarily revert the guarding line (`decideBranchSchedule`'s `others` filter → `[]`; `lockProvider` call → removed; `@RequiresFeature("appointments")` → removed; one `FORCE ROW LEVEL SECURITY` → removed), run the test, see it FAIL, restore with `git checkout -- <file>`, see it PASS. Record the four results for the report.

- [ ] **Step 6: Persona walk-through (CLAUDE.md §2.1)**

`pnpm dev` (mock) and the `http` build against the local API: ar + en, 1440px and 390px, for the clinic admin (everything), the receptionist (no services/schedules menu, no booking action), a custom role with `view:schedules:branch` + `update:schedules:branch` (only its branches; no time-off buttons), and the platform admin (Modules tab shows both switches; no services/schedules data anywhere). Loading, empty and error states on both new screens.

- [ ] **Step 7: Commit any fix and stop**

```bash
git status --short
```

Expected: clean, or only files of a fix that is committed with its own conventional message ending in the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line. Do not push; the orchestrator opens the PR and runs Codex/CI.

---

## Self-review — spec A1 coverage

| Spec requirement (A1)                                                                                 | Task                                                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| D-1 "accepts appointments" per member, never from a role name                                         | 5 (column), 10 (API), 14 (mock), 17 (UI)                                  |
| D-2/D-15 provider default duration 20, 5–480                                                          | 3 (bounds), 5 (CHECK), 10, 17                                             |
| D-6 weekly schedule per provider per branch, wall-clock; time off                                     | 3, 5, 9, 12, 14, 16                                                       |
| D-9 module flag, platform switch, new-clinic default                                                  | 1, 5, 8; merge note in File Structure + ADR §9                            |
| D-12 services list (name ar/en, duration, active), admin-managed                                      | 3, 5, 11, 14, 15                                                          |
| D-13 per-provider advisory lock (recorded now, used by A2)                                            | 10 (`lockProvider`), 12 (race test), 18 (ADR §3)                          |
| D-14 back-to-back rows across midnight are one shift                                                  | 3 (`coversWallInterval` + tests), 9, 12 (24:00 accepted)                  |
| §2 tables, PK, RLS forced, indexes from `clinic_id`, FK indexes, `eyadex_app` only, no platform grant | 5, 6                                                                      |
| §2 no hard deletes (services deactivated, schedules replaced)                                         | 5, 11, 12 (+ time off cancelled, ADR §7)                                  |
| §3 catalogue additions incl. `own` (catalogue only; queries A3)                                       | 2, 7                                                                      |
| §3 existing roles unchanged; new-clinic roles                                                         | 7 (admin), 5 (admin backfill — open question), A3 for doctor/receptionist |
| §4 rule 1 bookable = active + flag                                                                    | 9, 12, 14                                                                 |
| §4 rule 9 one audit row per change, no phone/civil ID                                                 | 4, 10, 11, 12, 14                                                         |
| §4 rule 10 module off ⇒ `module_disabled` on services/schedules routes                                | 10, 11, 12, 14                                                            |
| §5 settings screens: services; user editor booking fields; weekly schedule + time off                 | 15, 16, 17                                                                |
| §8 tests: schedule coverage incl. midnight; RLS negatives; platform no grant                          | 3, 5, 9, 12                                                               |
| Arabic JSDoc on domain + ports; ≤ 300 lines; i18n ar+en; logical CSS                                  | 9, 11, 12; checked in 14/15/16 runs and Task 19                           |
