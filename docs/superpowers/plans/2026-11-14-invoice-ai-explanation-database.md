# Invoice AI Explanation — Database and retention

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Approved spec: `docs/superpowers/specs/2026-11-14-invoice-ai-explanation-design.md`. Parent plan: `docs/superpowers/plans/2026-11-14-invoice-ai-explanation.md`.

## Task 2: Add the temporary table and enforce lifecycle consistency

**Owner: Migrations lane explicitly.** **Files:** `db/sql/0077_invoice_explanation_requests.sql`, `db/tests/invoice-explanations.sql`, `db/tests/rls-isolation.sql`.

- [ ] Add the new table name to every relevant tenant/app table array in `rls-isolation.sql`. After its invoice seed inside the existing `c`/`s` loop, insert:

```sql
INSERT INTO invoice_explanation_requests
  (clinic_id,id,invoice_id,requested_by,question,language,status,created_at,updated_at,expires_at)
VALUES (c, ('00000000-0000-7000-8000-0000000006'||s||'1')::uuid,
  ('00000000-0000-7000-8000-0000000004'||s||'4')::uuid,
  ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid,
  'Explain the total','en','queued',now(),now(),now()+interval '1 hour');
```

- [ ] Run `psql -v ON_ERROR_STOP=1 -f db/tests/rls-isolation.sql` against the disposable baseline DB. Expected RED: relation `invoice_explanation_requests` does not exist.
- [ ] Add the table, indexes, grants, and policies below to the new migration. This is an ordinary persistent technical table with short retention, **not** a SQL TEMP table.

```sql
CREATE TABLE invoice_explanation_requests (
  clinic_id uuid NOT NULL REFERENCES clinics(id), id uuid NOT NULL,
  invoice_id uuid NOT NULL, requested_by uuid NOT NULL,
  question text, language text NOT NULL, status text NOT NULL,
  explanation text, error_code text,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (clinic_id,id),
  FOREIGN KEY (clinic_id,invoice_id) REFERENCES invoices(clinic_id,id),
  FOREIGN KEY (clinic_id,requested_by) REFERENCES memberships(clinic_id,id),
  CONSTRAINT invoice_explanations_language CHECK (language IN ('ar','en')),
  CONSTRAINT invoice_explanations_status CHECK (status IN ('queued','running','succeeded','failed')),
  CONSTRAINT invoice_explanations_expiry CHECK (expires_at = created_at + interval '1 hour'),
  CONSTRAINT invoice_explanations_question CHECK (question IS NULL OR
    (length(btrim(question)) BETWEEN 1 AND 1000 AND question = btrim(question))),
  CONSTRAINT invoice_explanations_answer CHECK (explanation IS NULL OR
    (length(btrim(explanation)) BETWEEN 1 AND 12000 AND explanation = btrim(explanation))),
  CONSTRAINT invoice_explanations_failure CHECK (error_code IS NULL OR error_code IN
    ('ai_not_configured','ai_generation_failed','ai_timeout','ai_rate_limited','ai_busy','ai_access_revoked')),
  CONSTRAINT invoice_explanations_shape CHECK (
    (status IN ('queued','running') AND question IS NOT NULL AND explanation IS NULL AND error_code IS NULL)
    OR (status = 'succeeded' AND question IS NULL AND explanation IS NOT NULL AND error_code IS NULL)
    OR (status = 'failed' AND question IS NULL AND explanation IS NULL AND error_code IS NOT NULL))
);
CREATE UNIQUE INDEX invoice_explanations_one_live
  ON invoice_explanation_requests(clinic_id,requested_by) WHERE status IN ('queued','running');
CREATE INDEX invoice_explanations_requester
  ON invoice_explanation_requests(clinic_id,requested_by,invoice_id,id);
CREATE INDEX invoice_explanations_invoice ON invoice_explanation_requests(clinic_id,invoice_id);
CREATE INDEX invoice_explanations_expiry_idx ON invoice_explanation_requests(clinic_id,expires_at,id);
ALTER TABLE invoice_explanation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_explanation_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_explanations_tenant ON invoice_explanation_requests TO eyadex_app
  USING (clinic_id = NULLIF(current_setting('app.clinic_id',true),'')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id',true),'')::uuid);
GRANT SELECT, INSERT, UPDATE ON invoice_explanation_requests TO eyadex_app;
REVOKE ALL ON invoice_explanation_requests FROM PUBLIC, eyadex_platform, eyadex_auth, eyadex_dispatcher;
```

- [ ] In `db/tests/invoice-explanations.sql`, use `BEGIN`/`ROLLBACK`, synthetic clinics/memberships/invoices following the explicit seed columns in `rls-isolation.sql`, and `SET LOCAL ROLE eyadex_app` for actual operations. Assert cross-clinic SELECT/UPDATE = zero rows, cross-clinic INSERT = `insufficient_privilege`, missing/empty tenant context = zero rows, cross-clinic composite FK references = `foreign_key_violation`, duplicate active requester = `unique_violation`. For each invalid status/result combination catch only `check_violation`; raise if INSERT succeeds. Include success-with-question, failure-with-answer, pending-with-error, empty/oversized question/answer, invalid language/code, and expiry other than one hour.
- [ ] Add the following catalog assertion; it fails rather than silently passing if the table is missing or RLS is not forced.

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'invoice_explanation_requests'::regclass
    AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION 'invoice explanation RLS must be enabled and forced';
  END IF;
  IF has_table_privilege('eyadex_platform','invoice_explanation_requests','SELECT')
     OR has_table_privilege('eyadex_app','invoice_explanation_requests','DELETE') THEN
    RAISE EXCEPTION 'invoice explanation grants widened';
  END IF;
END $$;
```

- [ ] Run `sh db/migrate.sh --dry-run` only. Expected: `0077` is pending. **Do not apply it yet:** Task 3 completes this same migration's retention function. The combined table/function/mirror is applied once, after Task 3 is authored; an applied migration is never edited, even while iterating on tests.


## Task 3: Add the purge function and Drizzle mirror in the same migration PR

**Owner: Migrations lane.** **Files:** same migration/test, `packages/db/src/schema/invoice-explanations.ts`, `packages/db/src/schema/index.ts`.

- [ ] Extend the SQL test with expired queued/running/succeeded/failed rows and a fresh row. Expired rows use both `created_at = now()-interval '2 hours'` and `expires_at = now()-interval '1 hour'`, preserving the expiry CHECK. Assert only dispatcher may execute the function, including an `eyadex_app` attempt with tenant context. Run `psql -v ON_ERROR_STOP=1 -f db/tests/invoice-explanations.sql` on the unmigrated disposable baseline; expected RED for the missing feature relation/function.
- [ ] Append this bounded function to `0077`; its owner can read only identifiers/expiry and delete already-expired rows, not inspect question/answer content.

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='eyadex_explanation_retention_owner') THEN
    CREATE ROLE eyadex_explanation_retention_owner NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO eyadex_explanation_retention_owner;
GRANT SELECT(clinic_id,id,expires_at), DELETE ON invoice_explanation_requests
  TO eyadex_explanation_retention_owner;
CREATE POLICY invoice_explanations_retention ON invoice_explanation_requests
  TO eyadex_explanation_retention_owner USING (expires_at <= now());
CREATE FUNCTION purge_expired_invoice_explanations(p_limit integer) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ DECLARE deleted integer; BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit must be 1..1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM public.invoice_explanation_requests
    WHERE (clinic_id,id) IN
      (SELECT clinic_id,id FROM public.invoice_explanation_requests
       WHERE expires_at <= now() ORDER BY clinic_id,expires_at,id LIMIT p_limit)
      AND expires_at <= now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END $$;
ALTER FUNCTION purge_expired_invoice_explanations(integer) OWNER TO eyadex_explanation_retention_owner;
REVOKE ALL ON FUNCTION purge_expired_invoice_explanations(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_invoice_explanations(integer) TO eyadex_dispatcher;
```

- [ ] Assert `p_limit` values NULL/0/1001 fail, a batch of 1 deletes exactly one expired row, repeated purge drains only expired rows, and platform/app/auth/dispatcher have no table DELETE grant. Check the NOLOGIN role has neither superuser nor BYPASSRLS and cannot SELECT `question` or `explanation`. Do not grant membership in that owner role to runtime roles.
- [ ] Build the Drizzle mirror using `pgTable`, `uuid`, `text`, `timestamp({ withTimezone: true, mode: "string" })`, `primaryKey`, `foreignKey`, `index`, `uniqueIndex`, and `check`, importing `clinics`, `invoices`, and `memberships` from their existing schema files. Match **every** column, explicit SQL constraint name, FK order/action and partial predicate. Use these declarations for the keys and export:

```ts
primaryKey({ name: "invoice_explanation_requests_pkey", columns: [t.clinicId, t.id] });
uniqueIndex("invoice_explanations_one_live").on(t.clinicId, t.requestedBy)
  .where(sql.raw("status = ANY (ARRAY['queued'::text, 'running'::text])"));
// packages/db/src/schema/index.ts
export { invoiceExplanationRequests } from "./invoice-explanations.ts";
```

- [ ] After both table and function are complete, run `sh db/migrate.sh --dry-run`, `sh db/migrate.sh`, and `sh db/migrate.sh --status` on the disposable test database. Expected: only the reviewed `0077` applies; no pending/CHANGED files afterwards. Read its exact CHECK strings with `psql -v ON_ERROR_STOP=1 -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='invoice_explanation_requests'::regclass ORDER BY conname"`; copy their expression bodies into the mirror's `check(name, sql.raw(expression))` declarations. SQL remains authoritative; do not generate or push a migration through Drizzle. Any subsequent SQL correction requires a fresh unapplied test database during development or a new forward migration after release, never an edited applied file.
- [ ] Run `pnpm --filter @eyadex/db build` and `pnpm --filter @eyadex/db test:db src/__tests__/schema-drift.db.spec.ts`, then `psql -v ON_ERROR_STOP=1 -f db/tests/invoice-explanations.sql` and `psql -v ON_ERROR_STOP=1 -f db/tests/rls-isolation.sql`. Expected GREEN, zero schema drift and all negative grant tests passing. SQL, mirror and RLS tests must travel together.
