-- Every Better Auth account belongs to exactly one area (ADR-0003/0004). PostgreSQL 18. Forward-only.
-- Without it, a clinic user's email + password signed in on the platform host and got a platform
-- session: the session row records the area that issued it, but nothing tied the person to an area.
-- Better Auth now refuses to create a session when the user's area differs from the instance's
-- (databaseHooks.session.create.before), which covers sign-in, verify-totp, verify-backup-code and
-- trusted devices at once. A person who needs both areas holds two accounts with two emails.
-- NOT NULL with no default: 0023 tables are empty wherever this runs (an existing row makes this file
-- fail loudly instead of guessing an area).

ALTER TABLE auth_users
  ADD COLUMN area text NOT NULL CHECK (area IN ('platform', 'clinic'));
