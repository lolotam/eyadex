# F3 export staging operation proposal

Status: prepared for review, NOT executed or operationally approved. Scope is staging only.
The owner approved the design in ADR-0036, not server SQL, bucket creation, IAM or lifecycle changes.
Use the final reviewed, green release SHA; `e4c75453` is a local runtime review candidate, not a
deployment approval. Record the actual candidate, current staging SHA and service deployments before
requesting execution approval.

## Access and prerequisites

- Use an authorized connector/browser on `musalam-2` (`116.202.66.131`). SSH has an unverified changed
  host key; never change trust or bypass host checking. The owner selected browser access. T3
  snapshot timeouts and the fallback browser's host-policy denial currently block that route.
- Confirm Dokploy's project `Eyadex.com`, environment `staging`, and the three `eyadex-*-staging`
  applications. Do not use a production database, service, bucket, credential or session.
- Require current-head CI (`verify`, `db`, `api-image`, `worker-image`, Socket), completed current-head
  review, and no unresolved blocking finding. Every promotion must contain the current staging SHA;
  do not rewrite published feature, `lovable` or `main` history.
- Review this plan with the owner before server writes. Secrets are entered privately by the owner
  under the staging runbook; no credential values belong in this document or command output.

## SQL release order

1. Keep `FINANCE_EXPORTS_ENABLED=false` in both API and worker. Record health and take a protected
   staging `pg_dump -Fc` plus `pg_dumpall --roles-only` backup, following staging-runbook §3b/§11.
2. Export `db/` from the exact candidate using `git archive`, preserving LF scripts. Inspect
   `migrate.sh --status` and `--dry-run` as the staging owner. Existing migration hashes must match.
3. The complete allowed pending set for this proposal is the following, in this order. Files already
   recorded are skipped only when their hashes match:
   - `0068_finance_reports_core.sql`: nullable expand fields, report/export tables, RLS and functions.
   - `0069_finance_reports_indexes.sql`: report indexes.
   - `0070_finance_reports_release.sql`: locked system-admin report grants.
   - `0074_finance_export_patient_sets.sql`: per-attempt own ledger, mode and bigint metadata.
   - `0075_finance_export_patient_attempt_index.sql`: complete leading-column foreign-key index.
4. Any other pending file, changed hash, missing applied file or out-of-order file stops this proposal.
   The stored-business-day writer/backfill/contract release is separate: its unshipped SQL numbers
   are now 0076–0078. Do not introduce its former reserved 0071–0073 below an applied 0074, run its
   backfills, add `NOT NULL`, or modify money rows as part of this export proposal.
5. After explicit owner approval, run the official migration runner with `lock_timeout=5s`, then
   status again. Never replay a file manually, edit an applied file or bypass the migration ledger.
6. Run every `db/tests/*.sql` with `ON_ERROR_STOP=1`. They roll back. Explicit evidence must include
   `rls-isolation.sql`, `fk-indexes.sql`, `finance-reports.sql`, `finance-reports-platform.sql` and
   `finance-reports-backfill.sql`. The migration-runner scratch-database self-test already runs locally
   and in CI; creating additional server scratch databases is not part of this proposal.

## Export-only private storage

Proposed new bucket: `eyadex-finance-exports-staging-20261027`. If it already exists, stop and choose
a fresh name with a recorded creation event; do not reuse or suspend a formerly versioned bucket.
Proposed new principals: `eyadex-f3-staging-api` and `eyadex-f3-staging-worker`. Both are export-only;
the existing medical principals, attachment bucket, policies and versioning remain unchanged.

The operator creates the private bucket and records empty versioning metadata immediately after
creation. Never enable versioning or Object Lock. Anonymous access is denied. Neither application
principal gets listing, bucket administration or versioning mutation rights.

API policy proposal (replace only the bucket name if the reviewed fresh name changes):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketVersioning"],
      "Resource": ["arn:aws:s3:::eyadex-finance-exports-staging-20261027"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::eyadex-finance-exports-staging-20261027/clinic/*/finance-exports/*"
      ]
    }
  ]
}
```

The worker policy has the same bucket statement and object resource, with object actions
`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:PutObjectTagging`. No medical bucket resource
appears in either policy. HEAD/stat uses `s3:GetObject`.

Lifecycle proposal, applied by the operator only after approval and read back afterwards:

```json
{
  "Rules": [
    {
      "ID": "finance-export-backstop",
      "Status": "Enabled",
      "Filter": { "Tag": { "Key": "eyadex-kind", "Value": "finance-export" } },
      "Expiration": { "Days": 2 }
    }
  ]
}
```

Test using opaque synthetic export keys only: anonymous GET denied; worker PUT with the required
tag, GET/HEAD and DELETE allowed; API GET/DELETE allowed; API PUT/tagging and both principals' bucket
listing denied; writes/deletes outside the export prefix and in the attachment bucket denied. After
deletion, verify the bytes are absent with an administrative check as well as the actual least-privilege
HEAD. A 403 is not proof of absence and must never mark a blob `gone`. Record the observed MinIO
missing-key behavior and versioning/lifecycle readback. A test double does not satisfy this gate.

## Configuration and promotion

Set independent `FINANCE_EXPORT_BLOB_S3_ENDPOINT`, `_BUCKET`, `_ACCESS_KEY`, `_SECRET_KEY`, optional
`_REGION` in API and worker. Each uses its own new principal. No medical-storage fallback. Retain the
same staging versioned FieldCipher keys. Non-secret settings: `FINANCE_EXPORT_MAX_QUEUED=10`,
`EXPORT_CONCURRENCY=2`, `EXPORT_SWEEP_INTERVAL_MS=60000`. API memory stays 512 MB; worker 384 MB
with 60-second stop grace, as the staging runbook specifies.

After approved SQL/storage steps and a green reviewed candidate, promote its SHA using the staging
runbook, deploy API/worker/web, record their actual running SHAs and readiness, then run
`docker/smoke-test.sh` for both staging hosts. Enable exports in API and worker together only after
storage proofs pass. A versioned, suspended or inaccessible bucket must refuse startup. No release
is accepted from health checks alone.

## Live acceptance and recovery

In the owner's signed-in synthetic clinic session, record CSV and XLSX request → queued/running →
done → authorized attachment download. Check the persisted winning attempt and single audit row
without printing patient names, file contents, keys or credentials. Confirm no anonymous/platform,
other requester/clinic or unauthorized report access. Queue a non-admin test member's job while
export claiming is deliberately paused, revoke its report grant through the normal authorized UI,
resume claiming, and confirm final `forbidden` and no published object. Do not change financial data,
send invitations or email, or create additional accounts without separate authorization.

Also test own reach loss before download, expiry/cleanup and late-upload lifecycle behavior with
synthetic records; an observed lifecycle readback is not proof that a late object was collected.
Repeat relevant journeys for Arabic/English at 1440/390 after Lovable's reviewed web slice is present.
Run representative resource tests under the configured memory limits, including simultaneous builds
and downloads. Local primitive measurements alone do not satisfy deployment acceptance.

On failure, disable exports in both processes first, stop/drain export work, retain the tagged
lifecycle backstop, and redeploy the recorded previous application deployment. The additive schema
may remain with exports disabled. Do not drop the ledger, undo grants or restore the database
automatically. If schema repair is needed, prepare a new forward-only migration; restoring the
protected staging backup is an explicit separate destructive operation. Production is untouched.

No merge occurs until current-head CI/review, real storage and staging acceptance, and the bilingual
responsive web slice all pass. Production SQL/storage application needs its own later approval.
