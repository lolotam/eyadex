# Slice 9 — Patients API (Phase B)

- Status: implemented (2026-10-08), branch `slice-9-patients`
- Owner of the decision record: [ADR-0018](../adr/0018-patients.md)
- PRD: §4.3 (`patients` imports `tenancy` only), §4.5 (grants), §4.6 (Patient, civil ID rule),
  §4.7 (permissions + check order), §4.8 (the `patients` flag), §4.11 (audit), §4.12 (API),
  §6.3 (ISO-01/02, PLAT-01/02, RBAC-01/02, FLAG-01, AUD-01, PAT-01/02), Phase-A screen spec
  ("Patients: list with search (name, phone, file number, civil ID) and filters…").
- Phase-A rules the API must match: `apps/web/src/shared/api/mock/mock-patients.ts` and
  `mock-patient-rules.ts`.

## 1. Stories

| #   | Story                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | A clinic user with `view:patients:*` lists the files in their scope, newest file number first, with a cursor, a search (name, phone, file number, civil ID) and branch / status filters.                                        |
| P2  | The same user opens one file. **Every open writes one patient-access audit row.**                                                                                                                                               |
| P3  | A user with `create:patients:*` registers a file under a branch in their create scope. The file number is the clinic's next counter value (PAT-01). A retried request with the same `Idempotency-Key` returns the first result. |
| P4  | A user with `update:patients:*` edits a file in their update scope (may move it to another branch in that scope).                                                                                                               |
| P5  | A user with `deactivate:patients:*` archives or restores a file in their scope. Nothing is ever deleted.                                                                                                                        |
| P6  | The create / edit form and the list filters offer only the branches inside the scope of that action.                                                                                                                            |
| P7  | One phone per clinic (OD-5 "block"), one civil ID per clinic (archived files included).                                                                                                                                         |
| P8  | The patients module is a feature flag: while it is off, every route answers `module_disabled`.                                                                                                                                  |
| P9  | The platform area never sees patient data: no platform route, no `eyadex_platform` grant.                                                                                                                                       |

## 2. Routes (clinic host only, `/v1` prefix)

Every route declares exactly one `@Require(...)` **and** `@RequiresFeature("patients")`. The global
`AccessGuard` runs PRD §4.7 in order: clinic host → session → active member → clinic allowed →
module enabled (`module_disabled`, 403) → permission (`forbidden`, 403). Branch scope is then
applied by the use case / query (step 5), and RLS is the last line (step 6).

| Method + path                                | Guard key                    | Body / answer                                              |
| -------------------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `POST /v1/patients/search`                   | `view:patients:branch`       | `patientSearchRequestSchema` → `patientListResponseSchema` |
| `GET /v1/patients/branch-options/view`       | `view:patients:branch`       | → `patientBranchOptionListSchema`                          |
| `GET /v1/patients/branch-options/create`     | `create:patients:branch`     | → `patientBranchOptionListSchema`                          |
| `GET /v1/patients/branch-options/update`     | `update:patients:branch`     | → `patientBranchOptionListSchema`                          |
| `GET /v1/patients/:id`                       | `view:patients:branch`       | → `patientDetailSchema` + one `patient.opened` audit row   |
| `POST /v1/patients` (201, `Idempotency-Key`) | `create:patients:branch`     | `patientInputSchema` → `patientWriteResultSchema`          |
| `PUT /v1/patients/:id`                       | `update:patients:branch`     | `patientInputSchema` → `patientWriteResultSchema`          |
| `POST /v1/patients/:id/archive`              | `deactivate:patients:branch` | → `patientWriteResultSchema`                               |
| `POST /v1/patients/:id/restore`              | `deactivate:patients:branch` | → `patientWriteResultSchema`                               |

- A `…:branch` key on the route also passes with the same action at `clinic` scope (`grantFor`).
- **Search is a POST with a body** because its free-text term can be a civil ID or a phone: nothing
  personal ever goes into a URL or query string (proxies and access logs keep URLs).
- `branchOptions(action)` is three static routes because the guard key is static.
- A malformed `:id` answers `not_found`, like another clinic's id (ISO-02).

## 3. Scope rules (identical to the mock)

- Scope of an action = `clinic` key → every branch; else `branch` key → the member's branches
  (`all` when the membership has "all branches"); else none.
- A file outside the caller's scope for that action is `not_found`, never `forbidden`, so it cannot
  be probed (open, update, archive, restore, idempotent replay).
- Create / update target branch: unknown → `not_found`; outside the caller's scope for that action
  → `forbidden`; inactive → `branch_inactive`. Update checks the target only when it changes.
- Per-record `actions.update` / `actions.deactivate` = that action's scope covers the file's branch.
- A write answers `detail` only while the caller's **view** scope covers the file (else `null`).
- Duplicate phone / civil ID: `patient_phone_taken` / `patient_civil_id_taken` (409, details
  `{ patientId, fileNumber }`) only when the caller's view scope covers the existing file; otherwise
  plain `validation` (400), so no hidden file is confirmed. The civil ID is never echoed.
- Birth date: a real date not after today **in the clinic's time zone** on the injected clock.

## 4. Contracts

- Unchanged and shared with the mock: `packages/contracts/src/patients.ts`.
- New HTTP-only file `packages/contracts/src/patients-api.ts` (slice-7 `user-admin.ts` precedent):
  `patientSearchRequestSchema` (strict; `cursor` is opaque base64url ≤ 64 chars or null),
  `patientListResponseSchema`, `patientBranchOptionListSchema`.
- Error codes: all exist already. `patient_phone_taken` and `patient_civil_id_taken` get their HTTP
  status (409) in `apps/api/src/shared/errors.ts`.

## 5. Data, RLS and grants

- No new table, no migration: `patients` (0010, 0019, 0021), `clinic_counters` (0019),
  `audit_log` (0011), `clinic_idempotency_keys` (0028) and their grants already exist.
- Every statement runs inside `withTenant(clinicId)` on the `eyadex_app` pool and also filters
  `clinic_id = …` explicitly (two independent layers).
- Writes take `pg_advisory_xact_lock('patients:' || clinic_id)` first, then read and decide in the
  same transaction: duplicate checks, the branch (`FOR SHARE`), the file-number counter (0019
  upsert). A unique violation that still slips through maps to `validation`, never a 500 that would
  log the constraint detail.
- `eyadex_platform` keeps no grant on `patients` / `clinic_counters` / patient audit rows; nothing in
  this slice touches the platform pool.

## 6. Audit (`audit_log`, category `patient_access`, entity `patient`, `branch_id` = file branch)

| Action             | `details`                                     |
| ------------------ | --------------------------------------------- |
| `patient.opened`   | `{ before: null, after: { id, fileNumber } }` |
| `patient.created`  | `{ before: null, after: snapshot }`           |
| `patient.updated`  | `{ before: snapshot, after: snapshot }`       |
| `patient.archived` | `{ before: snapshot, after: snapshot }`       |
| `patient.restored` | `{ before: snapshot, after: snapshot }`       |

Snapshot allowlist: `id, fileNumber, fullName (phones in text masked), phone (last 3 digits),
gender, registrationBranchId, status`. **No civil ID in any form**, and no birth date (the audit sanitiser removes it anyway, ADR-0001). The writer still runs
`redactSecrets` as defence in depth. Written in the same transaction as the change / open.

## 7. Civil ID handling

- Input: `patientInputSchema` normalizes (Arabic-Indic digits, spaces, dashes) and validates the
  Kuwaiti checksum and the encoded birth date; a failure reports the path and code only.
- Stored as plain text under forced RLS (PRD §4.6), unique per clinic (0021).
- Returned in full only by `open` and by a write's `detail` (both need the view scope); the list
  selects `right(civil_id, 4)` only.
- Never in: a URL, a query string, a log line (request bodies are never logged; the request line
  is the route pattern), an audit snapshot, an error message or details, an idempotency response.
- Idempotency fingerprint: SHA-256 of the normalized input (ADR-0018 §5 explains why a keyed HMAC
  is not needed here).

## 8. Test list

Unit (`apps/api/src/modules/patients/domain/__tests__`): scope resolution, record actions,
search terms, snapshot allowlist (no civil ID, masked phone), birth date in the clinic zone,
duplicate disclosure decision, normalized input + fingerprint.

`test:db` (`apps/api/src/modules/patients/__tests__`, real PostgreSQL as `eyadex_app`):

- happy path of every route;
- RBAC-01: no session 401, no permission 403, platform host 404 — every route;
- FLAG-01: module off → `module_disabled` on every route;
- RBAC-02: branch-scoped receptionist: list / options limited, out-of-branch open / update / archive
  → 404, create into another branch → 403;
- ISO-02: another clinic's id → 404, its list never contains our files; RLS: `eyadex_app` with the
  other clinic's context reads 0 rows;
- PLAT-01: the `eyadex_platform` login cannot read `patients`; PLAT-02: no `/v1/platform/**` route
  requires a patients key and every patients route is a clinic route;
- open → exactly one `patient.opened` row per open, without civil ID;
- idempotent replay (same answer, one file, one audit row) and conflict (409), missing key (400);
- archive / restore (no hard delete, no-op when unchanged);
- PAT-01: two parallel creates get consecutive file numbers; PAT-02: duplicate phone in one clinic
  refused, same phone in two clinics accepted;
- privacy: audit rows, error bodies, the idempotency ledger and the logger output of create / update /
  open contain no civil ID and no full phone.

Web vitest: `apps/web/src/shared/api/http/__tests__/patient-routes.test.ts` stubs `fetch` per method
(method, path, body, headers, `credentials`, civil ID never in a URL); mock rule tests for any mock
change.

Every negative test is proven to fail with its guard removed (reported in the slice report).

## 9. Implementation plan

1. Commit this spec.
2. Contracts: `patients-api.ts`; status codes for the two duplicate errors.
3. API module `apps/api/src/modules/patients/`: `domain/patient-rules.ts` (+ unit tests) →
   `persistence/pg-patient-store.ts` → `queries/patient-views.ts` → `use-cases/` (changes, open) →
   `http/patients.controller.ts` → `patients.module.ts` + `index.ts`; patient-access audit writer in
   `apps/api/src/shared/patient-audit.ts`; register in `app.ts` under `mountClinic`.
4. `test:db` specs + fixtures; run the SQL suite first; prove each negative.
5. Web: `http-patients.ts`, wire it in `http-adapter.ts`, drop `patients` from `http-unserved.ts`
   and `unserved-paths.ts`; mock snapshot phone masking; vitest.
6. ADR-0018, `roadmap.md` bullet, `apps/api/AGENTS.md` rule.
7. Gates: typecheck, lint, per-package test, `build:all`, prettier on touched files, SQL suite,
   API `test:db`. Push `slice-9-patients`.

## 10. Open items (`TODO(spec)`)

- Searching the list is not audited (PRD §4.11 lists opening and editing a file only).
- The audit snapshot masks the phone and leaves out the birth date (API rule); the Phase-A mock
  mirrors the field allowlist and the phone mask. Masking phone numbers written inside the name is
  API-only (the web app has no dependency on `@eyadex/observability`, and none is added).
- Search by civil-ID digits matches any run of digits (mock parity; a web test relies on it). The
  more conservative reading — an exact 12-digit match only — was not taken because the Phase-A rule
  is binding; the list answer still carries only the last 4 digits, and search runs inside the view
  scope only.
- A duplicate the caller cannot see answers `validation` without `details`, while a schema failure
  carries field details, so the two are distinguishable (same as the mock). The unique constraint
  makes some signal unavoidable; the existing file is never identified.
- `branchOptions` for a branch-scoped member offers only the member's **active** branches (the
  guard's snapshot keeps active ones only); the mock also lists a deactivated assigned branch.
