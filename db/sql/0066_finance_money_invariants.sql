-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Finance F2 money invariants (docs/specs/finance-design.md §4.3, §4.5 row 0066; F2-Q17, kept by the owner):
-- defence in depth — the database re-checks a patient's money at COMMIT, so a bug fails the transaction
-- instead of storing wrong money. R3-1: withTenant clears app.clinic_id before COMMIT, so the checks are
-- SECURITY DEFINER with their own NOLOGIN, NOBYPASSRLS owner, take the clinic from the row, and read the
-- money tables through column grants and role-wide read policies (the 0061 pattern); the owner reads no
-- column of `patients` and not `invoices.patient_id`, and no runtime role can call a check function. The
-- PR #89 review asks 0066 to prove a branch's cash numbers are disjoint and contiguous (by induction: every
-- cash movement checks its own number and the one before; every drawer write checks its last number and that
-- no movement is beyond it), and issue #91 asks that a payment's allocations never release more than it.
-- The checks take a clinic-wide advisory lock first, so two transactions that reach COMMIT together are
-- serialised and the second one re-reads what the first committed; they require READ COMMITTED, the API's
-- isolation level (PR #92 review).
-- The owner also reads the receipt sequences and the branch prefix, to prove the numbers.

-- The owner role and its read access: the 0061 pattern, a NOLOGIN, NOBYPASSRLS role reading exactly the
-- columns the checks need.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_finance_check_owner') THEN
    CREATE ROLE eyadex_finance_check_owner NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO eyadex_finance_check_owner;

GRANT SELECT (clinic_id, id, status, total_minor) ON invoices TO eyadex_finance_check_owner;
GRANT SELECT (clinic_id, id, branch_id, patient_id, amount_minor, cash_seq, year, receipt_seq, receipt_number)
  ON payments TO eyadex_finance_check_owner;
GRANT SELECT (clinic_id, id, patient_id, invoice_id, payment_id, credit_id, amount_minor) ON payment_allocations
  TO eyadex_finance_check_owner;
GRANT SELECT (clinic_id, id, patient_id, origin_allocation_id, amount_minor) ON patient_credits
  TO eyadex_finance_check_owner;
GRANT SELECT (clinic_id, id, branch_id, patient_id, amount_minor, cash_seq, year, refund_seq, refund_number)
  ON refunds TO eyadex_finance_check_owner;
GRANT SELECT (clinic_id, refund_id, credit_id, patient_id, amount_minor) ON refund_sources TO eyadex_finance_check_owner;
GRANT SELECT (clinic_id, branch_id, last_cash_seq, last_closed_seq, last_closing_id) ON branch_cash_drawers
  TO eyadex_finance_check_owner;
GRANT SELECT (clinic_id, id, branch_id, from_cash_seq, to_cash_seq, expected_minor, previous_closing_id)
  ON cash_closings TO eyadex_finance_check_owner;
GRANT SELECT (clinic_id, branch_id, series, year, next_number) ON receipt_sequences TO eyadex_finance_check_owner;
GRANT SELECT (clinic_id, id, invoice_prefix) ON branches TO eyadex_finance_check_owner;
CREATE POLICY invoices_finance_check_read ON invoices FOR SELECT TO eyadex_finance_check_owner USING (true);
CREATE POLICY payments_finance_check_read ON payments FOR SELECT TO eyadex_finance_check_owner USING (true);
CREATE POLICY payment_allocations_finance_check_read ON payment_allocations FOR SELECT
  TO eyadex_finance_check_owner USING (true);
CREATE POLICY patient_credits_finance_check_read ON patient_credits FOR SELECT
  TO eyadex_finance_check_owner USING (true);
CREATE POLICY refunds_finance_check_read ON refunds FOR SELECT TO eyadex_finance_check_owner USING (true);
CREATE POLICY refund_sources_finance_check_read ON refund_sources FOR SELECT
  TO eyadex_finance_check_owner USING (true);
CREATE POLICY branch_cash_drawers_finance_check_read ON branch_cash_drawers FOR SELECT
  TO eyadex_finance_check_owner USING (true);
CREATE POLICY cash_closings_finance_check_read ON cash_closings FOR SELECT
  TO eyadex_finance_check_owner USING (true);
CREATE POLICY receipt_sequences_finance_check_read ON receipt_sequences FOR SELECT
  TO eyadex_finance_check_owner USING (true);
CREATE POLICY branches_finance_check_read ON branches FOR SELECT TO eyadex_finance_check_owner USING (true);

-- The patient's money, checked with the row's clinic and patient (§4.3 invariants 1–4, R3-2, #91).
CREATE FUNCTION finance_check_patient(p_clinic uuid, p_patient uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_received numeric;
  v_placed   numeric;
  v_released numeric;
  v_spent    numeric;
  v_sourced  numeric;
  v_refunded numeric;
BEGIN
  -- One clinic-wide lock serialises the commit-time checks, so a transaction waits for another that is
  -- checking the same clinic and then re-reads what it committed; the holder only reads, so it never
  -- waits on another lock and adds no deadlock (ADR-0027 item 12).
  PERFORM pg_advisory_xact_lock(hashtextextended('finance_check:' || p_clinic::text, 0));
  -- Only READ COMMITTED re-reads after waiting for the lock; REPEATABLE READ and SERIALIZABLE keep a snapshot that would
  -- not see what the lock holder committed (PR #92 review).
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'isolation';
  END IF;
  -- §4.3 invariant 1: live(a) ≥ 0 — an allocation never releases more than it placed.
  IF EXISTS (
    SELECT 1 FROM payment_allocations a
    WHERE a.clinic_id = p_clinic AND a.patient_id = p_patient
      AND a.amount_minor < (SELECT coalesce(sum(c.amount_minor), 0) FROM patient_credits c
                            WHERE c.clinic_id = a.clinic_id AND c.origin_allocation_id = a.id)
  ) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'allocation_live';
  END IF;
  -- §4.3 invariant 1: remaining(c) ≥ 0 — a credit is never spent beyond its amount.
  IF EXISTS (
    SELECT 1 FROM patient_credits c
    WHERE c.clinic_id = p_clinic AND c.patient_id = p_patient
      AND c.amount_minor < (SELECT coalesce(sum(a.amount_minor), 0) FROM payment_allocations a
                            WHERE a.clinic_id = c.clinic_id AND a.credit_id = c.id)
                         + (SELECT coalesce(sum(s.amount_minor), 0) FROM refund_sources s
                            WHERE s.clinic_id = c.clinic_id AND s.credit_id = c.id)
  ) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'credit_remaining';
  END IF;
  -- §4.3 invariant 2: a payment is placed in full when it is written (F2-Q1).
  IF EXISTS (
    SELECT 1 FROM payments p
    WHERE p.clinic_id = p_clinic AND p.patient_id = p_patient
      AND p.amount_minor <> (SELECT coalesce(sum(a.amount_minor), 0) FROM payment_allocations a
                             WHERE a.clinic_id = p.clinic_id AND a.payment_id = p.id)
  ) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'payment_allocated';
  END IF;
  -- #91: a payment's allocations never release more than the payment.
  IF EXISTS (
    SELECT 1 FROM payments p
    WHERE p.clinic_id = p_clinic AND p.patient_id = p_patient
      AND p.amount_minor < (SELECT coalesce(sum(c.amount_minor), 0)
                            FROM payment_allocations a
                            JOIN patient_credits c ON c.clinic_id = a.clinic_id AND c.origin_allocation_id = a.id
                            WHERE a.clinic_id = p.clinic_id AND a.payment_id = p.id)
  ) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'payment_released';
  END IF;
  -- §4.3 invariant 3: an issued invoice holds at most its total, a void one holds nothing.
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT a.invoice_id, sum(a.amount_minor - r.released) AS paid
      FROM payment_allocations a
      CROSS JOIN LATERAL (SELECT coalesce(sum(c.amount_minor), 0) AS released FROM patient_credits c
                          WHERE c.clinic_id = a.clinic_id AND c.origin_allocation_id = a.id) r
      WHERE a.clinic_id = p_clinic AND a.patient_id = p_patient
      GROUP BY a.invoice_id
    ) t
    JOIN invoices i ON i.clinic_id = p_clinic AND i.id = t.invoice_id
    WHERE (i.status = 'issued' AND t.paid > i.total_minor)
       OR (i.status = 'void' AND t.paid <> 0)
  ) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'invoice_paid';
  END IF;
  -- R3-2: each refund is covered exactly by the credits it spent.
  IF EXISTS (
    SELECT 1 FROM refunds f
    WHERE f.clinic_id = p_clinic AND f.patient_id = p_patient
      AND f.amount_minor <> (SELECT coalesce(sum(s.amount_minor), 0) FROM refund_sources s
                             WHERE s.clinic_id = f.clinic_id AND s.refund_id = f.id)
  ) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'refund_sources';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO v_received FROM payments
    WHERE clinic_id = p_clinic AND patient_id = p_patient;
  SELECT coalesce(sum(amount_minor), 0) INTO v_placed FROM payment_allocations
    WHERE clinic_id = p_clinic AND patient_id = p_patient;
  SELECT coalesce(sum(amount_minor), 0) INTO v_released FROM patient_credits
    WHERE clinic_id = p_clinic AND patient_id = p_patient;
  SELECT coalesce(sum(amount_minor), 0) INTO v_spent FROM payment_allocations
    WHERE clinic_id = p_clinic AND patient_id = p_patient AND credit_id IS NOT NULL;
  SELECT coalesce(sum(amount_minor), 0) INTO v_sourced FROM refund_sources
    WHERE clinic_id = p_clinic AND patient_id = p_patient;
  SELECT coalesce(sum(amount_minor), 0) INTO v_refunded FROM refunds
    WHERE clinic_id = p_clinic AND patient_id = p_patient;
  -- §4.3 invariant 4: Σ payments = Σ paid(i) + Σ remaining(c) + Σ refunds; Σ paid(i) = placed − released, Σ remaining(c) = released − spent − sourced.
  IF v_received <> (v_placed - v_released) + (v_released - v_spent - v_sourced) + v_refunded THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'conservation';
  END IF;
END
$$;

-- A branch's cash numbers: disjoint across payments and refunds, and contiguous (PR #89 review).
CREATE FUNCTION finance_check_cash_movement(p_clinic uuid, p_branch uuid, p_seq bigint) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  -- The same clinic-wide check lock (see finance_check_patient).
  PERFORM pg_advisory_xact_lock(hashtextextended('finance_check:' || p_clinic::text, 0));
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'isolation';
  END IF;
  -- The numbers are disjoint: a cash number is held by one movement, a payment or a refund.
  IF (SELECT count(*) FROM payments WHERE clinic_id = p_clinic AND branch_id = p_branch AND cash_seq = p_seq)
     + (SELECT count(*) FROM refunds WHERE clinic_id = p_clinic AND branch_id = p_branch AND cash_seq = p_seq)
     <> 1 THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'cash_seq_taken';
  END IF;
  -- The numbers are contiguous: the number before is held, so by induction every number down to 1 is.
  IF p_seq > 1
     AND NOT EXISTS (SELECT 1 FROM payments
                     WHERE clinic_id = p_clinic AND branch_id = p_branch AND cash_seq = p_seq - 1)
     AND NOT EXISTS (SELECT 1 FROM refunds
                     WHERE clinic_id = p_clinic AND branch_id = p_branch AND cash_seq = p_seq - 1) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'cash_seq_gap';
  END IF;
  -- The number is handed out by the drawer.
  IF NOT EXISTS (SELECT 1 FROM branch_cash_drawers d
                 WHERE d.clinic_id = p_clinic AND d.branch_id = p_branch AND d.last_cash_seq >= p_seq) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'cash_seq_drawer';
  END IF;
END
$$;

-- The drawer's own position: it hands out the numbers and knows the last closing.
CREATE FUNCTION finance_check_drawer(p_clinic uuid, p_branch uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  d record;
BEGIN
  -- The same clinic-wide check lock (see finance_check_patient).
  PERFORM pg_advisory_xact_lock(hashtextextended('finance_check:' || p_clinic::text, 0));
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'isolation';
  END IF;
  SELECT last_cash_seq, last_closed_seq, last_closing_id INTO d FROM branch_cash_drawers
    WHERE clinic_id = p_clinic AND branch_id = p_branch;
  -- No movement holds a number the drawer has not handed out.
  IF EXISTS (SELECT 1 FROM payments
             WHERE clinic_id = p_clinic AND branch_id = p_branch AND cash_seq > d.last_cash_seq)
     OR EXISTS (SELECT 1 FROM refunds
                WHERE clinic_id = p_clinic AND branch_id = p_branch AND cash_seq > d.last_cash_seq) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'cash_seq_drawer';
  END IF;
  -- The drawer's last number is held.
  IF d.last_cash_seq > 0
     AND NOT EXISTS (SELECT 1 FROM payments
                     WHERE clinic_id = p_clinic AND branch_id = p_branch AND cash_seq = d.last_cash_seq)
     AND NOT EXISTS (SELECT 1 FROM refunds
                     WHERE clinic_id = p_clinic AND branch_id = p_branch AND cash_seq = d.last_cash_seq) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'cash_seq_gap';
  END IF;
  -- The drawer's closed position is its last closing's end, and no closing follows that one (R3-3).
  IF d.last_closed_seq <> coalesce((SELECT k.to_cash_seq FROM cash_closings k
                                    WHERE k.clinic_id = p_clinic AND k.branch_id = p_branch
                                      AND k.id = d.last_closing_id), 0)
     OR EXISTS (SELECT 1 FROM cash_closings k
                WHERE k.clinic_id = p_clinic AND k.branch_id = p_branch
                  AND k.previous_closing_id IS NOT DISTINCT FROM d.last_closing_id) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'cash_drawer_closing';
  END IF;
END
$$;

-- One closing: its period, its drawer and its expected amount (§4.4, R3-3).
CREATE FUNCTION finance_check_closing(p_clinic uuid, p_closing uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  k record;
BEGIN
  -- The same clinic-wide check lock (see finance_check_patient).
  PERFORM pg_advisory_xact_lock(hashtextextended('finance_check:' || p_clinic::text, 0));
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'isolation';
  END IF;
  SELECT branch_id, from_cash_seq, to_cash_seq, expected_minor, previous_closing_id INTO k FROM cash_closings
    WHERE clinic_id = p_clinic AND id = p_closing;
  -- The period starts where the previous closing ended (R3-3, §4.4).
  IF k.from_cash_seq <> coalesce((SELECT p.to_cash_seq FROM cash_closings p
                                  WHERE p.clinic_id = p_clinic AND p.branch_id = k.branch_id
                                    AND p.id = k.previous_closing_id), 0) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'cash_closing_period';
  END IF;
  -- The drawer records this closing as its last, and the closing reaches the drawer's last cash number
  -- (§4.4: no cash left outside it).
  IF NOT EXISTS (SELECT 1 FROM branch_cash_drawers d
                 WHERE d.clinic_id = p_clinic AND d.branch_id = k.branch_id
                   AND d.last_closing_id = p_closing AND d.last_closed_seq = k.to_cash_seq
                   AND d.last_cash_seq = k.to_cash_seq) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'cash_closing_drawer';
  END IF;
  -- Expected = cash received − cash refunded in (from, to] (F2-Q10: no float).
  IF k.expected_minor <> (SELECT coalesce(sum(amount_minor), 0) FROM payments
                          WHERE clinic_id = p_clinic AND branch_id = k.branch_id
                            AND cash_seq > k.from_cash_seq AND cash_seq <= k.to_cash_seq)
                       - (SELECT coalesce(sum(amount_minor), 0) FROM refunds
                          WHERE clinic_id = p_clinic AND branch_id = k.branch_id
                            AND cash_seq > k.from_cash_seq AND cash_seq <= k.to_cash_seq) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'cash_closing_expected';
  END IF;
END
$$;

-- The receipt and refund numbers: gap-free per branch, series and year, and built from the prefix (EY-5.2).
CREATE FUNCTION finance_check_number(p_clinic uuid, p_branch uuid, p_series text, p_year smallint, p_seq integer,
    p_number text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  -- The same clinic-wide check lock (see finance_check_patient).
  PERFORM pg_advisory_xact_lock(hashtextextended('finance_check:' || p_clinic::text, 0));
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'isolation';
  END IF;
  -- The number is the branch prefix, the series, the year and the sequence padded to six digits (R1-9, F2-Q13).
  IF p_number IS DISTINCT FROM (SELECT b.invoice_prefix
                                       || CASE WHEN p_series = 'receipt' THEN '-R-' ELSE '-RF-' END
                                       || p_year::text || '-'
                                       || lpad(p_seq::text, greatest(6, length(p_seq::text)), '0')
                                FROM branches b WHERE b.clinic_id = p_clinic AND b.id = p_branch) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'number_format';
  END IF;
  -- The branch's sequence for that series and year handed this number out.
  IF NOT EXISTS (SELECT 1 FROM receipt_sequences s
                 WHERE s.clinic_id = p_clinic AND s.branch_id = p_branch AND s.series = p_series
                   AND s.year = p_year AND s.next_number > p_seq) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'number_sequence';
  END IF;
  -- Gap-free: the number before it is held too, so by induction every number down to 1 is.
  IF p_seq > 1
     AND NOT EXISTS (SELECT 1 FROM payments
                     WHERE p_series = 'receipt' AND clinic_id = p_clinic AND branch_id = p_branch
                       AND year = p_year AND receipt_seq = p_seq - 1)
     AND NOT EXISTS (SELECT 1 FROM refunds
                     WHERE p_series = 'refund' AND clinic_id = p_clinic AND branch_id = p_branch
                       AND year = p_year AND refund_seq = p_seq - 1) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'number_gap';
  END IF;
END
$$;

CREATE FUNCTION finance_check_number_sequence(p_clinic uuid, p_branch uuid, p_series text, p_year smallint)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_next integer;
BEGIN
  -- The same clinic-wide check lock (see finance_check_patient).
  PERFORM pg_advisory_xact_lock(hashtextextended('finance_check:' || p_clinic::text, 0));
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'isolation';
  END IF;
  SELECT next_number INTO v_next FROM receipt_sequences
    WHERE clinic_id = p_clinic AND branch_id = p_branch AND series = p_series AND year = p_year;
  -- No receipt or refund holds a number the sequence has not handed out yet.
  IF EXISTS (SELECT 1 FROM payments
             WHERE p_series = 'receipt' AND clinic_id = p_clinic AND branch_id = p_branch
               AND year = p_year AND receipt_seq >= v_next)
     OR EXISTS (SELECT 1 FROM refunds
                WHERE p_series = 'refund' AND clinic_id = p_clinic AND branch_id = p_branch
                  AND year = p_year AND refund_seq >= v_next) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'number_sequence';
  END IF;
  -- The sequence's last number is held, so with each movement's own check the numbers run 1 … next_number − 1.
  IF v_next > 1
     AND NOT EXISTS (SELECT 1 FROM payments
                     WHERE p_series = 'receipt' AND clinic_id = p_clinic AND branch_id = p_branch
                       AND year = p_year AND receipt_seq = v_next - 1)
     AND NOT EXISTS (SELECT 1 FROM refunds
                     WHERE p_series = 'refund' AND clinic_id = p_clinic AND branch_id = p_branch
                       AND year = p_year AND refund_seq = v_next - 1) THEN
    RAISE EXCEPTION 'finance_invariant' USING ERRCODE = 'P0001', DETAIL = 'number_gap';
  END IF;
END
$$;

-- The trigger functions: each SECURITY DEFINER, owned by the same owner. A trigger function cannot be
-- called directly, and EXECUTE is checked when the trigger is created, so the runtime roles need none.
CREATE FUNCTION finance_patient_money_trigger() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM finance_check_patient(NEW.clinic_id, NEW.patient_id);
  RETURN NULL;
END
$$;
CREATE FUNCTION finance_cash_movement_trigger() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM finance_check_cash_movement(NEW.clinic_id, NEW.branch_id, NEW.cash_seq);
  RETURN NULL;
END
$$;
CREATE FUNCTION finance_cash_drawer_trigger() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM finance_check_drawer(NEW.clinic_id, NEW.branch_id);
  RETURN NULL;
END
$$;
CREATE FUNCTION finance_cash_closing_trigger() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM finance_check_closing(NEW.clinic_id, NEW.id);
  RETURN NULL;
END
$$;
CREATE FUNCTION finance_payment_number_trigger() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM finance_check_number(NEW.clinic_id, NEW.branch_id, 'receipt', NEW.year, NEW.receipt_seq, NEW.receipt_number);
  RETURN NULL;
END
$$;
CREATE FUNCTION finance_refund_number_trigger() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM finance_check_number(NEW.clinic_id, NEW.branch_id, 'refund', NEW.year, NEW.refund_seq, NEW.refund_number);
  RETURN NULL;
END
$$;
CREATE FUNCTION finance_receipt_sequence_trigger() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM finance_check_number_sequence(NEW.clinic_id, NEW.branch_id, NEW.series, NEW.year);
  RETURN NULL;
END
$$;

-- The deferred constraint triggers, created while the migration owner still owns the functions.
CREATE CONSTRAINT TRIGGER payments_money_check AFTER INSERT ON payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_patient_money_trigger();
CREATE CONSTRAINT TRIGGER payment_allocations_money_check AFTER INSERT ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_patient_money_trigger();
CREATE CONSTRAINT TRIGGER patient_credits_money_check AFTER INSERT ON patient_credits
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_patient_money_trigger();
CREATE CONSTRAINT TRIGGER refunds_money_check AFTER INSERT ON refunds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_patient_money_trigger();
CREATE CONSTRAINT TRIGGER refund_sources_money_check AFTER INSERT ON refund_sources
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_patient_money_trigger();
CREATE CONSTRAINT TRIGGER invoices_money_check AFTER UPDATE OF total_minor, status ON invoices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.total_minor IS DISTINCT FROM NEW.total_minor OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION finance_patient_money_trigger();
CREATE CONSTRAINT TRIGGER payments_cash_check AFTER INSERT ON payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.cash_seq IS NOT NULL)
  EXECUTE FUNCTION finance_cash_movement_trigger();
CREATE CONSTRAINT TRIGGER refunds_cash_check AFTER INSERT ON refunds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.cash_seq IS NOT NULL)
  EXECUTE FUNCTION finance_cash_movement_trigger();
CREATE CONSTRAINT TRIGGER branch_cash_drawers_cash_check AFTER INSERT OR UPDATE ON branch_cash_drawers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_cash_drawer_trigger();
CREATE CONSTRAINT TRIGGER cash_closings_cash_check AFTER INSERT ON cash_closings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_cash_closing_trigger();
CREATE CONSTRAINT TRIGGER payments_number_check AFTER INSERT ON payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_payment_number_trigger();
CREATE CONSTRAINT TRIGGER refunds_number_check AFTER INSERT ON refunds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_refund_number_trigger();
CREATE CONSTRAINT TRIGGER receipt_sequences_number_check AFTER INSERT OR UPDATE ON receipt_sequences
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_receipt_sequence_trigger();

-- The functions go to their owner, then they are closed: no runtime role can call them.
ALTER FUNCTION finance_check_patient(uuid, uuid) OWNER TO eyadex_finance_check_owner;
ALTER FUNCTION finance_check_cash_movement(uuid, uuid, bigint) OWNER TO eyadex_finance_check_owner;
ALTER FUNCTION finance_check_drawer(uuid, uuid) OWNER TO eyadex_finance_check_owner;
ALTER FUNCTION finance_check_closing(uuid, uuid) OWNER TO eyadex_finance_check_owner;
ALTER FUNCTION finance_patient_money_trigger() OWNER TO eyadex_finance_check_owner;
ALTER FUNCTION finance_cash_movement_trigger() OWNER TO eyadex_finance_check_owner;
ALTER FUNCTION finance_cash_drawer_trigger() OWNER TO eyadex_finance_check_owner;
ALTER FUNCTION finance_cash_closing_trigger() OWNER TO eyadex_finance_check_owner;
ALTER FUNCTION finance_check_number(uuid, uuid, text, smallint, integer, text) OWNER TO eyadex_finance_check_owner;
ALTER FUNCTION finance_check_number_sequence(uuid, uuid, text, smallint) OWNER TO eyadex_finance_check_owner;
ALTER FUNCTION finance_payment_number_trigger() OWNER TO eyadex_finance_check_owner;
ALTER FUNCTION finance_refund_number_trigger() OWNER TO eyadex_finance_check_owner;
ALTER FUNCTION finance_receipt_sequence_trigger() OWNER TO eyadex_finance_check_owner;
REVOKE ALL ON FUNCTION finance_check_patient(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_check_cash_movement(uuid, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_check_drawer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_check_closing(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_patient_money_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cash_movement_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cash_drawer_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_cash_closing_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_check_number(uuid, uuid, text, smallint, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_check_number_sequence(uuid, uuid, text, smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_payment_number_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_refund_number_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance_receipt_sequence_trigger() FROM PUBLIC;
