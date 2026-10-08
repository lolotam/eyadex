# Slice 10 — Reading the audit log in both areas

Status: implemented on branch `slice-10-audit-read` (PRD §5 step 10, ADR-0019).

## Stories

- **53 (clinic):** a clinic admin reads the clinic's audit log with filters (actor, action, entity,
  date) to know who changed what and when. PRD §4.11: the clinic admin sees the clinic log in full.
- **22 (platform):** a platform admin reads the platform audit log with filters (clinic, actor, event
  type, date) to know who changed a subscription or a module and when.
- **21 / PLAT-01 / PLAT-02 (platform):** no patient data on any platform screen, list or log, enforced
  by database grants.
- **83:** the log is append-only. This slice only reads it; nothing here writes, updates or deletes.

## Routes

| Method + path                    | Guard (one declaration)                   | Pool                         | Contract (`@eyadex/contracts/audit-http`)                      |
| -------------------------------- | ----------------------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `GET /v1/clinic/audit`           | `@Require("view:audit_log:clinic")`       | `eyadex_app`, `withTenant`   | `clinicAuditQuerySchema` → `clinicAuditListResponseSchema`     |
| `GET /v1/platform/audit`         | `@PlatformStaff()` (platform host + TOTP) | `eyadex_platform`, no tenant | `platformAuditQuerySchema` → `platformAuditListResponseSchema` |
| `GET /v1/platform/audit/clinics` | `@PlatformStaff()`                        | `eyadex_platform`, no tenant | none → `platformAuditClinicOptionsResponseSchema`              |

`audit_log` is a core resource (no feature flag), so no `@RequiresFeature`. The clinic route on the
platform host and the platform routes on the clinic host answer 404 (area hosts, ADR-0004); a clinic
session never reaches a platform route.

## Grants / RLS boundary (already in the baseline, re-proved here)

- `eyadex_platform` has **no grant on `audit_log`** (0013 `REVOKE ALL`; 0016 adds INSERT only, with a
  policy that admits administrative non-patient rows of the clinic in context).
- The platform reads clinic entries only through `platform_clinic_admin_audit` (0013): a
  `security_barrier` view owned by the NOLOGIN `eyadex_audit_view_owner`, whose only access to
  `audit_log` is a policy returning `category = 'administrative' AND entity_type <> 'patient'`.
- The platform list query reads `platform_audit_log` and that view — no category condition anywhere
  in the API: a patient-access row cannot be returned because the role cannot read it.
- **0034 adds one narrow read surface:** `platform_audit_actors (user_id, full_name)` — the names of
  platform accounts (`auth_users` with `area = 'platform'`, columns `id, name, area` only) and of clinic
  members (`memberships`, columns `user_id, full_name` only). Owned by the NOLOGIN
  `eyadex_audit_actor_owner` (policy on `memberships` for that owner only), `SELECT` granted to
  `eyadex_platform` only. No email, no session, no clinic-area account. `eyadex_app` gets nothing.

## Filters

| Filter     | Clinic                                                       | Platform                       |
| ---------- | ------------------------------------------------------------ | ------------------------------ |
| `actor`    | case-insensitive substring of the shown actor name (SQL)     | same                           |
| `action`   | exact                                                        | exact                          |
| `from/to`  | calendar days in the clinic's time zone (`clinics.timezone`) | calendar days in `Asia/Kuwait` |
| `entity`   | `clinicAuditEntitySchema`                                    | `platformAuditEntitySchema`    |
| `category` | `administrative` / `patient_access`                          | —                              |
| `source`   | —                                                            | `platform` / `clinic`          |
| `clinicId` | —                                                            | one clinic's events            |

## Mapping stored rows to the contract

- **Entity:** clinic rows keep `entity_type`, except `membership` (written by invitation acceptance)
  which is shown as `user`. Only the known entity types are read, so a future writer's new type cannot
  break the strict response. Platform rows derive the entity from the action, as the Phase-A mock did
  (`invitation.*`, `platform_account.*`, `platform.*`, otherwise `clinic`).
- **Snapshots:** `before` / `after` come only from `details.before` / `details.after`, filtered through
  a per-entity key allowlist (`audit/domain/audit-snapshot.ts`), then `redactSecrets` (no credential,
  PEM, civil ID or URL token) and phone masking on free-text keys and `phone` (last 3 digits). A
  top-level `details.module` (feature changes) is copied into both snapshots. Patient snapshots expose
  no field (`TODO(spec)` until the patients slice defines its allowlist). Anything else in `details`
  (`reason`, `eventId`, `lastError`…) is not exposed.
- **Actor name:** a clinic member's `full_name` (phones masked); any other actor (a platform account
  acting on the clinic's behalf at onboarding, a system actor) is shown as `Eyadex` in the clinic list.
  The platform list uses `platform_audit_actors`; unknown actors are shown as `Eyadex`.
- **entityId:** `audit_log.entity_id` is nullable, so `clinicAuditItemSchema.entityId` becomes nullable
  (the platform item already was). Platform rows use their `clinic_id`.

## Patient-access rows inside the clinic

PRD §4.11 says the clinic admin sees the full log; it does not say which permission opens patient
rows to a custom role. `TODO(spec)` — conservative choice: `patient_access` rows are read only when the
caller's effective permissions hold `view:patients:clinic`. A locked patients module drops that key
(ADR-0010), which hides them too. The clinic admin holds every key, so the PRD's admin case is met.

## Cursor

Opaque base64url of the full sort key, the instant at microsecond precision (UTC):

- **Clinic list:** `created_at|id`, order `created_at DESC, id DESC`, next page
  `WHERE (created_at, id) < (cursor)`. `(clinic_id, id)` is the primary key, so the pair is unique
  inside the clinic.
- **Platform list:** `created_at|id|source|clinic_key`, order
  `created_at DESC, id DESC, source DESC, clinic_key DESC` (`clinic_key` = `clinic_id`, the nil UUID
  for a platform event without one). The list merges two tables and every clinic, and an audit id is
  unique only per `(clinic_id, id)`, so `(created_at, id)` alone could skip a row.

Every part is validated (malformed, or the other list's shape → 400 `validation`). `total` is counted
on its own statement with the same filters. No row is skipped or repeated across a tie.

## Retention

The PRD is silent. `TODO(spec)`: nothing is deleted; no runtime role can delete audit rows.

## Web

- `apps/web/src/shared/api/http/http-audit.ts` wires the three methods; every answer is `safeParse`d
  by the transport against the strict response schema.
- `http-unserved.ts` loses `audit`; `unserved-paths.ts` serves `/clinic/audit` and `/platform/audit`.
- The API's real platform action names (`clinic.feature_changed`, `clinic.subscription_changed`,
  `clinic.limits_changed`) join the platform action catalogue with ar/en labels in new i18n files.

## Tests

- **SQL** `db/tests/audit-read.sql`: the platform reads `platform_audit_actors` (platform account +
  member names), never a clinic-area account; cannot read `auth_users`; `eyadex_app` cannot read the
  view; the platform still cannot read `audit_log` and the admin view never shows a patient row.
- **API unit:** cursor encode/decode for both shapes; snapshot allowlist (drops unknown keys, civil
  IDs, tokens, masks phones); the patient-access permission rule. The `membership` → `user` mapping
  is SQL and is covered by `test:db` (invitation acceptance rows).
- **API `test:db`:** clinic list happy path, newest-first, cursor stability with a `created_at` tie,
  each filter, time-zone day bounds; 403 without the permission; cross-clinic rows never returned;
  patient rows hidden without `view:patients:clinic`; platform list with a clinic session / on the
  clinic host refused; a patient-access row never in the platform list — including one filed under a
  non-patient entity, which only the grant boundary (not the API's entity list) keeps out — and
  `eyadex_platform` gets `42501` reading `audit_log`; the platform cursor across a tie between a
  platform event and a clinic entry, and across one id held by two clinics at one instant; no
  secret / civil-ID / token in any response; clinic options.
- **Web vitest:** each method's method, path, query and `credentials`, with a stubbed `fetch`.

## Implementation plan

1. This spec (commit).
2. `db/sql/0034_platform_audit_actors.sql` + `db/tests/audit-read.sql`; dbcheck.
3. Drizzle mirror of the view (new schema file + one export line); `@eyadex/db` `test:db`.
4. Contracts: `audit-http.ts` (strict HTTP query + response schemas); one-line edits in `audit.ts`.
5. API module `audit`: `domain/` (cursor, snapshot, entities), `queries/` (clinic list, platform list,
   clinic options), `ports/`, `http/` (two controllers), two Nest modules mounted from `app.ts`.
6. API unit + `test:db` specs; negative proofs.
7. Web `http-audit.ts`, unserved edits, i18n labels, vitest.
8. ADR-0019, roadmap bullet, gates, push.
