# Visits, doctor notes and the medical file — design (post-MVP phase 2)

- Status: owner decisions taken 2026-10-10 (decisions page batches 7 and 8). Not implemented yet.
- PRD: §8.3 item 2 ("sessions, doctor notes and the medical file, with column encryption"), §4.6 (civil ID
  column encryption "is decided with the medical file module"), §4.7 (permissions), §4.8 (module flags),
  §4.11 (audit), §5 (database rules), §8 (security: the platform never sees patient data).
- Decision records to write with the work: ADR-0028 (field encryption and the civil ID blind index),
  ADR-0029 (visits, notes, signing and addenda, the `medical` permissions).
- Vocabulary: the Arabic UI says «زيارة» for a visit and «المراجع» for the patient, never «المريض».

## 1. Owner decisions (2026-10-10)

| #     | Question                               | Decision                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1  | What first                             | The shared core for every specialty: visits, doctor notes, the medical file. Specialty sections come later, on top of it.                                                                                                                                                                                                                                                                                                   |
| P2-2  | How a visit starts                     | From an appointment once the patient has arrived, or as a walk-in visit with no appointment.                                                                                                                                                                                                                                                                                                                                |
| P2-3  | Who writes a visit's notes             | The visit's provider only.                                                                                                                                                                                                                                                                                                                                                                                                  |
| P2-4  | What a doctor reads                    | Every visit of the doctor's own patients, including visits written by another doctor (continuity of care).                                                                                                                                                                                                                                                                                                                  |
| P2-5  | Does the clinic admin read notes       | No by default. The key is granted explicitly on the roles screen (§2). The front desk never reads clinical content.                                                                                                                                                                                                                                                                                                         |
| P2-6  | A note after saving                    | A draft is editable; the provider **signs** it and it locks; any correction is an **addendum** (who, when, text), never an edit.                                                                                                                                                                                                                                                                                            |
| P2-7  | The medical file                       | Allergies, chronic conditions, current medications, **surgical history and family history**.                                                                                                                                                                                                                                                                                                                                |
| P2-8  | Diagnosis                              | The doctor chooses per diagnosis: free text **or** an ICD-10 code.                                                                                                                                                                                                                                                                                                                                                          |
| P2-9  | Prescription                           | **In P2**: medicines written on the visit, printable.                                                                                                                                                                                                                                                                                                                                                                       |
| P2-10 | Attachments (images, lab PDFs)         | **In P2**.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P2-11 | What is encrypted                      | Clinical text (notes, diagnoses, prescriptions, the medical file, attachments) **and the civil ID**.                                                                                                                                                                                                                                                                                                                        |
| P2-12 | Search inside notes                    | **Yes** (scope in P2-F4).                                                                                                                                                                                                                                                                                                                                                                                                   |
| P2-F1 | ICD-10 source                          | ICD-10-CM (CDC/NCHS), English titles.                                                                                                                                                                                                                                                                                                                                                                                       |
| P2-F2 | Medicine names                         | Typed by the doctor; each clinic keeps its own list of frequent medicines to pick from.                                                                                                                                                                                                                                                                                                                                     |
| P2-F3 | Where attachments live                 | A private S3-compatible bucket (MinIO) on the same Dokploy server, internal network only; files encrypted before they leave the API. See §6 (owner 2026-10-11).                                                                                                                                                                                                                                                             |
| P2-F4 | Search inside notes                    | Within one patient's visits only, decrypted in the API at search time.                                                                                                                                                                                                                                                                                                                                                      |
| P2-F5 | Civil ID search once encrypted         | Exact 12-digit match only; the last 4 digits stay visible in lists as today.                                                                                                                                                                                                                                                                                                                                                |
| P2-F6 | Delivery                               | One phase, released together (no separate P2-a/b/c releases). See §9 for how the work still merges in reviewable slices behind the module flag.                                                                                                                                                                                                                                                                             |
| P2-13 | Medical content and the patients reach | Medical content stays **inside the caller's patients view reach** (the rule of `GET /patients/:id`): a read or write naming a patient outside it is `not_found`, and a visit comes without its content. The walk-in search and start stay outside the check (the start makes the file the caller's own). **Medical requires the patients module**: with it off, no medical content is reachable. See §2 (owner 2026-10-11). |

Conservative picks taken by the orchestrator and shown on the decisions page (P2-K1…K4): one master key in
Dokploy with a per-clinic derived key and a key version; every read of clinical content is audited like a
patient-file open; the platform has no grant on any new table; the front desk sees that a visit exists,
its time and status, never its content.

## 2. Module, permissions, roles

- New module flag `medical` (PRD §4.8). Every route of this phase answers `module_disabled` when it is off.
  It joins the new-clinic default modules only at release (§9); until then it is off everywhere.
- New resources (all gated by `medical`):

| Resource    | Actions and scopes                          | Meaning                                                                                                           |
| ----------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `visits`    | `view: clinic, branch, own` · `create: own` | A visit's existence, time, provider, status. `create:visits:own` starts a visit where the caller is the provider. |
| `medical`   | `view: clinic, own` · `update: clinic, own` | Clinical content: notes, addenda, diagnoses, prescriptions, the medical file, attachments.                        |
| `medicines` | `view: clinic` · `update: clinic`           | The clinic's list of frequent medicines (not patient data).                                                       |

- `own` on visits and medical = the caller's own patients (D-4 of appointments, extended): a patient with an
  appointment with the caller that is not cancelled **or** a visit whose provider is the caller. One SQL
  predicate in the patients module (`own-patients.ts`) serves both, as in A3.
- P2-13 (owner 2026-10-11): every read or write of medical content naming a patient — the medical file,
  attachments (list, upload, download, archive), a visit's content (the visit page, list previews, the
  note search), the visit writes and the prescription print — also needs the patient inside the caller's
  patients view reach (`view:patients:clinic` / `branch` / `own`, the rule of `GET /patients/:id`);
  outside it the answer is `not_found` (a visit page answers its metadata with `content: null`). The
  walk-in candidates and the start stay outside the check. A visit's metadata under a visits key alone
  (the front desk's `view:visits:branch`) is not medical content and is unchanged. With the patients
  module off no role holds a patients key, so no medical content is reachable. TODO(spec): the platform
  should refuse enabling `medical` for a clinic without `patients`.
- Writing a note, signing, adding an addendum, writing diagnoses and the prescription: `update:medical:*`
  **and** the caller is the visit's provider (P2-3, a rule in the domain, not a key).
- The medical file (P2-7) is written with `update:medical:clinic` (any patient) or `update:medical:own` (own
  patients).
- Grant rule: the locked clinic admin may grant `visits` and `medical` keys to **other** roles without
  holding them (a bounded delegation); nobody else grants a key they do not hold; `own` keys are
  clinic-bound like A3's patients key; no member can change their own role. The platform can never hold
  any of them.
- New clinics' default roles: **doctor** gets `view:visits:own`, `create:visits:own`, `view:medical:own`,
  `update:medical:own`, `view:medicines:clinic`; **receptionist** gets `view:visits:branch`; the locked
  **clinic admin** gets the `visits` and `medicines` keys but **not** the `medical` keys (P2-5). Existing
  clinics' roles change only at release, by the same rule (§9).

## 3. Encryption (ADR-0028)

- **Cipher.** AES-256-GCM, a new `FieldCipher` in `packages/secrets` beside `SecretSealer` (same primitives).
  Envelope: `f1.<keyVersion>.<iv>.<ciphertext>.<tag>` (base64url). Additional data binds every value to
  `table:column:clinic_id:row_id`, so a ciphertext copied to another row, column or clinic never opens.
- **Keys.** One master key per version in the API's environment (`MEDICAL_MASTER_KEY_V<n>`, 32 bytes base64,
  generated and pasted into Dokploy by the owner) and `MEDICAL_KEY_VERSION` for writes. A clinic's key is
  HKDF-SHA256(master, salt = clinic_id, info = "eyadex-field"). Reads accept every configured version;
  rotation = add a version, switch writes, re-encrypt in a job, retire the old one. The worker never needs
  the key in P2. Missing or malformed keys fail the API at start, never silently.
- **Encrypted columns** (stored as `text` envelopes): note sections, addenda, diagnosis text and
  code, prescription items, medical-file sections, attachment metadata name, and the civil ID.
- **Civil ID.** Columns `civil_id_enc` (envelope), `civil_id_hmac` (HMAC-SHA256 of the 12 digits under a per-clinic HKDF key from a separate, never-rotated `MEDICAL_INDEX_KEY`, info "eyadex-civil-id"), `civil_id_last4`. Uniqueness moves to `(clinic_id, civil_id_hmac)`.
  Search: a 12-digit query matches `civil_id_hmac` exactly (P2-F5); partial digits search phones only.
  Migration (forward-only): add the columns (SQL) → a one-off backfill command in the API image run by the
  orchestrator (it needs the key) → switch reads and writes → a later SQL file drops `civil_id` after the
  backfill is verified on staging and production. Never in logs or audit, as today.
- **What stays plain:** ids, dates, statuses, provider, the ICD-10 reference table (not patient data), the
  clinic medicines list, attachment size and type.
- Ciphertext is never searched in SQL. Note search (P2-F4) decrypts one patient's visits in the API (bounded:
  at most 500 visits per request, newest first) and matches normalized text (Arabic letter forms and
  diacritics folded, case-insensitive).

## 4. Data model (clinic tables: `clinic_id`, PK `(clinic_id, id)`, RLS enabled + forced, FKs indexed)

| Table                          | Columns (besides `clinic_id`, `id`, timestamps)                                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visits`                       | `branch_id`, `patient_id`, `provider_membership_id`, `appointment_id` (nullable, unique when set), `status` (`draft`/`signed`/`cancelled`), `started_at`, `signed_at`, `signed_by`, `cancel_reason`, `cancel_note_enc` |
| `visit_notes`                  | `visit_id` (unique), `complaint_enc`, `examination_enc`, `assessment_enc`, `plan_enc` (each nullable), `updated_by`                                                                                                    |
| `visit_addenda`                | `visit_id`, `author_membership_id`, `body_enc`                                                                                                                                                                         |
| `visit_diagnoses`              | `visit_id`, `position`, `kind` (`icd10`/`text`), `code_enc` (nullable), `text_enc`                                                                                                                                     |
| `visit_prescription_items`     | `visit_id`, `position`, `medicine_enc`, `dose_enc`, `frequency_enc`, `duration_enc`, `note_enc` (nullable)                                                                                                             |
| `patient_medical_profiles`     | `patient_id` (unique), `allergies_enc`, `chronic_conditions_enc`, `current_medications_enc`, `surgical_history_enc`, `family_history_enc`, `updated_by`                                                                |
| `patient_attachments`          | `patient_id`, `visit_id` (nullable), `storage_key`, `content_type`, `size_bytes`, `sha256`, `name_enc`, `status` (`active`/`archived`), `uploaded_by`                                                                  |
| `clinic_medicines`             | `name`, `default_dose`, `default_frequency`, `status` (`active`/`inactive`), unique name per clinic                                                                                                                    |
| `patients` (new columns)       | `civil_id_enc`, `civil_id_hmac`, `civil_id_last4` (then `civil_id` dropped, §3)                                                                                                                                        |
| `icd10_codes` (global, no RLS) | `code` (PK), `title_en`, `release` — readable by `eyadex_app` only; loaded from the CDC FY2027 file by a loader command, not by a migration row-by-row                                                                 |

- No hard deletes: a draft visit is **cancelled** (reason), an attachment is **archived**. A signed visit
  can only gain addenda.
- Rules: one draft visit per appointment; a visit from an appointment needs it `arrived` and the caller as
  its provider; a walk-in visit is the caller's own in a branch the caller works in; signing needs at least
  one non-empty note section or diagnosis; diagnoses and prescription items are editable only in a draft.
- The platform role has no grant on any table above (database grants, PRD §8). `icd10_codes` too, since the
  platform never needs it.

## 5. API (REST under `/v1`, Zod contracts, error envelope, guards in CLAUDE.md §6 order)

| Route                                                                                                                         | Key                                   | Notes                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /patients/:id/visits?cursor=`                                                                                            | `view:visits:*`                       | Content summary only with `view:medical:*`                                        |
| `POST /patients/:id/visits/search`                                                                                            | `view:medical:*`                      | `{ q, cursor }` in the body, never the URL                                        |
| `GET /visits/walk-in-branches`, `POST /visits/walk-in-candidates`                                                             | `create:visits:own`                   | The caller's branches; name and file number only, query in the body               |
| `POST /visits` (Idempotency-Key)                                                                                              | `create:visits:own`                   | `{ appointmentId }` or `{ patientId, branchId }`                                  |
| `GET /visits/:id`                                                                                                             | `view:visits:*`                       | Content only with `view:medical:*`; audited (patient access)                      |
| `PUT /visits/:id/note`                                                                                                        | `update:medical:*` + provider         | Draft only                                                                        |
| `PUT /visits/:id/diagnoses`, `/prescription`                                                                                  | `update:medical:*` + provider         | Draft only; whole list replaced                                                   |
| `POST /visits/:id/sign`, `/cancel`, `/addenda`                                                                                | `update:medical:*` + provider         | Sign locks; cancel draft only (reason); addenda signed only                       |
| `GET /patients/:id/medical-profile`, `PUT` same                                                                               | `view:medical:*` / `update:medical:*` | Read audited                                                                      |
| `POST /icd10/search`                                                                                                          | `view:medical:*`                      | `{ q }` in the body (diagnosis words never in a URL); 20 billable results         |
| `GET /medicines`, `POST /medicines`, `PUT /medicines/:id`, `POST /medicines/:id/deactivate`, `POST /medicines/:id/reactivate` | `view/update:medicines:clinic`        | `{ medicine }` answers                                                            |
| `POST /patients/:id/attachments` (multipart)                                                                                  | `update:medical:*`                    | jpeg, png, webp, pdf; at most 20 MB; optional `visitId`; answers `{ attachment }` |
| `GET /patients/:id/attachments?visitId=`                                                                                      | `view:medical:*`                      | List                                                                              |
| `GET /attachments/:id`, `POST /attachments/:id/archive`                                                                       | `view:medical:*` / `update:medical:*` | Download streams the decrypted file; audited                                      |
| `GET /visits/:id/prescription/print`                                                                                          | `view:medical:*`                      | Print-ready data; audited                                                         |

- Audit (PRD §4.11): every medical audit row (visit, addendum, diagnosis, prescription, medical file,
  attachment) is `patient_access`, excluded from the platform's admin-audit view like `patient` and
  `appointment`; reads of clinical content are audited (visit open, preview list, medical file open,
  attachment download, prescription print, note search, walk-in search); writes name the fields changed —
  **never** their content, a code, a medicine, a query or a civil ID. Only the clinic medicines list writes
  `administrative` rows.

## 6. Attachments storage — decision (2026-10-11)

The first choice was the owner's Openinary at `openinary.walidmohamed.com`, behind a `BlobStore` port, if it
stored opaque encrypted bytes and returned them byte-for-byte. It cannot: it accepts media types only
(images, video, audio, 3D; no PDF, no opaque bytes), checks each file's first bytes against its claimed
type (an AES-GCM envelope never matches), requires a file extension, and serves stored files at public
download URLs. On 2026-10-11 the owner chose the fallback: a **private S3-compatible bucket on MinIO**, a
Dokploy service on the same server, reachable only on the internal `dokploy-network` (no domain, no public
port, no published console), behind the same port (`S3BlobStore`, `MEDICAL_BLOB_S3_*`). The Openinary
adapter was removed.

The API encrypts before upload (AES-256-GCM, additional data = attachment id and clinic id), the storage
never sees plaintext, and the browser never talks to the storage directly. The API's MinIO user may only
get and put objects under `clinic/*` in its bucket (no delete, no list). MinIO's own images are no longer
published (source only), so the deployment uses a pinned community build; setup, policy, backups and the
variables are in `docs/specs/medical-blob-runbook.md`.

## 7. Web (Lovable, mock adapter first)

- `GET /v1/me` and the web session carry `membershipId` (the caller's clinic membership), so screens compare it with an appointment's or visit's provider (added 2026-10-11 after Lovable's questions).

- Patient file gets tabs: **Overview** (today's), **Medical file**, **Visits**, **Attachments** — each shown
  only with its key. Visits tab: list, search box (with `view:medical:*`), "New walk-in visit".
- Visit page: note sections, diagnoses (per row: ICD-10 search **or** free text), prescription items (medicine
  from the clinic list or typed), attachments, Sign, Cancel draft, Add addendum on a signed visit, Print
  prescription (print stylesheet, clinic name ar/en, provider, date).
- The branch day and today's queue: "Start visit" on an `arrived` appointment for its provider.
- Settings gets a **Medicines** tab.
- ICD-10 titles are shown in English in both languages, with the CDC attribution and non-endorsement notice
  in the picker's footer (ICD-10-CM terms). Everything else through i18n keys, ar + en.

## 8. Tests that must exist

- `FieldCipher`: round trip, wrong clinic/row/column fails, tampering fails, every key version reads, a
  missing key fails at start.
- `test:db` as `eyadex_app`: RLS negatives for every new table; the platform role has no grant; `own` covers
  appointments and visits; one draft per appointment under concurrency; signed visits refuse edits.
- API: guards per route; content hidden without `view:medical`; audit rows hold no content (scan the row for
  the plaintext); civil ID exact search by HMAC; note search bounded and scoped to one patient.
- Web: tabs by key, draft vs signed controls, ICD-10/free-text switch, print view, ar/en strings.
- Civil ID backfill: idempotent, counts match, no plaintext left before the drop migration.

## 9. Delivery (one release, reviewable slices)

> **Delivered numbering (2026-10-11).** The migrations landed as 0045 civil ID (encrypted columns),
> 0046 visits (module, catalogue, visits, notes, addenda, medical file, audit), 0047 diagnoses + ICD-10,
> 0048 prescriptions + clinic medicines, 0049 attachments and 0050 release, in one PR. Dropping the plain
> `civil_id` column is a follow-up migration. The numbers below are the original plan and are kept as written.

The owner chose one release (P2-F6). The work still merges in slices behind the `medical` flag, which stays
off for every clinic until the last slice; nothing is visible before release. Order:

1. **M0** — storage spike (§6) and the key runbook (the owner generates and pastes the master key).
2. **M1** — `FieldCipher`, key config, civil ID columns + backfill + switch (SQL 0045); drop in 0046 after
   verification. This one changes today's patient screens' search behaviour (P2-F5) and ships first.
3. **M2** — `medical` module, catalogue keys, visits, notes, sign, addenda, medical file, audit (SQL 0047).
4. **M3** — diagnoses + the ICD-10 table and loader (SQL 0048).
5. **M4** — prescriptions, clinic medicines, print (SQL 0049).
6. **M5** — attachments over the `BlobStore` port (SQL 0050).
7. **M6** — release: default roles for new clinics, the same keys added to existing clinics' roles by rule
   (system roles only, by `system_key`: doctor, receptionist, and the locked admin without the `medical` keys), `medical` joins the
   new-clinic defaults and is switched on per clinic by the platform.

Contracts for M2–M5 are frozen first so Lovable builds the whole web against the mock while the API slices
land. Every SQL file is applied to staging, then production, before the code that needs it (backup first).

## 10. Out of this phase

Specialty sections (dermatology photos per body area, psychiatry scales…), ICD-10 Arabic titles, a national
drug list, e-prescriptions to pharmacies, clinic-wide note search, partial civil ID search, document
templates, the patient portal.
