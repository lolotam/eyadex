-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Retention of the technical ledgers (ADR-0022, owner decision 2026-10-09):
--   idempotency keys (both ledgers)   30 days after created_at
--   dispatched outbox events          30 days after dispatched_at
--   failed (given-up) outbox events   90 days after failed_at
-- Pending and retrying events (dispatched_at and failed_at both NULL) are never deleted, at any age.
-- Audit logs, patients and every other table are untouched: the owner below has no grant on them.

-- The periods live only in the three function bodies below: each computes its cutoff from now(), so
-- no caller can pass a cutoff that reaches fresh rows. The batch size is capped at 1000 per call, so a
-- purge never runs one unbounded DELETE.

-- Each purge orders by the timestamp its rule reads; without these indexes every batch scans the table.
CREATE INDEX outbox_events_dispatched_idx ON outbox_events (dispatched_at)
  WHERE dispatched_at IS NOT NULL;
CREATE INDEX outbox_events_failed_idx ON outbox_events (failed_at) WHERE failed_at IS NOT NULL;
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
-- Serves the owner's cross-clinic purge only, not a tenant query or an RLS predicate, so it does not
-- start with clinic_id (the FK and the policy are served by the primary key).
CREATE INDEX clinic_idempotency_keys_created_idx ON clinic_idempotency_keys (created_at);

-- The functions' owner: NOLOGIN, no BYPASSRLS, the pattern of 0014/0027/0037. It reads the columns its
-- rules name and deletes; it cannot insert, update or read a payload, a response or a request hash.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_retention_owner') THEN
    CREATE ROLE eyadex_retention_owner NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO eyadex_retention_owner;
GRANT SELECT (id, dispatched_at, failed_at), DELETE ON outbox_events TO eyadex_retention_owner;
GRANT SELECT (scope, key, created_at), DELETE ON idempotency_keys TO eyadex_retention_owner;
GRANT SELECT (clinic_id, id, created_at), DELETE ON clinic_idempotency_keys TO eyadex_retention_owner;

-- Both tables force RLS on their owner role too. On the outbox the policy itself keeps every pending or
-- retrying event out of the owner's reach, whatever a function body says.
CREATE POLICY outbox_events_retention ON outbox_events TO eyadex_retention_owner
  USING (dispatched_at IS NOT NULL OR failed_at IS NOT NULL);
-- Every clinic, like the lookups of 0027: the purge works across clinics and reveals nothing.
CREATE POLICY clinic_idempotency_keys_retention ON clinic_idempotency_keys TO eyadex_retention_owner
  USING (true);

-- Dispatched (sent or skipped) after 30 days, then given-up events after 90 days, at most p_limit rows
-- together. A row with both timestamps set (the dispatcher never writes one) waits for the 90-day rule.
CREATE FUNCTION purge_expired_outbox_events(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  dispatched_retention CONSTANT interval := interval '30 days';
  failed_retention     CONSTANT interval := interval '90 days';
  dispatched_count integer;
  failed_count     integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM outbox_events
  WHERE id IN (SELECT id FROM outbox_events
               WHERE dispatched_at < now() - dispatched_retention AND failed_at IS NULL
               ORDER BY dispatched_at LIMIT p_limit)
    AND dispatched_at < now() - dispatched_retention AND failed_at IS NULL;
  GET DIAGNOSTICS dispatched_count = ROW_COUNT;
  IF dispatched_count = p_limit THEN RETURN dispatched_count; END IF;
  DELETE FROM outbox_events
  WHERE id IN (SELECT id FROM outbox_events WHERE failed_at < now() - failed_retention
               ORDER BY failed_at LIMIT p_limit - dispatched_count)
    AND failed_at < now() - failed_retention;
  GET DIAGNOSTICS failed_count = ROW_COUNT;
  RETURN dispatched_count + failed_count;
END
$$;

-- The platform ledger (0025): keys 30 days after their claim.
CREATE FUNCTION purge_expired_idempotency_keys(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  key_retention CONSTANT interval := interval '30 days';
  deleted integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM idempotency_keys
  WHERE (scope, key) IN (SELECT scope, key FROM idempotency_keys
                         WHERE created_at < now() - key_retention
                         ORDER BY created_at LIMIT p_limit)
    AND created_at < now() - key_retention;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END
$$;

-- The clinic ledger (0028), every clinic: keys 30 days after their claim.
CREATE FUNCTION purge_expired_clinic_idempotency_keys(p_limit integer) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  key_retention CONSTANT interval := interval '30 days';
  deleted integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM clinic_idempotency_keys
  WHERE (clinic_id, id) IN (SELECT clinic_id, id FROM clinic_idempotency_keys
                            WHERE created_at < now() - key_retention
                            ORDER BY created_at LIMIT p_limit)
    AND created_at < now() - key_retention;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END
$$;

-- The worker's dispatcher is the only caller: it is the one runtime role the API never signs in as, so
-- the API cannot purge anything. Its table grants stay on outbox_events alone (PRD §4.5).
ALTER FUNCTION purge_expired_outbox_events(integer) OWNER TO eyadex_retention_owner;
ALTER FUNCTION purge_expired_idempotency_keys(integer) OWNER TO eyadex_retention_owner;
ALTER FUNCTION purge_expired_clinic_idempotency_keys(integer) OWNER TO eyadex_retention_owner;
REVOKE ALL ON FUNCTION purge_expired_outbox_events(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_expired_idempotency_keys(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_expired_clinic_idempotency_keys(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_outbox_events(integer) TO eyadex_dispatcher;
GRANT EXECUTE ON FUNCTION purge_expired_idempotency_keys(integer) TO eyadex_dispatcher;
GRANT EXECUTE ON FUNCTION purge_expired_clinic_idempotency_keys(integer) TO eyadex_dispatcher;
