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
   `BranchReader` ports, and `PgFilingBranches`, which implements the patients-owned
   `PatientBranchReader`) and identity's `index.ts` only (guards and request types). It owns no new
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
   The stored idempotency response is `{ id, fileNumber }` only. A replay takes the patients lock first and reads
   the file once; the create scope and the view scope are both judged on that row, and every write
   answer likewise decides `detail` on the row it returns, never on an earlier read (a file moved out
   of scope in between is never disclosed). The request fingerprint is an unkeyed SHA-256 of the normalized
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
   API-only). Before the shared sanitiser, the writer runs a stricter patients-only pass over every
   string but a UUID, at any depth (`shared/patient-audit-text.ts`): invisible format/control
   characters (`\p{Cf}`, and `\p{Cc}` except ordinary whitespace) removed, NFKC plus Arabic-Indic
   digits folded to ASCII, then every run of 8+ digits masked wherever it sits — 12+ digits replaced whole,
   shorter runs keep their last 3 — so a civil ID or phone glued to a name, or typed in full-width or
   Arabic-Indic digits, never reaches the append-only row.
8. **Branch tables, through a port.** `branches` belongs to tenancy, so patients never queries it
   (apps/api/AGENTS.md). Patients defines `PatientBranchReader` (`ports/patient-branch-reader.ts`):
   `lockForFiling(tx, clinic, branch)` reads the target branch `FOR SHARE` inside the patients
   transaction (a parallel deactivation waits), and `namesOf(tx, clinic, ids)` returns the names of a
   whole page in one call (no N+1). Tenancy implements it (`PgFilingBranches`, exported from its
   `index.ts`) without importing patients — the class matches the port structurally, and the patients
   module binds it through a variable typed with the port, so a drift fails the type check. The list
   and detail queries read `patients` only and take the names from the port. The branch options use
   the same port's `listForOptions(tx, clinic, language)`, so patients depends on no tenancy-owned
   reader or DTO at all.
9. **Search digits in any script.** The digits of a search term are folded to ASCII first
   (`searchDigits` in the contract: NFKC for full-width digits, `normalizeCivilId` for Arabic-Indic
   and Persian ones), in the API and the mock alike, so a phone, file number or civil ID typed on an
   Arabic or Persian keyboard still finds the file.
10. **Invisible controls in free text.** The contract (`stripInvisibleControls` in
    `patients.ts`) removes `\p{Cf}` (ZWJ, ZWNJ, bidi marks, overrides and isolates, soft hyphen, BOM)
    and `\p{Cc}` except ordinary whitespace from a patient name and from the search term before they
    are trimmed and validated. They render as nothing, so they could only split an identifier past a
    check, reorder a name on screen (bidi spoofing) or make search miss; the conservative choice is to
    store and search the visible text. The web form, the mock and the API share the schema, so all
    three normalize the same way. The audit scrub strips them again on its own (defence in depth).
    Cost: a ZWNJ some Persian spellings use inside a word is dropped, which changes nothing a reader
    sees in Arabic or English names.
11. **The platform** has no route here and no grant change; the existing PLAT-01 negatives hold.
12. **List order index (`db/sql/0035`).** The list pages newest file first with a
    `file_number::bigint` cursor. The unique `(clinic_id, file_number)` index orders text, so
    0035 adds `(clinic_id, (file_number::bigint))`, read backwards for `DESC`, mirrored in
    `packages/db`. It is 0035, not the reserved 0033, because 0034 was already applied in
    production and the runner refuses an out-of-order file.

## Consequences

- The web HTTP adapter serves `patients` (`http-patients.ts`); `/clinic/patients` leaves the
  "coming soon" list.
- Every open of a file adds one audit row; the web query never refetches a file in the background.
- Search is not audited (PRD §4.11 names opening and editing only) — `TODO(spec)`.
- A branch-scoped member is offered only their active branches (the guard's snapshot keeps active
  branches only); the mock also lists a deactivated assigned branch — `TODO(spec)`.
- Column-level encryption of the civil ID stays with the medical-file module (PRD §4.6).
