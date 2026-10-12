-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase 3 N1 (docs/specs/notifications-design.md §2, owner decision N-2): what a patient file gains for
-- the clinic's messages. The patient is not a user: the email is an address the clinic writes to, never a
-- login, so it is not unique and holds no reservation (0015 is for accounts only).

-- The email is stored the way the contract normalises it (trimmed, lower case, at most 254). The shape
-- check is deliberately looser than the API's: the database refuses what is plainly not an address and
-- never a value the API accepted. No index: nothing looks a patient up by email.
ALTER TABLE patients ADD COLUMN email text NULL
  CONSTRAINT patients_email_canonical CHECK (
    email = lower(btrim(email)) AND char_length(email) <= 254
    AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  );
-- NULL = the clinic's default language.
ALTER TABLE patients ADD COLUMN message_language text NULL
  CONSTRAINT patients_message_language_check CHECK (message_language IN ('ar', 'en'));
-- Set by staff on the patient's request; it stops the two reminders only (N-2). The default keeps an
-- older API, which does not name the column yet, able to register a patient.
ALTER TABLE patients ADD COLUMN notifications_opt_out boolean NOT NULL DEFAULT false;

-- No grant change: eyadex_app holds table-level SELECT, INSERT, UPDATE on patients (0013), which covers
-- new columns, and the platform holds nothing on the table (0013's REVOKE ALL), so it reads none of them.
