-- Proof for plan Task 4: closing the platform's direct currency update. Runs in one transaction and rolls back.
\set ON_ERROR_STOP on
BEGIN;

-- The 0060 columns (as planned).
ALTER TABLE clinics
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'KWD',
  ADD COLUMN currency_exponent smallint NOT NULL DEFAULT 3,
  ADD COLUMN tax_rate_bp int NOT NULL DEFAULT 0;

INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone, status, expires_at, max_users, max_branches, created_at, updated_at)
VALUES ('00000000-0000-7000-8000-0000000f0001', 'proof-a', 'أ', 'A', 'general', 'ar', 'Asia/Kuwait', 'active', now() + interval '1 year', 10, 3, now(), now());

-- 1. BEFORE: the table-level grant (0013:34) lets the platform change the currency directly.
SET LOCAL ROLE eyadex_platform;
UPDATE clinics SET currency = 'SAR' WHERE id = '00000000-0000-7000-8000-0000000f0001';
RESET ROLE;
SELECT 'before: platform updated currency directly -> ' || currency AS proof FROM clinics WHERE slug = 'proof-a';

-- 2. A column-level REVOKE alone leaves the table-level grant in force.
REVOKE UPDATE (currency, currency_exponent) ON clinics FROM eyadex_platform;
SELECT 'after column-only revoke: table UPDATE still ' || has_table_privilege('eyadex_platform', 'clinics', 'UPDATE')
       || ', column currency UPDATE still ' || has_column_privilege('eyadex_platform', 'clinics', 'currency', 'UPDATE') AS proof;

-- 3. The planned fix: revoke the TABLE privilege, then grant UPDATE on every other column, listed by name.
DO $$
DECLARE
  expected text[] := ARRAY['id','slug','name_ar','name_en','specialty','default_language','timezone','status',
                           'expires_at','max_users','max_branches','created_at','updated_at','currency',
                           'currency_exponent','tax_rate_bp'];
  actual text[];
BEGIN
  SELECT array_agg(column_name::text ORDER BY ordinal_position) INTO actual
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clinics';
  IF actual <> expected THEN
    RAISE EXCEPTION 'clinics columns changed: % — review the platform UPDATE list', actual;
  END IF;
END $$;
REVOKE UPDATE ON clinics FROM eyadex_platform;
GRANT UPDATE (slug, name_ar, name_en, specialty, default_language, timezone, status, expires_at,
              max_users, max_branches, updated_at, tax_rate_bp) ON clinics TO eyadex_platform;

SELECT 'effective: table UPDATE ' || has_table_privilege('eyadex_platform', 'clinics', 'UPDATE')
       || ', currency ' || has_column_privilege('eyadex_platform', 'clinics', 'currency', 'UPDATE')
       || ', currency_exponent ' || has_column_privilege('eyadex_platform', 'clinics', 'currency_exponent', 'UPDATE')
       || ', tax_rate_bp ' || has_column_privilege('eyadex_platform', 'clinics', 'tax_rate_bp', 'UPDATE')
       || ', status ' || has_column_privilege('eyadex_platform', 'clinics', 'status', 'UPDATE')
       || ', SELECT ' || has_table_privilege('eyadex_platform', 'clinics', 'SELECT')
       || ', INSERT ' || has_table_privilege('eyadex_platform', 'clinics', 'INSERT') AS proof;

-- 4. AFTER: direct currency updates are refused; permitted updates still work.
SET LOCAL ROLE eyadex_platform;
DO $$
BEGIN
  BEGIN
    UPDATE clinics SET currency = 'KWD' WHERE slug = 'proof-a';
    RAISE EXCEPTION 'FAIL: platform could still update currency';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: currency update refused';
  END;
  BEGIN
    UPDATE clinics SET currency_exponent = 2 WHERE slug = 'proof-a';
    RAISE EXCEPTION 'FAIL: platform could still update currency_exponent';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: currency_exponent update refused';
  END;
  BEGIN
    UPDATE clinics SET status = 'suspended', currency = 'KWD' WHERE slug = 'proof-a';
    RAISE EXCEPTION 'FAIL: a mixed update reached currency';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: mixed update with currency refused';
  END;
END $$;
UPDATE clinics SET tax_rate_bp = 500, status = 'suspended', max_users = 12, expires_at = now() + interval '30 days',
                   updated_at = now()
WHERE slug = 'proof-a';
INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone, status, expires_at, max_users, max_branches, created_at, updated_at, currency, currency_exponent, tax_rate_bp)
VALUES ('00000000-0000-7000-8000-0000000f0002', 'proof-b', 'ب', 'B', 'general', 'ar', 'Asia/Riyadh', 'active', now() + interval '1 year', 10, 3, now(), now(), 'SAR', 2, 1500);
RESET ROLE;
SELECT 'after: ' || slug || ' currency=' || currency || ' tax=' || tax_rate_bp || ' status=' || status
       || ' max_users=' || max_users AS proof
FROM clinics WHERE slug IN ('proof-a', 'proof-b') ORDER BY slug;

ROLLBACK;
