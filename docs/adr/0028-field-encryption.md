# ADR-0028 — Field encryption and the civil ID blind index

- Status: accepted (owner decisions 2026-10-10, P2 spec §1 P2-11 and P2-F5, §3; plan Tasks 2 and 3 with
  amendments R1-5…R1-8, R2-6, R2-9)
- Date: 2026-10-11

## Context

P2 stores clinical text (notes, addenda, diagnoses, prescriptions, the medical file, attachment names) and
moves the civil ID out of plain text (P2-11). A database dump, a backup or a misrouted query must not
reveal any of it, and a value copied into another row, column or clinic must not open. Clinics still need
to find a file by its full civil ID (P2-F5) and to refuse a second file with the same number, and the last
four digits stay visible in lists.

## Decision

1. **`FieldCipher` in `packages/secrets`** (beside `SecretSealer`, Node `crypto` only): AES-256-GCM, a
   random 12-byte IV, a 16-byte tag, additional data `table:column:clinic_id:row_id`, envelope
   `f1.<keyVersion>.<iv>.<ciphertext>.<tag>` (base64url). `open` checks the shape by length — exactly five
   parts, a 12-byte IV, a 16-byte tag — never by truthiness, so `""` round-trips (R1-8). Stores still write
   `NULL` for an empty optional value.
2. **Keys.** `MEDICAL_MASTER_KEY_V<n>` (32 bytes, standard base64) per version and `MEDICAL_KEY_VERSION` for
   writes (default 1). A clinic's key is HKDF-SHA256(master, salt = the clinic id's UTF-8 text, info
   `eyadex-field`). Reads accept every configured version; writes use the active one.
3. **Civil ID blind index.** `civil_id_hmac` = HMAC-SHA256 of the 12 digits under HKDF-SHA256(
   `MEDICAL_INDEX_KEY`, salt = clinic id, info `eyadex-civil-id`). The index key is separate and never
   rotated (R1-7), so a master rotation never touches search or uniqueness. Uniqueness is the partial
   unique index `(clinic_id, civil_id_hmac)` of SQL 0045; a 12-digit query matches the hmac exactly, any
   other digits search phones and file numbers only.
4. **Strict key decoding (R2-9).** A key is accepted only if it matches `^[A-Za-z0-9+/]{43}=$`, decodes to
   32 bytes and re-encodes to the same text. The API refuses to start without a valid
   `MEDICAL_MASTER_KEY_V<MEDICAL_KEY_VERSION>` and `MEDICAL_INDEX_KEY`; the error names the variable only.
   The API provides them once (`FieldEncryptionModule`: `FIELD_CIPHER`, `CIVIL_ID_INDEX_KEY`), imported by
   the patients and medical modules; the worker never needs them. Tests generate both keys per run, never
   constants in source (R2-6).
5. **Civil ID compatibility phase (R1-5).** SQL 0045 adds `civil_id_enc`, `civil_id_hmac`,
   `civil_id_last4` beside the plain `civil_id`. Until the plain column is dropped: writes always set the
   three new columns and `civil_id = NULL`; reads decrypt `civil_id_enc` when set, else read the legacy
   `civil_id`; lists show `coalesce(civil_id_last4, right(civil_id, 4))`; uniqueness checks the hmac and
   the legacy column; a 12-digit search matches `civil_id_hmac = hmac OR civil_id = q`. The one-off
   `dist/cli/backfill-civil-id.js` converts legacy rows per clinic under the `patients:` advisory lock with
   a locked re-read (counts only; `--dry-run`, `--verify`; non-zero exit on a collision or a mismatch). It
   lists clinics on the `eyadex_platform` pool and converts on `eyadex_app` inside `withTenant`, because
   `@eyadex/db` refuses a role that bypasses RLS.
6. **Ciphertext is never searched in SQL.** Note search decrypts one patient's bounded set in memory
   (ADR-0029 §8).

## Consequences

- **Key loss is data loss.** Without its master version a value cannot be read; without the index key
  civil ID search and the duplicate check stop working. The owner keeps offline copies
  (`docs/specs/medical-keys-runbook.md`).
- **Rotation** = add `V<n+1>`, switch `MEDICAL_KEY_VERSION`, re-encrypt old rows in a job, then retire the
  old version. Nothing re-encrypts at deploy time.
- Dropping the plain `civil_id` is a later migration, applied on an environment only after the code that
  never names `civil_id` is live there and `--verify` passed there (R1-6).
- Partial civil ID search is gone (P2-F5); a partial number finds nothing by civil ID.
