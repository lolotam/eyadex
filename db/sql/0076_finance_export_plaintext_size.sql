-- F3 export follow-up: byte_size remains the private encrypted-object length used for bounded
-- reception. Public byteSize reads plaintext_byte_size, the actual CSV/XLSX attachment length.
-- Additive for rolling upgrades: previous workers keep writing byte_size; previous APIs still
-- use it for receive verification. Historical plaintext sizes cannot be inferred without opening
-- the encrypted objects, so leave them NULL (unknown) until their normal expiry, never guess.
-- Apply only after review and the owner's explicit production approval.
ALTER TABLE finance_report_exports
  ADD COLUMN plaintext_byte_size bigint NULL
    CONSTRAINT finance_report_exports_plaintext_byte_size_check CHECK (plaintext_byte_size > 0);

GRANT UPDATE (plaintext_byte_size) ON finance_report_exports TO eyadex_app;

COMMENT ON COLUMN finance_report_exports.byte_size IS
  'Private stored ciphertext length; retained for bounded receive and rolling compatibility.';
COMMENT ON COLUMN finance_report_exports.plaintext_byte_size IS
  'Public attachment length in bytes; NULL for historical exports whose plaintext size is unknown.';
