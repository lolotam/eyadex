-- Every foreign key needs a leading-column index (CLAUDE.md section 5). Rolls back;
-- safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/fk-indexes.sql

BEGIN;
DO $$
DECLARE
  c    record;
  gaps text := '';
BEGIN
  FOR c IN
    SELECT con.conrelid, array_to_string(con.conkey::integer[], ' ') AS fkey,
      tbl.relname AS tbl, con.conname,
      (SELECT string_agg(a.attname, ',' ORDER BY u.ord)
       FROM unnest(con.conkey::integer[]) WITH ORDINALITY AS u(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum) AS cols
    FROM pg_constraint con
    JOIN pg_class tbl ON tbl.oid = con.conrelid
    WHERE con.contype = 'f'
      AND tbl.relnamespace = 'public'::regnamespace
      AND tbl.relkind = 'r'
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index ix
      WHERE ix.indrelid = c.conrelid
        AND ix.indpred IS NULL
        AND ix.indexprs IS NULL
        AND (ix.indkey::text = c.fkey OR ix.indkey::text LIKE c.fkey || ' %')
    ) THEN
      gaps := gaps || format('%s.%s(%s); ', c.tbl, c.conname, c.cols);
    END IF;
  END LOOP;
  IF gaps <> '' THEN
    RAISE EXCEPTION 'FK-INDEX: foreign keys without a leading-column index: %', gaps;
  END IF;
END $$;
\echo 'FK index tests: all passed'
ROLLBACK;
