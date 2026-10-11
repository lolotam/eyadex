# ADR-0029 — Visits, doctor notes, signing, addenda and the medical file

- Status: accepted (owner decisions 2026-10-10, P2 spec §1; plan Tasks 5, 6, 7, 11 with amendments R1–R3)
- Date: 2026-10-11

## Context

P2 (docs/specs/medical-design.md) adds the clinical core every specialty shares: a visit started from an
arrived appointment or as a walk-in, a four-section doctor note that locks on signing, addenda after that,
the five-section medical file, and a search inside one patient's notes. Every clinical value is encrypted
(ADR-0028); SQL 0046 created the tables, the `medical` module flag and its ten catalogue keys.

## Decision

1. **A new `medical` module** (`apps/api/src/modules/medical/`, laid out like `appointments`). It names only
   its own tables (`visits`, `visit_notes`, `visit_addenda`, `patient_medical_profiles`); patients' files,
   appointments, members and branches come through ports it owns, bound in `medical.module.ts` to adapters
   their owners export from `index.ts`: `PgMedicalPatients` (patients), `PgVisitAppointments`
   (appointments), `PgProviderDirectory` (identity) and `PgFilingBranches` (tenancy).
   `module-boundaries.spec.ts` pins the tables and the imports; patients and appointments import nothing
   of medical.
2. **`own` is one predicate.** `patients/queries/own-patients.ts` reads `visits` read-only beside
   `appointments`: a patient is the caller's with a live appointment **or any visit** with it, whatever the
   visit's status (R1-18). The same predicate serves `view:patients:own`, `view:visits:own` and the
   `medical` own keys. `view:visits:own` therefore shows every visit of an own patient, other providers'
   included (P2-4); `view:visits:branch` filters on the visit's branch; `view:medical:*` decides the
   content (`content: null` without it, P2-5, P2-K4).
3. **Writes.** Only the visit's provider writes (`visit_not_provider`, P2-3). A draft is saved, signed
   (`visit_empty` without a non-empty section; diagnoses join the count with 0047) or cancelled with a
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

## Consequences

- The platform has no grant on any medical table and its audit view excludes every medical entity (0046).
- A role gains a medical key only by the admin's bounded delegation (R1-2) or at the release migration.
- Diagnoses, prescriptions and attachments plug into `visitDetail`'s empty arrays and the signable count.
