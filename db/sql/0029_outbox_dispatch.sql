-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase B slice 7b-1 (ADR-0013): the worker's dispatcher claims, retries and gives up on events.

-- Retry state. `last_error` holds a provider status or code only — never a token, a link, an email
-- address or a response body — so the length cap is a guard, not a budget.
ALTER TABLE outbox_events
  ADD COLUMN attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN next_attempt_at timestamptz NULL,
  ADD COLUMN last_error      text        NULL CHECK (length(last_error) <= 500),
  ADD COLUMN failed_at       timestamptz NULL;

-- The claim reads `dispatched_at IS NULL AND failed_at IS NULL … ORDER BY created_at`; the old
-- partial index did not exclude given-up events.
DROP INDEX outbox_events_pending_idx;
CREATE INDEX outbox_events_pending_idx ON outbox_events (created_at)
  WHERE dispatched_at IS NULL AND failed_at IS NULL;

-- The dispatcher marks the outcome and scrubs the sealed link; it still cannot rewrite what an
-- event is (id, clinic, type, created_at).
REVOKE UPDATE ON outbox_events FROM eyadex_dispatcher;
GRANT UPDATE (dispatched_at, payload, attempts, next_attempt_at, last_error, failed_at)
  ON outbox_events TO eyadex_dispatcher;
