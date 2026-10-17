# CLAUDE.architecture.md — Code Architecture Rules (Eyadex)

> **Companion to** `docs/PRD-Eyadex-MVP.md` (what) and `CLAUDE.md` (day-to-day rules).
> This file answers one question: **where does a line of code go, and what may it import?**
> On conflict, this file wins for structure and dependency direction.
>
> **Version:** A1.1 — 2026-10-17: §1–2 describe Phase B as it is today (web with mock and HTTP
> adapters, API, worker, `packages/*`); the §9 checklist labels rules by part, not by phase. A1.0 — 2026-10-03, adapted from PosPay A1.0.

---

## 0. شرح بالعربي — الفكرة في صفحة

الهدف إن أي وكيل (أو إنت بعد شهرين) يلاقي الكود في مكانه المتوقع، وما يقدرش يخلط الحاجات.

1. **الفولدرات بتصرّخ بالبيزنس، مش بالتقنية.** تفتح `src/` تلاقي `users`, `branches`, `roles`,
   `patients`, `audit`, `settings`, `platform` — مش `controllers` و`services`.
2. **قواعد البيزنس دوال صافية.** هل العيادة مسموح لها بالدخول؟ هل ينفع نعطّل آخر أدمن؟ حساب
   تاريخ الانتهاء من مدة؟ دي دوال من غير داتابيز، بتتختبر في ميلي ثانية.
3. **كل use case في فولدر لوحده** (Phase B): `invite-user/`, `register-patient/`.
4. **الحدود بالـ interfaces:** الواجهة بتتكلم مع `ApiClient` بس، والـ mock والـ HTTP الاتنين
   بينفذوه و`VITE_API_MODE` بيختار بينهم — تغيير ملف واحد مش إعادة كتابة.
5. **ممنوع الاعتمادية الدائرية:** `patients` ما يستوردش `identity`. محتاج حاجة؟ port أو event.
6. **العزل من الداتابيز نفسها:** كل جدول عيادة عليه RLS مفروض، والمنصة ما عندهاش أي صلاحية على
   جدول المراجعين. الواجهة بتخفي الزرار، لكن الحماية الحقيقية في السيرفر والداتابيز.

---

## 1. The web app (`apps/web`)

Phase A built it against the mock; in Phase B the same screens also run against `apps/api`.
`VITE_API_MODE` picks the adapter at build time (`shared/api/api-mode.ts`): the in-memory mock (the
default; Lovable's preview and most tests — a test may mock `API_MODE`) or the HTTP adapter. The web hard limits of `CLAUDE.md` §1
still bind.

```
apps/web/src/<business-area>/   one folder per area: page components, dialogs, columns, queries hooks
apps/web/src/shared/api/        ApiClient interface + api-error + api-mode + provider   (the boundary)
apps/web/src/shared/api/mock/   the in-memory adapter: mock-actor (auth + permission check order),
                                mock-audit (the ONLY audit writer), per-area mock files, seed
apps/web/src/shared/api/http/   the HTTP adapter against apps/api, + the Better Auth client
apps/web/src/shared/permissions/ can(), RequirePermission — UI gating from permission strings
apps/web/src/shared/i18n/       ar/en dictionaries, provider, language switch
apps/web/src/routes/            thin TanStack routes: head() + re-export
packages/contracts/src/         Zod — the single source of types for forms AND the ApiClient
                                (imported as @eyadex/contracts/<name>)
```

### 1.1 Import matrix (web)

| From ↓ may import →          | contracts         | shared/api (interface) | shared/api/mock                           | another business area              | components/ui |
| ---------------------------- | ----------------- | ---------------------- | ----------------------------------------- | ---------------------------------- | ------------- |
| business area (`src/users`…) | ✅                | ✅ via `useApi()`      | ❌ never                                  | ❌ (move shared bits to `shared/`) | ✅            |
| `src/marketing`              | ✅ pure data only | ❌                     | ❌ (pure data like `ROLE_TEMPLATES` only) | ❌                                 | ✅            |
| `shared/api/mock`            | ✅                | ✅ implements it       | ✅                                        | ❌                                 | ❌            |
| `src/routes`                 | ❌                | ❌                     | ❌                                        | ✅ page components + their slots¹  | ❌            |

¹ A route is where areas meet: besides page components it may import the pieces one area hands
another page as props — a tab list (`SlotTab`, e.g. the medical tabs of the patient file) or a layout
frame (the Settings shell). Nothing else of an area. `src/shared/area-boundaries.test.ts` enforces
the area-to-area rule (ADR-0030).

A screen that imports an adapter directly (mock or HTTP) breaks the switch between them and is
rejected in review (no lint rule or test enforces it). `shared/api/api-provider.tsx` builds the client; outside tests, test kits and the pure
data the matrix allows `src/marketing`, no business area imports either adapter.

## 2. Phase B — the monorepo today (PRD §4.2, from the PosPay foundation)

```
apps/web        the TanStack Start app above: mock or HTTP adapter, chosen by VITE_API_MODE
apps/api        NestJS on Fastify: HTTP, Better Auth handler, guards; modules appointments, audit,
                billing, identity, medical, notifications, patients, platform, settings, tenancy
apps/worker     same NestJS stack, own container: the outbox poller (invitation and team emails,
                mail-provider tests, expiry-reminder emails, patient email/WhatsApp notifications,
                branch deactivation) + interval jobs (expiry and appointment reminder scans, the
                retention purge); /health
packages/contracts  Zod (imported as @eyadex/contracts/*): forms, the ApiClient and the HTTP API
packages/config     shared ESLint base config + tsconfig presets
packages/db     the only path to PostgreSQL: withTenant/withNewTenant/withNoTenant over Drizzle,
                plus the Drizzle schema mirror (./schema); drizzle-kit is pull-only (ADR-0024)
packages/auth   Better Auth config (+ two-factor). The ONLY place sessions/passwords are handled
packages/secrets    the outbox seal + the field cipher + the civil ID blind index (ADR-0028)
packages/ids    UUID v7 with injected time + entropy
packages/observability  pino + redaction, request context
db/sql + db/migrate.sh  PostgreSQL 18, forced RLS: the only way to change a database (ADR-0024)
```

The workspace is pnpm + Turborepo (`pnpm-workspace.yaml`, `turbo.json`); `pnpm typecheck`,
`pnpm lint`, `pnpm test` and `pnpm build` run the pipeline across every package.

### 2.1 Backend module shape — identical in every module

```
apps/api/src/modules/<module>/
  domain/       pure business rules, zero framework imports, Arabic JSDoc mandatory
  use-cases/    WRITE side, one folder per use case <verb>-<noun>/
  queries/      READ side, SQL straight into DTO shape, read-only
  ports/        interfaces this module needs (repositories, cross-module readers, Clock, IdGenerator)
  persistence/  Drizzle implementations of ports
  http/         thin controllers: validate → call → map
  events/       published.ts + handlers/ for other modules' events
  <module>.module.ts   the only place an interface is bound to a class
  index.ts      the ONLY file other modules may import
```

### 2.2 Modules and the allowed arrows (PRD §4.3)

| Module          | Owns                                                                                                                                                                                     | May import                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenancy`       | clinics, branches, subscription & limits, feature flags, platform settings (ADR-0020)                                                                                                    | —                                                                                                                                                                       |
| `identity`      | users (Better Auth), memberships, roles, permissions, invitations, guards, platform team accounts (ADR-0020)                                                                             | `tenancy`                                                                                                                                                               |
| `platform`      | super-admin HTTP: wires tenancy/identity use cases (clinics, overview, platform team, platform settings)                                                                                 | `tenancy`, `identity` (index.ts only)                                                                                                                                   |
| `patients`      | patient (المراجع) files — identity data only                                                                                                                                             | `tenancy` (and `appointments`, `visits` read-only in its own-scope SQL, see below)                                                                                      |
| `settings`      | clinic settings                                                                                                                                                                          | `tenancy`, `identity` (index.ts: guards and request types only)                                                                                                         |
| `audit`         | reading the audit log (writes go through the shared primitive)                                                                                                                           | `tenancy`, `identity` (index.ts; adapters in audit.module.ts)                                                                                                           |
| `appointments`  | services, weekly schedules, time off (A1); appointments (A2) — ADR-0026                                                                                                                  | `tenancy`, `identity`, `patients`, `notifications` (index.ts; `PgProviderDirectory`, `PgBookingPatients`, `PgAppointmentNotifications` bound in appointments.module.ts) |
| `medical`       | visits, notes, addenda, medical file, diagnoses, prescriptions, ICD-10-CM, medicines (P2) — ADR-0029                                                                                     | `tenancy`, `identity`, `patients`, `appointments`, `notifications` (index.ts; adapters bound in medical.module.ts)                                                      |
| `notifications` | system emails (invite, password reset, expiry reminder); patient notifications: clinic notification settings, the message ledger and the WhatsApp channel (phase 3) — ADR-0031, ADR-0032 | `tenancy`, `identity` (index.ts: guards and request types only)                                                                                                         |

Any module may use identity's access guards and request types through `identity/index.ts`; that is the only import of identity a module other than identity may make, except that a `<module>.module.ts` may bind an identity adapter (exported by `identity/index.ts`) to a port the module owns (platform, audit — ADR-0019 §10; appointments — ADR-0026). The appointments module also binds patients' `PgBookingPatients` (exported by `patients/index.ts`) to its `BookingPatientReader` port, and imports nothing else of patients (ADR-0026 §11; `module-boundaries.spec.ts`). The one read the other way: the patients module's SQL names the `appointments` relation read-only in the `own` predicate of `patients/queries/own-patients.ts` only (D-4), because a port implemented by appointments would close an import cycle; it imports nothing of appointments (ADR-0026 §12; `module-boundaries.spec.ts`). The medical module (ADR-0029) binds patients' `PgMedicalPatients`, appointments' `PgVisitAppointments`, identity's `PgProviderDirectory` and tenancy's `PgFilingBranches` and `PgClinicNames` to its own ports in `medical.module.ts` and imports nothing else of them; the same `own` predicate names `visits` read-only, and patients and appointments import nothing of medical (`module-boundaries.spec.ts`). Appointments and medical bind notifications' `PgAppointmentNotifications` and `PgVisitNotifications` (exported by `notifications/index.ts`) to their own `AppointmentNotifications` and `VisitNotifications` ports in their module file and import nothing else of it; notifications imports nothing of either (ADR-0031, `module-boundaries.spec.ts`).

- Cross-module **reads**: a port defined by the consumer, implemented by an adapter on the owner
  (e.g. `platform` reads clinic users through a port backed by `identity`).
- Cross-module **effects**: outbox events — `ClinicCreated`, `ClinicSuspended`,
  `ClinicReactivated`, `SubscriptionChanged`, `ClinicFeatureChanged`, `UserInvited`,
  `UserDeactivated`, `RolePermissionsChanged`, `PatientRegistered`.
- The one synchronous cross-module write: creating a clinic together with its first admin, in
  one transaction (`withNewTenant`).
- **A new arrow requires updating this table and an ADR.** A cycle is rejected in review until the
  cycle check of §7 lands; `module-boundaries.spec.ts` catches only the arrows it names.

### 2.3 Where logic goes

- `domain/`: is the clinic allowed to access, last-admin guard, expiry from a duration, limit
  counting (active members + pending non-expired invitations), permission evaluation.
- `use-cases/`: orchestration only. No arithmetic, no SQL, no `Date.now()` / `randomUUID()`
  (inject `Clock` and `IdGenerator`).
- Controllers and React components hold no business logic.

## 3. Database — layers of protection

1. Session valid and user active.
2. Clinic allowed to access (`status != suspended AND expires_at > now()`, computed per request).
3. Module enabled for the clinic.
4. Role holds the permission at the required scope.
5. `branch` scope: the record's branch is in the user's branches.
6. **RLS** as the last line of defence (`app.clinic_id` set by `withTenant`).

Four named pre-tenant / onboarding paths (`db/sql/0014`, `0027`, `0059`), and no others:

- **Onboarding** runs as `eyadex_platform` inside `withNewTenant()` (app.clinic_id = the new clinic):
  it may insert the clinic, its system roles and the first-admin invitation; RLS still pins every
  row to that clinic and the platform still has no grant on patients.
- **Link rows** (`membership_branches`, `role_permissions`, `invitation_branches`) and
  **`provider_schedules`** (0042, ADR-0026: a provider's week in one branch is configuration, replaced
  whole under the provider lock and audited) are the only deletable tables (`0016`, `0042`); every
  entity is deactivated or archived instead. The technical ledgers
  (`idempotency_keys`, `clinic_idempotency_keys`, `outbox_events`) lose rows only through the three
  retention functions of `0040` (ADR-0022): SECURITY DEFINER, owned by a NOLOGIN role, executable by
  `eyadex_dispatcher` only, deleting only rows past their period.
- **Accepting an invitation** starts with no clinic: `invitation_clinic_for_token(token_hash)`
  (SECURITY DEFINER, owned by a NOLOGIN role, executable by `eyadex_app` only) returns just the
  clinic id of a pending, unexpired invitation; the API then continues inside `withTenant()`.
- **Resolving a signed-in user's clinic** (ADR-0009): `membership_clinic_for_user(user_id)`, the same
  shape, returns only the clinic id of the user's one membership; the guard continues in `withTenant()`.
- **Routing Meta's status webhook** (spec §7.2): `whatsapp_clinic_for_phone_number(phone_number_id)`, the
  same shape (its own NOLOGIN owner, `eyadex_app` only), returns only the clinic id of the coexistence
  channel holding that Meta number; each status is then applied inside that clinic's `withTenant()`.

Grants are the platform-privacy guarantee: `eyadex_platform` has **no** privilege on
`patients`, and reads audit rows only through a view that excludes `patient_access` entries.

## 4. Frontend specifics

- Permission-driven UI: menus and buttons from `can(permission)`, never from role names.
- Forms: one column, dialogs for create/edit, react-hook-form + contract schema.
- Tables: one toolbar (search + filters), TanStack Table, cursor pagination, row actions at the
  end; on narrow screens the table scrolls inside its own container with sticky actions.
- Status = icon + label + subtle tint, never colour alone.

## 5. When NOT to add an abstraction

- No interface with a single implementation unless it is one of the boundaries above
  (`ApiClient`, repositories, Clock, IdGenerator, cross-module readers, notification channel).
- No generic "base service", no `*Service` that accumulates unrelated methods.

## 6. Naming

- Folders and files: kebab-case, named after the business (`invite-user-dialog.tsx`).
- Use cases: `<verb>-<noun>` (`deactivate-user`). Events: past tense PascalCase (`UserInvited`).
- Permission keys: `action:resource:scope` (`view:patients:branch`).
- DB: snake_case, plural tables, `name_ar` / `name_en`.

## 7. Enforcement

- CI: typecheck, lint (prettier + eslint), vitest, node-server build (`.github/workflows/ci.yml`).
- Phase B today: import rules are tests, not a lint plugin —
  `apps/api/src/shared/__tests__/module-boundaries.spec.ts` (the specific arrows and SQL relations
  it names; the rest of the §2.2 table is checked in review) and
  `apps/web/src/shared/area-boundaries.test.ts` (area to area); the web adapter rule (§1.1) is
  checked in review. RLS and grant negative tests run in the CI `db` job (`db/tests/*.sql`).
- Planned, not in CI yet: eslint-plugin-boundaries (import matrix), cycle check, module-map
  check, jsdoc coverage on `domain/` and `ports/`, guard-coverage test.

## 8. Review priorities (for Codex and every reviewer)

Report only real defects, ranked by severity. Check first:

- patient data reachable from the platform area or the platform DB role
- a tenant table without forced RLS + negative test in the same PR
- a token, secret or password in code, tests, logs or audit snapshots
- an endpoint / mock method without the permission check order (§3)
- a screen importing the mock adapter, or business logic in a component
- hardcoded UI text, left/right CSS, role-name checks, hard deletes
- the words "كاشير" / "Cashier", or "المريض / المرضى" in Arabic UI copy

## 9. Definition of done for a slice

- [ ] Contract (Zod) updated; SQL in `db/sql` updated with RLS + indexes if the schema changed
- [ ] Every rule enforced in the API + DB and mirrored in the web mock adapter (same checks, same
      order), with tests
- [ ] UI in Arabic and English, 1440px and 390px, loading / empty / error states
- [ ] Each persona checked: sees and does exactly what its permissions allow
- [ ] typecheck, lint (0 errors), tests, build green locally and in CI
- [ ] Blocking review findings resolved; non-blocking ones answered on their threads and listed
      under **Follow-ups** for one follow-up PR (`CLAUDE.md` §2.1); `roadmap.md` and PRD §5.6
      status updated
