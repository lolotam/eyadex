# ADR-0029 — Visits, doctor notes, signing, addenda and the medical file

- Status: accepted (owner decisions 2026-10-10, P2 spec §1; plan Tasks 5–9, 11, 12 with amendments R1–R3)
- Date: 2026-10-11

## Context

P2 (docs/specs/medical-design.md) adds the clinical core every specialty shares: a visit started from an
arrived appointment or as a walk-in, a four-section doctor note that locks on signing, addenda after that,
the five-section medical file, and a search inside one patient's notes. Every clinical value is encrypted
(ADR-0028); SQL 0046 created the tables, the `medical` module flag and its ten catalogue keys.

## Decision

1. **A new `medical` module** (`apps/api/src/modules/medical/`, laid out like `appointments`). It names only
   its own tables (`visits`, `visit_notes`, `visit_addenda`, `patient_medical_profiles`, from 0047–0048
   `visit_diagnoses`, `visit_prescription_items`, `clinic_medicines`, `icd10_codes`, and from 0049
   `patient_attachments`); patients' files,
   appointments, members, branches and the clinic's names come through ports it owns, bound in
   `medical.module.ts` to adapters their owners export from `index.ts`: `PgMedicalPatients` (patients),
   `PgVisitAppointments` (appointments), `PgProviderDirectory` (identity), `PgFilingBranches` and
   `PgClinicNames` (tenancy).
   `module-boundaries.spec.ts` pins the tables and the imports; patients and appointments import nothing
   of medical.
2. **`own` is one predicate.** `patients/queries/own-patients.ts` reads `visits` read-only beside
   `appointments`: a patient is the caller's with a live appointment **or any visit** with it, whatever the
   visit's status (R1-18). The same predicate serves `view:patients:own`, `view:visits:own` and the
   `medical` own keys. `view:visits:own` therefore shows every visit of an own patient, other providers'
   included (P2-4); `view:visits:branch` filters on the visit's branch; `view:medical:*` decides the
   content (`content: null` without it, P2-5, P2-K4).
3. **Writes.** Only the visit's provider writes (`visit_not_provider`, P2-3). A draft is saved, signed
   (`visit_empty` without a non-empty section or an active diagnosis) or cancelled with a
   reason; a signed visit only gains addenda (`visit_signed` otherwise; an addendum on a draft is
   `visit_not_signed`); a cancelled visit takes nothing (`invalid_transition`). Starting from an
   appointment needs the caller as its provider (`forbidden`) and `arrived` (`appointment_not_arrived`);
   one live visit per appointment (`visit_exists` with `details.visitId`, the partial unique index of 0046
   as the backstop). `POST /v1/visits` takes an `Idempotency-Key` and stores only `{ id }`.
4. **Walk-in.** The caller works in the branch (re-read under its membership row lock) and the file is an
   active file **registered in that branch** — the set the walk-in candidate search returns (R3-1).
   TODO(spec): a walk-in for an own patient registered in another branch is refused (`not_found`) until
   the owner decides otherwise.
5. **Lock order** (amends ADR-0027 by inserting two locks): a medical-file save takes
   `medical_profile:<clinic>:<patient>` (advisory) first, between items 3 and 4, then the patient row; a
   visit write takes the provider lock (item 4, the caller), then the `visits` row `FOR UPDATE` (beside item
   5), then checks the status — so a save queued behind a sign finds the visit signed and writes nothing.
   A start takes the provider lock, the appointment row, the membership row, the patient row and the branch
   row, each one the INSERT references locked at its place.
6. **Encryption at the boundary of the module.** Every `*_enc` value is sealed with `ClinicalCipher`
   (`FieldCipher`, ADR-0028) bound to `{ table, column, rowId }` of its own row (`visit_notes` sections to
   the note row's id, addenda and profiles to theirs, `cancel_note_enc` to the visit); an empty section is
   stored `NULL`. A note or a medical file row is inserted on its first save and updated by id afterwards
   (never an upsert), so an envelope is never left bound to an id that lost a race.
7. **Audit.** Every row is `patient_access` (0046 refuses otherwise): writes record
   `{ before: null, after: { changed: [field names] } }`, reads record no details. Reads of content are
   audited: `visit.opened` (only when content goes out), `visit.previews_listed` (a list page carrying a
   preview), `visit.searched`, `visit.walk_in_searched` (no entity, the branch), `medical_profile.opened`.
   A read across a patient's visits names the patient (`entity_type = 'patient'`); a medical file row names
   the patient as its entity (one file per patient, which may not exist yet). No value, query or code ever
   reaches `details`.
8. **Search (P2-F4).** `POST /v1/patients/:id/visits/search` (query in the body, R2-1) reads the patient's
   500 newest visits inside the caller's visits reach, decrypts notes and addenda in memory, folds Arabic
   letter forms, diacritics and Latin case (`domain/text-match.ts`), requires every query word, then pages
   by `(started_at, id)`.

9. **Diagnoses and the prescription (P2-8, P2-9; 0047, 0048).** Each is one list the provider replaces whole
   on a draft (`PUT /v1/visits/:id/diagnoses`, `/prescription`) under the same locks as a note save: the
   active rows are archived (`archived_at`) and the new list is inserted with new ids, every value sealed to
   its own row (R1-13); the same list writes nothing. Archived rows never leave the stores. An `icd10` item
   whose code is not a billable row of `icd10_codes` is `icd10_unknown` (R2-8). The audit rows are
   `visit.diagnoses_saved` / `visit.prescription_saved` with the entity `diagnosis` / `prescription`, the
   visit's id (the list has no single row) and `changed: ["items"]`. The print
   (`GET /v1/visits/:id/prescription/print`, R2-10) needs the visit inside the visits reach and the content
   inside `view:medical:*`, and is audited as `visit.prescription_printed`. The note search (§8) also reads
   the active diagnoses' code and text.
10. **ICD-10-CM (P2-F1).** `icd10_codes` is global reference data the runtime role only reads.
    `cli/load-icd10.ts` (in the API image) turns the CDC order file on stdin into one upsert transaction on
    stdout, which the orchestrator applies as the owner with psql, like a migration; the command never
    connects to the database. `POST /v1/icd10/search` answers 20 billable codes: code prefixes (dot or not)
    first, then titles starting with the first word, then by code; every word must be in the title (a
    trigram index serves it). It is not audited (reference data) and its body is never logged.
11. **The clinic's medicines (P2-F2, R3-3).** `/v1/medicines` under `view:medicines:clinic` /
    `update:medicines:clinic`; a name is unique per clinic whatever its status (`medicine_name_taken`);
    deactivated, never deleted. Every write holds the advisory lock `medicines:<clinic>` alone (no other
    lock in the same transaction, so ADR-0027's order is untouched) and writes one `administrative` row
    that names fields only, never a medicine.
12. **Release (P2-F6, spec §9; 0050).** New clinics' system roles (`identity/domain/system-roles.ts`, the
    web mock's `seed-roles.ts` alike): the doctor holds `view:visits:own`, `create:visits:own`,
    `view:medical:own`, `update:medical:own` and `view:medicines:clinic`; the receptionist
    `view:visits:branch`; the locked admin every clinic-scope key except the `medical` resource, so
    `view:visits:clinic` and both medicines keys but never clinical content (P2-5). 0050 gives existing
    clinics' system roles the same keys, found by `system_key` (the admin only when locked); custom roles
    never change, and a role already holding a key of the same action and resource at another scope
    keeps that one alone (R1-16). It sets `default_module_medical = true` and switches no clinic's
    `medical` flag; the API stops refusing that default (`MEDICAL_RELEASED`, R3-6c). A clinic created by
    the code that predates the release, between the migration and the deploy, is fixed by
    `db/maintenance/medical-release-catch-up.sql` (the same statement, idempotent), run on each
    environment after the deploy and before the platform switches `medical` on for any clinic (R2-5,
    R3-6d). `db/tests/medical-release.sql` checks the catch-up and the admin invariant;
    `db/tests/medical-release-backfill.sh` checks 0050 on an existing clinic and that both statements
    match.
13. **Attachments (P2-10, spec §6; 0049).** `POST /v1/patients/:id/attachments` (multipart, the only
    multipart route: `registerAttachmentUploads`), `GET /v1/patients/:id/attachments`,
    `GET /v1/attachments/:id` (`cache-control: private, no-store`) and `POST /v1/attachments/:id/archive`,
    under `update:medical:*` / `view:medical:*` and the patient inside that reach. The bytes are sealed with
    `ClinicalCipher.sealBytes` bound to the attachment's own id before they reach the `BlobStore` port
    (Openinary from `MEDICAL_BLOB_*`; unconfigured answers 503 on upload and download only), stored at
    `clinic/<clinic>/<attachment>` with no name or patient data in the path; the row keeps the type, the
    size, the plaintext's SHA-256 (checked again on download) and the name sealed in `name_enc`. The upload
    checks the target twice, before the blob leaves and again under the visit row then the patient row
    (ADR-0027), so no transaction holds a lock across the network; a named visit must be one of the
    patient's that the caller can see (`attachment_patient_mismatch`). An attachment is archived, never
    deleted; an archived one is `not_found` on download (TODO(spec)). Audit rows `attachment.uploaded`,
    `attachment.downloaded` and `attachment.archived` name fields only. The visit page lists the visit's
    active attachments.

## Consequences

- The platform has no grant on any medical table and its audit view excludes every medical entity (0046).
- A role gains a medical key only by the admin's bounded delegation (R1-2), from a member holding the key
  (the visits and medical `own` keys need their clinic key, R1-3), from the new-clinic templates or at
  the release (0050). Granting the default doctor role therefore needs its visits, medical and medicines
  keys (or their clinic keys): a user manager without them can no longer invite or move a doctor; the
  admin still can.
- A blob whose row then fails to commit stays in the store as ciphertext no row points at.
- A later ICD-10-CM release is loaded over the same table; codes it drops keep their old `release` value,
  so a diagnosis already written still validates against its code until a cleanup is decided.
