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

-- Second-factor assurance is a property of the SESSION, set when Better Auth mints it: true only for a
-- session created by a verified TOTP / backup code. Mandatory platform TOTP checks this column, not the
-- user's two_factor_enabled flag — otherwise a password-only session opened while the user's first
-- enrollment completes would inherit full access the moment the flag turns on.
ALTER TABLE auth_sessions
  ADD COLUMN two_factor_verified boolean NOT NULL;
