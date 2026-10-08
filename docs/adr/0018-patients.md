# ADR-0018: Patients

- Status: accepted (Phase B slice 9, 2026-10-08)
- Related: ADR-0001 (log redaction), ADR-0002 (database access), ADR-0009 (guard), ADR-0010
  (feature flags), ADR-0011 (branches, clinic idempotency), ADR-0012 (users)
- Spec: [`docs/specs/slice-09-patients.md`](../specs/slice-09-patients.md)

## Context

The web app's patients screens (list, file page, create / edit, archive / restore) ran on the Phase-A
mock only. Patient files are personal health data: the PRD requires branch scope (§4.7), the
`patients` feature flag (§4.8), an audit row for every file opened or changed (§4.11), one phone and
one civil ID per clinic (§4.6, OD-5), sequential file numbers (PAT-01), and a platform that never
sees any of it (§4.5, PLAT-01/02). The tables, grants and counters already exist (0010, 0019, 0021).

## Decision

1. **A `patients` module** (`apps/api/src/modules/patients`) that imports `tenancy` (the `Clock` and
   `BranchReader` ports) and identity's `index.ts` only (guards and request types). It owns no new
   table and adds no migration.
2. **Routes** (clinic host, `/v1/patients`): `POST /search`, `GET /branch-options/{view,create,update}`,
   `GET /:id` (open), `POST /` (create, `Idempotency-Key`), `PUT /:id`, `POST /:id/{archive,restore}`.
   Each declares one `@Require("<action>:patients:branch")` and `@RequiresFeature("patients")`, so
   the global guard answers `module_disabled` / `forbidden` before any handler runs. The branch
   options are three routes because a guard key is static.
3. **Nothing personal in a URL.** The list query (whose term can be a civil ID or a phone) is a POST
   body; the only path parameter is the opaque file id. The request log line is the route pattern.
4. **Branch scope in the module, as a second check.** The scope of each action is computed from the
   caller's effective keys and branches (`domain/patient-rules.ts`: clinic key → every branch, branch
   key → the member's branches, else none). A file outside the action's scope is `not_found`; a
   target branch outside it is `forbidden`; per-row `actions` and a write's `detail` follow the same
   rule. These are exactly the Phase-A mock's rules.
5. **Writes** run in one `withTenant` transaction under `pg_advisory_xact_lock('patients:' ||
clinic_id)`: the idempotency claim (clinic ledger, scope `patients:create:<userId>`), the target
   branch `FOR SHARE` (a parallel deactivation waits), the duplicate checks, the 0019 counter upsert,
   the row and the audit row. A unique violation that still slips through is a plain `validation`.
   The stored idempotency response is `{ id, fileNumber }` only; a replay re-reads the file under the
   caller's current create scope. The request fingerprint is an unkeyed SHA-256 of the normalized
   input: unlike the mail-provider credentials (ADR-0014), the civil ID is not a secret from the
   readers of `clinic_idempotency_keys` — that table is RLS-bound to `eyadex_app` of the same clinic,
   which reads `patients.civil_id` directly — so a keyed HMAC would add an environment key without
   reducing exposure.
6. **Duplicate disclosure.** `patient_phone_taken` / `patient_civil_id_taken` (409, `{ patientId,
fileNumber }`) only when the caller's view scope covers the existing file; otherwise `validation`
   (400) with no details. The civil ID is never echoed.
7. **Audit.** A new shared writer (`shared/patient-audit.ts`) writes category `patient_access`,
   entity `patient`, `branch_id` = the file's branch, in the same transaction: `patient.opened`
   (`{ id, fileNumber }` only — every open, so a refused open writes nothing), `patient.created`,
   `patient.updated`, `patient.archived`, `patient.restored`. Snapshots are an allowlist: id, file
   number, name (phones in it masked), phone (last 3 digits), gender, branch, status — no civil ID
   and no birth date (the audit sanitiser removes birth dates anyway, ADR-0001). The Phase-A mock's
   snapshot mirrors the field allowlist and the phone mask (masking phones inside the name is
   API-only).
8. **Branch tables.** Branch names and the target-branch check are read with a join / `FOR SHARE`
   inside the patients transaction, the same way identity reads `branches` (identity → tenancy):
   patients → tenancy is an allowed arrow, and the decision must be taken inside the writing
   transaction. The branch options use tenancy's `BranchReader` port.
9. **The platform** has no route here and no grant change; the existing PLAT-01 negatives hold.

## Consequences

- The web HTTP adapter serves `patients` (`http-patients.ts`); `/clinic/patients` leaves the
  "coming soon" list.
- Every open of a file adds one audit row; the web query never refetches a file in the background.
- Search is not audited (PRD §4.11 names opening and editing only) — `TODO(spec)`.
- A branch-scoped member is offered only their active branches (the guard's snapshot keeps active
  branches only); the mock also lists a deactivated assigned branch — `TODO(spec)`.
- Column-level encryption of the civil ID stays with the medical-file module (PRD §4.6).
