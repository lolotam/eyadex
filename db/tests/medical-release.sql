-- The P2 release (0050, ADR-0029 §12; plan Task 12, R1-16, R2-3, R2-5). Run as the migration owner, which
-- sees every clinic. Runs inside one transaction and ROLLS BACK, so it is safe on any database that has
-- the db/sql baseline; on a live one run it after db/maintenance/medical-release-catch-up.sql, and its
-- first check names a clinic the catch-up has not reached yet.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/medical-release.sql

BEGIN;

-- R2-3: new clinics get the medical module by default. Invariant: every locked clinic admin holds the
-- clinic-scope visits and medicines keys and no medical key (P2-5; the role is locked, so this lasts).
DO $$
DECLARE missing integer; extra integer; sample text;
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'MEDICAL-RELEASE: run as the migration owner, which sees every clinic';
  END IF;
  IF NOT (SELECT default_module_medical FROM platform_settings) THEN
    RAISE EXCEPTION 'MEDICAL-RELEASE: the new-clinic default for medical is still off';
  END IF;
  SELECT count(*), min(r.clinic_id::text) INTO missing, sample
    FROM roles r JOIN permissions p
      ON p.key IN ('view:visits:clinic', 'view:medicines:clinic', 'update:medicines:clinic')
   WHERE r.system_key = 'clinic_admin' AND r.is_locked
     AND NOT EXISTS (SELECT 1 FROM role_permissions rp
                      WHERE rp.clinic_id = r.clinic_id AND rp.role_id = r.id AND rp.permission_id = p.id);
  IF missing > 0 THEN
    RAISE EXCEPTION 'MEDICAL-RELEASE: % admin key(s) missing (e.g. clinic %); run the catch-up',
      missing, sample;
  END IF;
  SELECT count(*) INTO extra
    FROM roles r JOIN role_permissions rp ON rp.clinic_id = r.clinic_id AND rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.system_key = 'clinic_admin' AND p.resource = 'medical';
  IF extra > 0 THEN RAISE EXCEPTION 'MEDICAL-RELEASE: a clinic admin holds % medical key(s)', extra; END IF;
END $$;

-- Two clinics as the onboarding before the release left them (system_roles.ts then): clinic A with the
-- four system roles, a custom role holding view:appointments:own and its medical flag off; clinic B whose
-- doctor role the admin already handed view:visits:clinic (R1-2), with no medical flag row at all.
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000050a1','medical-release-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000050a2','medical-release-b','ب','B','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO roles VALUES
  ('00000000-0000-7000-8000-0000000050a1','00000000-0000-7000-8000-0000000050b1','clinic_admin','مدير','Admin',true,true,now(),now()),
  ('00000000-0000-7000-8000-0000000050a1','00000000-0000-7000-8000-0000000050b2','doctor','طبيب','Doctor',false,true,now(),now()),
  ('00000000-0000-7000-8000-0000000050a1','00000000-0000-7000-8000-0000000050b3','receptionist','استقبال','Front desk',false,true,now(),now()),
  ('00000000-0000-7000-8000-0000000050a1','00000000-0000-7000-8000-0000000050b4','technician','فني','Technician',false,true,now(),now()),
  ('00000000-0000-7000-8000-0000000050a1','00000000-0000-7000-8000-0000000050b5',NULL,'مخصص','Custom',false,true,now(),now()),
  ('00000000-0000-7000-8000-0000000050a2','00000000-0000-7000-8000-0000000050c2','doctor','طبيب','Doctor',false,true,now(),now());
INSERT INTO role_permissions
SELECT '00000000-0000-7000-8000-0000000050a1', uuidv7(), '00000000-0000-7000-8000-0000000050b1', id, now()
  FROM permissions WHERE scope = 'clinic' AND module <> 'medical';
INSERT INTO role_permissions
SELECT r.clinic_id, uuidv7(), r.id, p.id, now()
  FROM (VALUES
      ('00000000-0000-7000-8000-0000000050b2', 'view:appointments:own'),
      ('00000000-0000-7000-8000-0000000050b2', 'view:patients:own'),
      ('00000000-0000-7000-8000-0000000050b3', 'view:patients:branch'),
      ('00000000-0000-7000-8000-0000000050b3', 'create:patients:branch'),
      ('00000000-0000-7000-8000-0000000050b3', 'update:patients:branch'),
      ('00000000-0000-7000-8000-0000000050b3', 'view:appointments:branch'),
      ('00000000-0000-7000-8000-0000000050b3', 'create:appointments:branch'),
      ('00000000-0000-7000-8000-0000000050b3', 'update:appointments:branch'),
      ('00000000-0000-7000-8000-0000000050b3', 'view:schedules:branch'),
      ('00000000-0000-7000-8000-0000000050b3', 'view:services:clinic'),
      ('00000000-0000-7000-8000-0000000050b4', 'view:patients:branch'),
      ('00000000-0000-7000-8000-0000000050b5', 'view:appointments:own'),
      ('00000000-0000-7000-8000-0000000050c2', 'view:appointments:own'),
      ('00000000-0000-7000-8000-0000000050c2', 'view:visits:clinic')
    ) AS g (role_id, key)
  JOIN roles r ON r.id = g.role_id::uuid
  JOIN permissions p ON p.key = g.key;
INSERT INTO clinic_features VALUES
  ('00000000-0000-7000-8000-0000000050a1','00000000-0000-7000-8000-0000000050d1','medical',false,now());
DO $$
BEGIN
  PERFORM set_config('medical_release.before', (SELECT count(*) FROM role_permissions)::text, true);
END $$;

\ir ../maintenance/medical-release-catch-up.sql

DO $$
DECLARE
  got text;
  want text;
  rid text;
  added bigint := (SELECT count(*) FROM role_permissions)
                  - current_setting('medical_release.before')::bigint;
BEGIN
  -- Per role: the keys of the medical module it holds after the catch-up (R1-16).
  FOR rid, want IN VALUES
    ('00000000-0000-7000-8000-0000000050b1', 'update:medicines:clinic,view:medicines:clinic,view:visits:clinic'),
    ('00000000-0000-7000-8000-0000000050b2', 'create:visits:own,update:medical:own,view:medical:own,view:medicines:clinic,view:visits:own'),
    ('00000000-0000-7000-8000-0000000050b3', 'view:visits:branch'),
    ('00000000-0000-7000-8000-0000000050b4', ''),
    ('00000000-0000-7000-8000-0000000050b5', ''),
    -- One scope per action: the visits key it already held stays alone.
    ('00000000-0000-7000-8000-0000000050c2', 'create:visits:own,update:medical:own,view:medical:own,view:medicines:clinic,view:visits:clinic')
  LOOP
    SELECT coalesce(string_agg(p.key, ',' ORDER BY p.key COLLATE "C"), '') INTO got
      FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = rid::uuid AND p.module = 'medical';
    IF got <> want THEN
      RAISE EXCEPTION 'MEDICAL-RELEASE: role % holds medical keys "%", expected "%"', rid, got, want;
    END IF;
  END LOOP;
  IF added <> 13 THEN RAISE EXCEPTION 'MEDICAL-RELEASE: the catch-up added % keys, expected 13', added; END IF;
  -- R1-16: a custom role holding the doctor's own key gains nothing.
  SELECT string_agg(p.key, ',') INTO got
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
   WHERE rp.role_id = '00000000-0000-7000-8000-0000000050b5';
  IF got <> 'view:appointments:own' THEN
    RAISE EXCEPTION 'MEDICAL-RELEASE: the custom role holds "%"', got;
  END IF;
  -- The release never switches an existing clinic's module on.
  IF (SELECT count(*) FROM clinic_features
       WHERE clinic_id IN ('00000000-0000-7000-8000-0000000050a1', '00000000-0000-7000-8000-0000000050a2')
         AND module = 'medical' AND enabled) <> 0 THEN
    RAISE EXCEPTION 'MEDICAL-RELEASE: the catch-up switched a clinic''s medical module on';
  END IF;
  PERFORM set_config('medical_release.before', (SELECT count(*) FROM role_permissions)::text, true);
END $$;

-- R2-5: a second run changes nothing.
\ir ../maintenance/medical-release-catch-up.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM role_permissions) <> current_setting('medical_release.before')::bigint THEN
    RAISE EXCEPTION 'MEDICAL-RELEASE: a second catch-up run added keys';
  END IF;
END $$;

\echo 'Medical release tests: all passed'
ROLLBACK;
