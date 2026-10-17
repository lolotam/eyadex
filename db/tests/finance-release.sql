-- The finance F1 release (0063; spec §8c.3 item 4, plan Task 6, R2-4, FIN-4). Run as the migration owner,
-- which sees every clinic. Runs inside one transaction and ROLLS BACK, so it is safe on any database that
-- has the db/sql baseline.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/finance-release.sql

BEGIN;

-- Invariant on every clinic: each locked clinic admin holds the seven clinic-scope finance keys and no
-- branch or `own` one (the role is locked, so this lasts). Other roles are not checked here: after the
-- release the admin may grant them finance keys.
DO $$
DECLARE missing integer; extra integer; sample text;
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'FINANCE-RELEASE: run as the migration owner, which sees every clinic';
  END IF;
  SELECT count(*), min(r.clinic_id::text) INTO missing, sample
    FROM roles r JOIN permissions p ON p.module = 'finance' AND p.scope = 'clinic'
   WHERE r.system_key = 'clinic_admin' AND r.is_locked
     AND NOT EXISTS (SELECT 1 FROM role_permissions rp
                      WHERE rp.clinic_id = r.clinic_id AND rp.role_id = r.id AND rp.permission_id = p.id);
  IF missing > 0 THEN
    RAISE EXCEPTION 'FINANCE-RELEASE: % admin key(s) missing (e.g. clinic %)', missing, sample;
  END IF;
  SELECT count(*) INTO extra
    FROM roles r JOIN role_permissions rp ON rp.clinic_id = r.clinic_id AND rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.system_key = 'clinic_admin' AND r.is_locked AND p.module = 'finance' AND p.scope <> 'clinic';
  IF extra > 0 THEN
    RAISE EXCEPTION 'FINANCE-RELEASE: a locked clinic admin holds % branch or own finance key(s)', extra;
  END IF;
END $$;

-- Three clinics as the code before the release left them. A: a locked admin with every clinic-scope key
-- of the other modules, the three other system roles and a custom role. B: a clinic_admin role that is not
-- locked. C: a locked admin already holding view:invoices:clinic.
INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone, status, expires_at,
                     max_users, max_branches, created_at, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000063a1','finance-release-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000063a2','finance-release-b','ب','B','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000063a3','finance-release-c','ج','C','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO roles (clinic_id, id, system_key, name_ar, name_en, is_locked, is_active, created_at, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000063a1','00000000-0000-7000-8000-0000000063b1','clinic_admin','مدير','Admin',true,true,now(),now()),
  ('00000000-0000-7000-8000-0000000063a1','00000000-0000-7000-8000-0000000063b2','doctor','طبيب','Doctor',false,true,now(),now()),
  ('00000000-0000-7000-8000-0000000063a1','00000000-0000-7000-8000-0000000063b3','receptionist','استقبال','Front desk',false,true,now(),now()),
  ('00000000-0000-7000-8000-0000000063a1','00000000-0000-7000-8000-0000000063b4','technician','فني','Technician',false,true,now(),now()),
  ('00000000-0000-7000-8000-0000000063a1','00000000-0000-7000-8000-0000000063b5',NULL,'مخصص','Custom',false,true,now(),now()),
  ('00000000-0000-7000-8000-0000000063a2','00000000-0000-7000-8000-0000000063c1','clinic_admin','مدير','Admin',false,true,now(),now()),
  ('00000000-0000-7000-8000-0000000063a3','00000000-0000-7000-8000-0000000063d1','clinic_admin','مدير','Admin',true,true,now(),now());
INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
SELECT '00000000-0000-7000-8000-0000000063a1', uuidv7(), '00000000-0000-7000-8000-0000000063b1', id, now()
  FROM permissions WHERE scope = 'clinic' AND module <> 'finance';
INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
SELECT r.clinic_id, uuidv7(), r.id, p.id, now()
  FROM (VALUES
      ('00000000-0000-7000-8000-0000000063b2', 'view:appointments:own'),
      ('00000000-0000-7000-8000-0000000063b3', 'view:patients:branch'),
      ('00000000-0000-7000-8000-0000000063b4', 'view:patients:branch'),
      ('00000000-0000-7000-8000-0000000063b5', 'view:appointments:own'),
      ('00000000-0000-7000-8000-0000000063c1', 'view:patients:clinic'),
      ('00000000-0000-7000-8000-0000000063d1', 'view:invoices:clinic')
    ) AS g (role_id, key)
  JOIN roles r ON r.id = g.role_id::uuid
  JOIN permissions p ON p.key = g.key;
UPDATE platform_settings SET default_module_finance = true;
DO $$
BEGIN
  PERFORM set_config('finance_release.before', (SELECT count(*) FROM role_permissions)::text, true);
END $$;

\ir ../sql/0063_finance_release.sql

DO $$
DECLARE
  got text;
  want text;
  rid text;
  seven constant text := 'create:discounts:clinic,create:invoices:clinic,deactivate:invoices:clinic,'
    'update:invoices:clinic,update:prices:clinic,view:invoices:clinic,view:prices:clinic';
  added bigint := (SELECT count(*) FROM role_permissions)
                  - current_setting('finance_release.before')::bigint;
BEGIN
  -- Per role: the finance keys it holds after the release. Only the locked admins gain any.
  FOR rid, want IN VALUES
    ('00000000-0000-7000-8000-0000000063b1', seven),
    ('00000000-0000-7000-8000-0000000063b2', ''),
    ('00000000-0000-7000-8000-0000000063b3', ''),
    ('00000000-0000-7000-8000-0000000063b4', ''),
    ('00000000-0000-7000-8000-0000000063b5', ''),
    ('00000000-0000-7000-8000-0000000063c1', ''),
    ('00000000-0000-7000-8000-0000000063d1', seven)
  LOOP
    SELECT coalesce(string_agg(p.key, ',' ORDER BY p.key COLLATE "C"), '') INTO got
      FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = rid::uuid AND p.module = 'finance';
    IF got <> want THEN
      RAISE EXCEPTION 'FINANCE-RELEASE: role % holds finance keys "%", expected "%"', rid, got, want;
    END IF;
  END LOOP;
  -- Seven for clinic A's admin, six for clinic C's (it already held one): no other key moved.
  IF added <> 13 THEN RAISE EXCEPTION 'FINANCE-RELEASE: the release added % keys, expected 13', added; END IF;
  IF (SELECT default_module_finance FROM platform_settings) THEN
    RAISE EXCEPTION 'FINANCE-RELEASE: the new-clinic default for finance is on';
  END IF;
  PERFORM set_config('finance_release.before', (SELECT count(*) FROM role_permissions)::text, true);
END $$;

-- The post-deploy catch-up (0063's statement) changes nothing on a clinic the release already reached.
\ir ../maintenance/finance-release-catch-up.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM role_permissions) <> current_setting('finance_release.before')::bigint THEN
    RAISE EXCEPTION 'FINANCE-RELEASE: the catch-up added keys';
  END IF;
END $$;

\echo 'Finance release tests: all passed'
ROLLBACK;
