# ADR-0020 — Clinic and platform settings, platform team, expiry alert

Status: accepted (2026-10-08, Phase B slice 11 — PRD §5.5 item 11); amended 2026-10-09 (default
limits and modules for new clinics, SQL 0041 — see the amendment at the end)

## Context

After slice 10 the HTTP web app still showed "coming soon" on five pages (`unserved-paths.ts`):
`/clinic/settings`, `/clinic/account`, `/platform` (overview), `/platform/team`, `/platform/settings`.
PRD stories 3–4 (overview with the computed "expired" state, expiring soon), 24–26 (platform team,
last active account, platform settings), 30 and 79 (expiry banner and a daily reminder email), 55
(clinic settings), 64 (my account, including the password), §4.9 ("a daily worker job sends only the
pre-expiry email"), SUB-02 ("expired" is computed at check time, never stored, never a job) and
ADM-02 (the last active platform account cannot be deactivated). ADR-0009 left platform-account
deactivation unmodelled; ADR-0016 deferred the overview, the "expired" filter and the platform
defaults read for new clinics.

## Decisions

### 1. Ownership (CLAUDE.architecture.md §2.2 updated)

The data each feature needs is read by modules that may not import `platform`, so it lives with the
module that already decides the rule, and `platform` only wires HTTP (the ADR-0006/0010 precedent):

- **tenancy** owns `platform_settings` (subscription policy: default trial days, alert window, the
  platform sender name), the overview query, the "effective status" filter, and the clinic-settings
  use case (`clinics` is tenancy's table). `settings` serves `/v1/clinic/settings` over it.
- **identity** owns `platform_accounts` (PRD §4.6 "PlatformGrant": a user linked to the platform
  team), the platform-account gate in `AccessGuard`, the team use cases and invitation acceptance,
  and the "my account" use case.
- **platform** wires `/v1/platform/{overview,settings,team,me}` to those use cases.

### 2. SQL (production needs 0036, 0037, 0038, in order)

- **0036** `platform_settings`: a singleton (`id smallint PRIMARY KEY CHECK (id = 1)`), seeded with
  OD-6 (14 trial days, 7 alert days, sender `Eyadex`) so a read never finds nothing; bounds checked as
  in the contract (1–90, 1–60, 2–60 chars). Not a clinic table (no `clinic_id`, no RLS): it holds no
  clinic data. Grants: `eyadex_platform` SELECT, UPDATE; `eyadex_app` SELECT (banner, worker). Same
  file: `eyadex_app` gets `UPDATE (name_ar, name_en, default_language, timezone, updated_at)` on
  `clinics` and an UPDATE policy `id = app.clinic_id` (USING and WITH CHECK) — a clinic can change
  those five columns of its own row and nothing else; status, expiry, limits and slug stay platform-only.
- **0037** `platform_accounts`: `id` (v7), `user_id` (NULL until the invitation is accepted, UNIQUE),
  `email` (UNIQUE, lower-case), `full_name`, `status IN ('invited','active','deactivated')`,
  `token_hash` / `token_expires_at` (the pending link; NULL once used), `invited_by`, `joined_at`,
  timestamps. Global, no RLS; grants `eyadex_platform` SELECT, INSERT, UPDATE only (app, auth and
  dispatcher get nothing). **Backfill:** every existing `auth_users` row with `area = 'platform'` gets
  an `active` row (`joined_at = created_at`) in the same file, so the new gate never locks out the
  accounts that exist today. Each backfilled account also takes its email's `platform` reservation
  through `reserve_platform_email` (0015's one-email rule); a live clinic invitation or membership on
  that email fails the whole file, to be resolved by hand (`db/tests/platform-backfill.sh`, Codex PR
  #55). The orchestrator verifies the owner's row after applying. ADR-0021's
  bootstrap (on `eyadex_auth`, no grant on the table) writes the first account's row through
  `link_first_platform_account` (SECURITY DEFINER, owned by NOLOGIN `eyadex_platform_team_owner`,
  executable by `eyadex_auth` only, refuses once the team has an active member) in its own transaction.
- **0038** `clinic_expiry_reminders` (clinic table): `(clinic_id, id)` PK, `expires_at`,
  `created_at`, `UNIQUE (clinic_id, expires_at)`, RLS enabled and forced with the standard policy,
  `eyadex_app` SELECT, INSERT; in `db/tests/rls-isolation.sql` (list + seed) and mirrored in Drizzle.

### 3. Clinic side

| Route                     | Access                                      | Audit (clinic log)        |
| ------------------------- | ------------------------------------------- | ------------------------- |
| `GET /v1/clinic/settings` | `@Require("view:clinic_settings:clinic")`   | —                         |
| `PUT /v1/clinic/settings` | `@Require("update:clinic_settings:clinic")` | `clinic.settings_updated` |
| `GET /v1/account`         | `@Authenticated()`                          | —                         |
| `PUT /v1/account`         | `@Authenticated()`                          | `user.profile_updated`    |

- Settings: the clinic row is locked `FOR UPDATE` under `withTenant`; before/after are
  `{ nameAr, nameEn, defaultLanguage, timezone }`; the time zone must be one of `timezoneOptions`.
- Account: the caller's own membership only (`full_name`, `preferred_language`); before/after
  `{ fullName, preferredLanguage }`. `auth_users.name` is not changed (Better Auth's `update-user` is
  not on the allowlist); every clinic screen reads the membership name.
- Names typed by a person go through the strict audit scrub (`scrubAuditText`, `@eyadex/observability`).
- Both writes call `AuthorizationInvalidator.clinicChanged` after commit (the member snapshot carries
  names, language and time zone).
- **Password** (story 64): Better Auth's `POST /auth/change-password` (allowlisted and rate-limited
  since slice 2c, ADR-0005), with `revokeOtherSessions: true`. No hand-written auth code.
- **Banner** (story 30): `/v1/me` gains `expiresInDays` — days left (rounded up) when the expiry is
  within `platform_settings.alert_days_before_expiry`, else `null`; computed on the API clock.

### 4. Platform side (all `@PlatformStaff()`, `eyadex_platform` pool)

| Route                                     | Audit (platform log)           | Notes                      |
| ----------------------------------------- | ------------------------------ | -------------------------- |
| `GET /v1/platform/me`                     | —                              | the signed-in account      |
| `GET /v1/platform/overview`               | —                              | stories 3–4                |
| `GET /v1/platform/clinics?status=expired` | —                              | effective status (below)   |
| `GET`/`PUT /v1/platform/settings`         | `platform.settings_updated`    | story 26                   |
| `GET /v1/platform/team`                   | —                              | cursor, oldest first       |
| `POST /v1/platform/team`                  | `platform_account.invited`     | `Idempotency-Key` required |
| `POST /v1/platform/team/:id/deactivate`   | `platform_account.deactivated` | ADM-02                     |
| `POST /v1/platform/team/:id/reactivate`   | `platform_account.reactivated` |                            |
| `POST /v1/platform/invitations/inspect`   | —                              | public, platform host only |
| `POST /v1/platform/invitations/accept`    | `platform_account.joined`      | public, platform host only |

- **Effective status** (SUB-02): `suspended` if stored suspended; else `expired` when
  `expires_at <= now` (the guard's own boundary, `decideClinicAccess`); else the stored status. The
  overview counts all four; `expiringSoon` lists clinics not suspended with `now < expires_at <=
now + alertDays`, soonest first, `daysLeft` rounded up. The list filter `status` takes the four
  effective values (`trial`/`active` exclude expired clinics). `now` is the injected Clock. The
  contract helper `effectiveClinicStatus` moves to the same boundary (`<=`).
- **Gate** (closes ADR-0009's TODO): after the TOTP check, `@PlatformStaff` requires a
  `platform_accounts` row with this `user_id` and `status = 'active'`, else 401 `account_disabled`.
  It is read on every request (no cache). Without the gate mounted every platform route answers 500
  (fail closed, like an unmounted clinic context).
- **Invite**: `reserve_platform_email` (0015) in the same platform transaction (`email_taken` when any
  clinic or account holds it); 32 random bytes, SHA-256 stored, 7-day expiry; one outbox event
  `platform.team_invited` (`clinic_id` NULL) with the token sealed to the event id (ADR-0006). The
  idempotency ledger (0025, scope `platform:team-invite:<actor>`) stores ids only. Inviting the email
  of an account that is still `invited` re-issues its link (new hash and expiry, new event, audited
  as `invited` again); any other existing account is `email_taken`.
- **Actor re-check**: every team write re-reads the actor's own row after the team lock and refuses
  with `account_disabled` unless it is still `active`, so a deactivation that commits while a request
  waits for the lock wins (no self-reactivation).
- **Deactivate / reactivate**: a global `pg_advisory_xact_lock('platform_team')`, the row `FOR
UPDATE`, the clock after the locks. Deactivating the last `active` account →
  `last_active_platform_account` (409, ADM-02); an `invited` account kills its link. After commit
  the account's platform sessions are revoked (PRD §4.10). Reactivate restores `active` when
  `joined_at` is set, otherwise `invited` (the mock's rule). Repeating a state is a no-op without
  audit.
- **Accept** (ADR-0008 shape): token in the body only, one answer `invitation_invalid` (404) for
  anything unusable. The row is locked `FOR UPDATE` on the platform pool; holding it, the account is
  created on the **platform** Better Auth instance (or, after a failed earlier attempt of the same
  link, the platform-area account with that email gets the new password); a clinic-area account with
  the email → `account_other_area`. Then `user_id`, `joined_at`, `status = 'active'`, the hash is
  cleared and one `platform_account.joined` row is written (actor = the new account). The person
  then signs in and the existing mandatory TOTP enrolment runs. An orphan auth account left by a
  failed attempt reaches nothing: the gate needs the linked, active row. Rate limits as ADR-0008's,
  listed in `PUBLIC_V1_ROUTES`.
- **Platform settings**: the singleton row `FOR UPDATE`, one audit row with before/after.
- **`withNoTenant` for platform-global writes**: `platform_settings` and `platform_accounts` belong to no
  clinic, so their writes run in `withNoTenant` on the platform pool (ADR-0019 §5 extended from reads);
  every clinic table still answers zero rows there.
- **New clinics** take `trialDays` from `platform_settings` when the create request carries neither
  `trialDays` nor `expiresAt` (read inside the onboarding transaction). The web sends neither.
- **Privacy** (PLAT-02): every response schema is strict and has no patient field; the queries read
  `clinics` and `platform_*` tables only, on a role with no grant on `patients`.

### 5. Expiry reminder (story 79, §4.9)

- **Scan** — the worker runs it on start and then every `EXPIRY_SCAN_INTERVAL_MS` (default one hour):
  on a new `PLATFORM_DATABASE_URL` pool (`eyadex_platform`: `clinics` and `platform_settings`, never
  patients) it lists clinics not suspended with `now < expires_at <= now + alert days`, paged by
  `(expires_at, id)` to the end. For each, on
  the `eyadex_app` pool under `withTenant(clinic)`, one transaction re-reads the clinic, re-checks the
  window, reads the active members holding the system `clinic_admin` role (none → nothing is recorded,
  so the clinic is reminded once it has an admin), inserts `clinic_expiry_reminders (clinic_id,
expires_at)` `ON CONFLICT DO NOTHING` and only when a row was inserted appends one
  `clinic.expiry_reminder` per admin (`{ clinicId, reminderId, expiresAt, membershipId, daysLeft }`).
  The unique key makes it once per clinic per expiry date whatever the tick rate or replica count;
  a renewal is a new date and earns one new reminder. Access never depends on this job (SUB-02).
- **Send** — the dispatcher handler re-reads under `withTenant`, holding the clinic row and the
  recipient's membership and role `FOR SHARE` until the send returns (a renewal, suspension or demotion
  waits, as in ADR-0013): skip (no email) when the clinic is
  suspended, its `expires_at` differs from the event's (renewed or changed), it has already expired,
  or the event's member is no longer an active clinic admin. Always platform mail (owner decision
  2026-10-07: billing mail is platform-sent), in the clinic's default language (story 82), the date in
  the clinic's time zone. The days left and the date come from the event, so a retry sends the same
  body under the same idempotency key (the event id), and one failing admin never holds up another.
  Retries follow ADR-0013's schedule.
- **Sender name** (story 26): every message the platform sends under its own name (no explicit
  `from`) gets `platform_settings.email_sender_name` as the display name on the `MAIL_FROM` address;
  on-behalf and clinic-provider messages keep their own name (ADR-0014). The name is read on a
  one-connection pool of its own: a send runs inside the invitation's or the team row's transaction,
  and a pool refuses a nested one.
- **Changed bodies under one key** — a Resend `409 invalid_idempotent_request` means an earlier
  attempt of the same event (its id is the key) was accepted and a value read at send time changed
  since (the sender name, a clinic name); the worker counts it as sent instead of failing the event.
- **Platform invitation mail** — `platform.team_invited`: open the sealed token, then on the platform
  pool hold the account row `FOR SHARE` through the send and mail only when it is still `invited`,
  unexpired and the hash matches; link `${PLATFORM_URL}/invite/<token>`; Arabic and English in one
  message (a platform account has no language).

### 6. Web

`http-unserved.ts` and the unserved list are removed. The HTTP adapter serves the five namespaces;
the platform host's `/invite/<token>` page calls the platform inspect/accept routes; the platform
shell reads `/v1/platform/me` (so a deactivated account sees `account_disabled`); the account page
gets a password dialog (HTTP only; the mock has no passwords and keeps the button disabled). The mock
filters the clinic list by effective status and counts "expired" with the same boundary.

## TODO(spec) — conservative choices made here

1. A never-accepted platform invitation holds its email forever (`reserve_platform_email` has no
   release); re-inviting the same email re-issues the link instead.
2. Platform invitation email is bilingual (no language on a platform account).
3. ~~Default user/branch limits for new clinics stay `10` / `3` in the web (story 26 lists trial
   days, alert days and sender name only).~~ Resolved by the 2026-10-09 amendment below.
4. A reminder to several admins is one event (and message) each; an SMTP fallback retry may repeat
   one (no idempotency on SMTP, ADR-0014). Recipients are fixed at the scan: an admin added later in
   the same window gets no reminder for that expiry date.
5. Platform account names are not editable (no story); `auth_users.name` is set at acceptance.
6. Scan interval one hour; the PRD's "daily" is satisfied by the ledger, not by the tick.

## Consequences

- Production needs SQL 0036–0038, the worker needs `PLATFORM_DATABASE_URL` and `PLATFORM_URL`
  (optional `EXPIRY_SCAN_INTERVAL_MS`), and the owner's platform account must be checked active after
  0037's backfill. A platform account created later by hand needs its `platform_accounts` row.
- Every platform request reads one row more (the gate).
- CI's worker `test:db` step now also gets `EYADEX_TEST_PLATFORM_URL` (the scan and the team-link check).
- The web has no "coming soon" page left in HTTP mode; the clinic-detail tabs ADR-0016 kept
  coming-soon (first-admin card, details write, members) are unchanged.

## Amendment (2026-10-09) — default limits and modules for new clinics

Owner decision 2026-10-09 (option ج), closing TODO(spec) 3: the default max users, default max
branches and default modules for a new clinic become platform settings, edited on the platform
settings page beside the default trial days. Seed = today's web values: 10 users, 3 branches,
`patients` on.

- **Contract.** `platformSettingsSchema` (GET/PUT `/v1/platform/settings`, both strict) gains
  `defaultMaxUsers`, `defaultMaxBranches` (the same bounds as a clinic's own limits,
  `CLINIC_LIMIT_BOUNDS`: 1–1000, 1–100, so every default is a valid create) and
  `defaultModules` — the clinic module map itself (`featuresSchema.strict()`).
- **The create request keeps requiring the values.** `POST /v1/platform/clinics` already required
  `maxUsers`, `maxBranches` and `modules`; it stays that way. The create form is pre-filled from the
  settings (`newClinicDefaults`) and sends what the super admin kept or changed, so the server never
  silently picks a limit or a module, and a settings change never alters a request in flight. The
  web's hardcoded `NEW_CLINIC` and its TODO(spec) are gone; the mock does the same.
- **Modules: one map typed from one list.** `CLINIC_MODULES` (`onboarding.ts`) is the only list of
  modules; `moduleSchema`, `featuresSchema` (a clinic's features), a create request's `modules`, the
  platform detail's `modules` and `defaultModules` are all derived from it. The next module
  (`appointments`) joins by adding its name there; these maps, the module switches of the create
  form and of the settings page (`moduleSchema.options`) and the audit rows follow without
  reshaping the setting.
- **SQL 0041: one boolean column per module, not jsonb.** `default_max_users`, `default_max_branches`
  (CHECKs equal to the contract's bounds) and `default_module_patients`, all `NOT NULL`, the existing
  row seeded by a temporary DEFAULT dropped in the same file (so a later write always names its
  values). A column per module keeps NOT NULL and a type the database enforces, and matches
  `clinic_features`, whose `CHECK (module IN ('patients'))` already makes any new module a migration;
  a jsonb map would need a hand-written shape CHECK and still a migration to seed the new key. The
  API maps the columns to `defaultModules` in one place (`readPlatformSettingsIn`), where a module
  added to the list fails typecheck until mapped. **Adding a module:** the name in `CLINIC_MODULES`
  → a `default_module_<name>` column (NOT NULL, seeded) + its column grant in a new SQL file, the
  Drizzle mirror and `db/tests/settings-and-team.sql` → the map line in `readPlatformSettingsIn`
  and the `UPDATE` in `PlatformSettingsChanges` → i18n `clinics.modules.<name>` / `<name>Body`.
- **Grants unchanged in kind.** `eyadex_platform` gets `UPDATE` on the three new columns (0036 grants
  a column list); `eyadex_app` keeps its table-level `SELECT` and gets no write. No other role reads
  the table (`db/tests/settings-and-team.sql`).
- **Audit.** A settings save records before/after as before; the `platform_settings` allowlist adds
  the three fields (no secret among them). The audit dialog shows a module map as the modules
  switched on.

TODO(spec): PRD §4.8 opens default modules "by specialty"; this amendment keeps one platform-wide
default (the owner's decision), and a per-specialty table stays open.
