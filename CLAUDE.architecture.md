# CLAUDE.architecture.md — Code Architecture Rules (Eyadex)

> **Companion to** `docs/PRD-Eyadex-MVP.md` (what) and `CLAUDE.md` (day-to-day rules).
> This file answers one question: **where does a line of code go, and what may it import?**
> On conflict, this file wins for structure and dependency direction.
>
> **Version:** A1.0 — 2026-10-03, adapted from PosPay A1.0.

---

## 0. شرح بالعربي — الفكرة في صفحة

الهدف إن أي وكيل (أو إنت بعد شهرين) يلاقي الكود في مكانه المتوقع، وما يقدرش يخلط الحاجات.

1. **الفولدرات بتصرّخ بالبيزنس، مش بالتقنية.** تفتح `src/` تلاقي `users`, `branches`, `roles`,
   `patients`, `audit`, `settings`, `platform` — مش `controllers` و`services`.
2. **قواعد البيزنس دوال صافية.** هل العيادة مسموح لها بالدخول؟ هل ينفع نعطّل آخر أدمن؟ حساب
   تاريخ الانتهاء من مدة؟ دي دوال من غير داتابيز، بتتختبر في ميلي ثانية.
3. **كل use case في فولدر لوحده** (Phase B): `invite-user/`, `register-patient/`.
4. **الحدود بالـ interfaces:** الواجهة بتتكلم مع `ApiClient` بس، والـ mock النهارده والـ HTTP بكرة
   بينفذوه — تغيير ملف واحد مش إعادة كتابة.
5. **ممنوع الاعتمادية الدائرية:** `patients` ما يستوردش `identity`. محتاج حاجة؟ port أو event.
6. **العزل من الداتابيز نفسها:** كل جدول عيادة عليه RLS مفروض، والمنصة ما عندهاش أي صلاحية على
   جدول المراجعين. الواجهة بتخفي الزرار، لكن الحماية الحقيقية في السيرفر والداتابيز.

---

## 1. Phase A — the web app (this repo today)

```
src/<business-area>/      one folder per area: page components, dialogs, columns, queries hooks
src/shared/api/           ApiClient interface + api-error + provider   (the boundary)
src/shared/api/mock/      the in-memory adapter: mock-actor (auth + permission check order),
                          mock-audit (the ONLY audit writer), per-area mock files, seed
src/shared/permissions/   can(), RequirePermission — UI gating from permission strings
src/shared/i18n/          ar/en dictionaries, provider, language switch
src/routes/               thin TanStack routes: head() + re-export
contracts/                Zod — the single source of types for forms AND the ApiClient
```

### 1.1 Import matrix (Phase A)

| From ↓ may import →          | contracts         | shared/api (interface) | shared/api/mock                           | another business area              | components/ui |
| ---------------------------- | ----------------- | ---------------------- | ----------------------------------------- | ---------------------------------- | ------------- |
| business area (`src/users`…) | ✅                | ✅ via `useApi()`      | ❌ never                                  | ❌ (move shared bits to `shared/`) | ✅            |
| `src/marketing`              | ✅ pure data only | ❌                     | ❌ (pure data like `ROLE_TEMPLATES` only) | ❌                                 | ✅            |
| `shared/api/mock`            | ✅                | ✅ implements it       | ✅                                        | ❌                                 | ❌            |
| `src/routes`                 | ❌                | ❌                     | ❌                                        | ✅ page component only             | ❌            |

A screen that imports the mock directly breaks the Phase B swap and is rejected.

## 2. Phase B — the target monorepo (PRD §4.2, from the PosPay foundation)

```
apps/web        this app (TanStack Start), HTTP adapter replaces the mock
apps/api        NestJS on Fastify: HTTP, auth handler, guards
apps/worker     same NestJS code, BullMQ processors (emails, outbox, expiry reminders)
packages/db     Drizzle schema + drizzle-kit migrations + RLS policies; withTenant/withUser/withNewTenant
packages/contracts  Zod (moved from /contracts) + generated OpenAPI
packages/auth   Better Auth config (+ two-factor). The ONLY place sessions/passwords are handled
packages/ids    UUID v7 with injected time + entropy
packages/observability  pino + redaction, request context
packages/config eslint (boundaries, jsdoc), tsconfig
```

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

| Module          | Owns                                                                      | May import |
| --------------- | ------------------------------------------------------------------------- | ---------- |
| `tenancy`       | clinics, branches, subscription & limits, feature flags                   | —          |
| `identity`      | users (Better Auth), memberships, roles, permissions, invitations, guards | `tenancy`  |
| `platform`      | super-admin use cases, platform team, platform settings                   | `tenancy`  |
| `patients`      | patient (المراجع) files — identity data only                              | `tenancy`  |
| `settings`      | clinic settings                                                           | `tenancy`  |
| `audit`         | reading the audit log (writes go through the shared primitive)            | —          |
| `notifications` | system emails (invite, password reset, expiry reminder)                   | —          |

- Cross-module **reads**: a port defined by the consumer, implemented by an adapter on the owner
  (e.g. `platform` reads clinic users through a port backed by `identity`).
- Cross-module **effects**: outbox events — `ClinicCreated`, `ClinicSuspended`,
  `ClinicReactivated`, `SubscriptionChanged`, `ClinicFeatureChanged`, `UserInvited`,
  `UserDeactivated`, `RolePermissionsChanged`, `PatientRegistered`.
- The one synchronous cross-module write: creating a clinic together with its first admin, in
  one transaction (`withNewTenant`).
- **A new arrow requires updating this table and an ADR.** A cycle fails CI.

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

Two named pre-tenant / onboarding paths (`db/sql/0014`), and no others:

- **Onboarding** runs as `eyadex_platform` inside `withNewTenant()` (app.clinic_id = the new clinic):
  it may insert the clinic, its system roles and the first-admin invitation; RLS still pins every
  row to that clinic and the platform still has no grant on patients.
- **Link rows** (`membership_branches`, `role_permissions`, `invitation_branches`) are the only
  deletable tables (`0016`); every entity is deactivated or archived instead.
- **Accepting an invitation** starts with no clinic: `invitation_clinic_for_token(token_hash)`
  (SECURITY DEFINER, owned by a NOLOGIN role, executable by `eyadex_app` only) returns just the
  clinic id of a pending, unexpired invitation; the API then continues inside `withTenant()`.

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
- Phase B adds: eslint-plugin-boundaries (import matrix), cycle check, module-map check,
  jsdoc coverage on `domain/` and `ports/`, RLS negative tests, guard-coverage test.

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
- [ ] Every rule enforced in the mock (Phase A) / API + DB (Phase B), with tests
- [ ] UI in Arabic and English, 1440px and 390px, loading / empty / error states
- [ ] Each persona checked: sees and does exactly what its permissions allow
- [ ] typecheck, lint (0 errors), tests, build green locally and in CI
- [ ] Codex + CodeRabbit findings resolved; `roadmap.md` and PRD §5.6 status updated
