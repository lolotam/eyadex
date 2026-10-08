# ADR-0019 — Reading the audit log in both areas

Status: accepted (2026-10-08, Phase B slice 10). Spec: `docs/specs/slice-10-audit-read.md`.

## Context

The audit log has been written since slice 3 (`audit_log` per clinic, 0011; `platform_audit_log`, 0012) but nothing served it. PRD §4.11: the clinic admin sees the clinic's log in full; the platform
team sees the platform log and the clinics' administrative events only. PRD §4.5 / PLAT-01: the
platform role has no grant on patient-access audit rows, enforced by the database. Stories 22 and 53
want filters by actor, action, entity and date.

## Decision

1. **A read-only `audit` module** (`apps/api/src/modules/audit`, CLAUDE.architecture.md §2.2). It
   imports identity only through `identity/index.ts` (guards and request types). SQL lives in
   `queries/`, the controllers depend on ports (`CLINIC_AUDIT_READER`, `PLATFORM_AUDIT_READER`) bound
   in two Nest modules: `ClinicAuditModule` (mounted with the clinic area, `eyadex_app` pool) and
   `PlatformAuditModule` (mounted with the platform area, `eyadex_platform` pool).
2. **Routes.** `GET /v1/clinic/audit` (`@Require("view:audit_log:clinic")`, `withTenant`);
   `GET /v1/platform/audit` and `GET /v1/platform/audit/clinics` (`@PlatformStaff()`). `audit_log` is
   a core resource, so no `@RequiresFeature`. Contracts: `@eyadex/contracts/audit-http` (strict
   query and response schemas); each answer is parsed with its strict schema before it leaves.
3. **The patient boundary stays in the database.** The platform query reads only
   `platform_audit_log` and `platform_clinic_admin_audit` (0013: owner-policy, `security_barrier`,
   administrative non-patient rows only); `eyadex_platform` has no SELECT on `audit_log`. The query
   carries no category condition on purpose: a patient row is absent because it cannot be read.
4. **Actor names (0034).** Rows store `actor_user_id` only. The clinic list reads member names through
   the audit port `AuditMemberNameReader` (identity's `PgMemberNames`, §10) under RLS. The platform list reads `platform_audit_actors (user_id, full_name)`: platform-account names
   (`auth_users` with `area = 'platform'`; column grant `id, name, area` only) plus clinic member names,
   owned by the NOLOGIN `eyadex_audit_actor_owner` with a `memberships` policy for that owner alone,
   `SELECT` granted to `eyadex_platform` only. No email, session or non-member clinic account is
   reachable. An actor with no name the reader may see is shown as `Eyadex`.
5. **`withNoTenant` for cross-clinic platform reads.** The platform list and the clinic options run in
   `withNoTenant` on the platform pool: `platform_audit_log` has no RLS, `clinics_platform_all` is
   `USING (true)`, and both views carry their owner's policy. ADR-0002 named `withNoTenant` for the
   pre-tenant lookups; this extends it to platform reads of objects that are not tenant-scoped for
   that role. Every clinic table still returns zero rows there.
6. **Snapshots are an allowlist on read too.** `before` / `after` come only from `details.before` /
   `details.after`, through a per-entity key list (`domain/audit-snapshot.ts`). Patient,
   platform-account and platform-settings entries expose no field until their slices define one.
   `details.module` is copied into both sides.
   - **Every string the reader sees** — actor names, clinic names (list and options), every snapshot
     string at any depth, resolved role/branch names — goes through `scrubAuditText` /
     `scrubAuditValue` (`@eyadex/observability` `audit-text.ts`, the same scrub the writers run before
     a row is stored: patient access, role and member names — ADR-0018 item 7):
     1. NFKC;
     2. format and control characters removed;
     3. Arabic-Indic digits made ASCII;
     4. `redactSecrets`;
     5. any digit run, whatever touches it: 12+ digits withheld (civil ID), 7–11 digits keep the last 3.
   - UUIDs and instants are kept only under their own keys and only when well-formed.
   - **Role and branch references** (`roleId`, `branchId(s)`) become `{ id, nameAr, nameEn }`, as in the
     mock. Clinic list: read in the same tenant transaction. Platform list: one tenant transaction per
     clinic on the page, with the SELECT the platform role already holds on `roles` and `branches`
     (0013). An id the reader cannot name keeps null names.
   - These are current names, not names at write time.
   - The actor search matches the **shown** name only. The reader's visible actors are loaded, sanitized
     with `scrubAuditText`, and matched in TS; SQL then filters by `actor_user_id` (or "no name" for
     `Eyadex`), so rows and `total` never depend on a hidden value. The platform loads every name of
     `platform_audit_actors` for a search — fine at MVP scale.
   - `action` is a code the writers set, never user text, so it is not sanitized.
7. **Entities.** `membership` (written by invitation acceptance) is shown as `user`; only the contract's
   entity types are read, so a new writer type cannot break the strict answer. Platform events derive
   their entity from the action prefix, as the Phase-A mock did.
8. **Cursor.** Opaque base64url of the full sort key with the instant at microsecond precision:
   clinic `(created_at, id)` — unique inside a clinic; platform `(created_at, id, source, clinic_key)` —
   the list merges two tables and many clinics, and an id is unique only per `(clinic_id, id)`.
   Instants in a cursor and days in `from`/`to` are checked on their text (year 1–9999, a real month,
   day and time), never through `Date`, so PostgreSQL's cast cannot fail (400 instead of 500).
   `total` is its own statement with the same filters. Days filter on the clinic's time zone
   (`clinics.timezone`) or `Asia/Kuwait` on the platform, as instants so `created_at` indexes serve.
9. **Patient-access rows in the clinic list** need `view:patients:clinic` besides the route's key
   (`TODO(spec)`, conservative). The admin holds every key; a locked patients module hides them.
10. **Other modules' tables only through audit ports** (cleanup, 2026-10-08; apps/api/AGENTS.md). The
    audit SQL names only `audit_log`, `platform_audit_log`, `platform_clinic_admin_audit` and
    `platform_audit_actors` (a test in `module-boundaries.spec.ts` holds it). Everything else is read
    through ports audit owns (`ports/audit-name-readers.ts`), implemented by the owners and bound in
    `audit.module.ts` only, the way patients reads branches (ADR-0018 item 8): member names
    (`PgMemberNames`) and role names (`PgRoleNames`) from identity; branch names (`PgFilingBranches`)
    and the clinic's time zone, clinic names and the clinic options (`PgClinicNames`) from tenancy.
    Every call runs in the caller's transaction (`withTenant` on the clinic or per clinic for role and
    branch names; `withNoTenant` on the platform pool for clinic names), so RLS and the grants decide
    exactly what they did before, and each kind of name is one batched statement per page (no N+1).
    The clinic actor search loads the clinic's members once and filters by id (`actor_named` is "the
    actor is one of them"); without a search only the page's actors are named. This adds the arrows
    `audit → tenancy` and `audit → identity` (adapters from `index.ts`, in `audit.module.ts` only) to
    CLAUDE.architecture.md §2.2. `platform_audit_actors` (0034) stays a database view: it is the
    audit read surface the platform grant was designed around, and replacing it would change grants.

## Consequences

- PLAT-01 is re-proved at the read surface (`db/tests/audit-read.sql`) and over HTTP
  (`platform-audit.db.spec.ts`: the row is in no page and `eyadex_platform` gets `42501`).
- The web's HTTP adapter serves both audit screens; `/clinic/audit` and `/platform/audit` leave the
  "coming soon" list. The API's platform action names (`clinic.feature_changed`,
  `clinic.subscription_changed`, `clinic.limits_changed`) join the action filter with labels.
- Open (`TODO(spec)`): retention (nothing is deleted); which permission opens patient rows to a custom
  role; what a patient-file entry may show; whether the clinic may see a platform account's name.
