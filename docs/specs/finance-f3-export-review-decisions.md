# F3 export review decisions — proposed, not approved

Review baseline: `d0b9d974` / PR #133. Export rollout remains disabled. Owner approved all three recommended choices on 2026-10-27: a new never-versioned export bucket,
R6 current balances without the period filter, and incremental encrypted temporary files without a
new business row cap. This authorizes design and local implementation only, not server storage,
policy, lifecycle or SQL mutations or deployment.

## Evidence collected locally

- The current `S3ExportBlobs.delete` was exercised against isolated MinIO
  `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` with versioning enabled. After two writes and a delete,
  `exists` returned false but an owner inspection found two retained versions and one delete marker.
  A second run with an export-only worker user, without bucket listing, retained one version after
  one write/delete. A missing-key HEAD returned 404 both after deletion and for a never-written key.
  Present-key HEAD succeeded under `s3:GetObject`; there is no separate S3 HEAD permission.
- These are local MinIO results, not proof of staging policies. AWS S3 can return 403 for a missing
  key without bucket-list permission. A 403 must never be treated as proof that a key is gone.
- The production CSV writer was measured with synthetic seven-column daily-taking rows. At 10,000
  rows, output was 628,947 bytes and RSS approximately 116 MiB; at 50,000 rows, output was 3,188,947
  bytes and RSS approximately 221 MiB. This excludes PostgreSQL row loading, encryption, XLSX and
  concurrent downloads. It demonstrates growth, not a production crash or a certified capacity.
- The worker lockfile importer already includes AWS SDK 3.1148.0. The pinned frozen install passed.
  The missing-lockfile review item is a false positive.

References: [AWS DeleteObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html),
[AWS HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html),
`medical-blob-runbook.md` §2–3, `finance-f3-export-pipeline.md` §6, and the existing R6 query/test in
`report-balances.ts` / `report-balances.db.spec.ts`.

## Decision 1 — export storage

Approved: provision a new exports-only bucket per environment which has never had versioning
enabled. Keep the medical attachment bucket and its versioning unchanged.

Concrete implementation under the approved design:

- Require independent `FINANCE_EXPORT_BLOB_S3_ENDPOINT`, `_BUCKET`, `_ACCESS_KEY`, `_SECRET_KEY`
  and optional `_REGION` settings in API and worker. No fallback to attachment storage settings.
  Keep the current per-clinic encryption keys and AAD.
- Validate bucket versioning on startup: reject Enabled and Suspended. The operator must verify a
  newly provisioned, never-versioned bucket; suspending an old versioned bucket is insufficient.
- Preserve the canonical export prefix, private API downloads, tagged PUTs and the two-day tagged
  lifecycle rule. API object grants stay get/delete; worker grants stay get/put/delete/tag. Add
  only the bucket-versioning metadata read needed for validation, with no listing grant.
- Verify missing-key stat behavior with the actual least-privilege principals on staging. A 403
  fails closed and cannot advance the blob ledger to gone.

Rejected alternative: keep shared versioned storage and design a complete version ledger/reconciliation,
version-specific deletion and noncurrent-version cleanup. Recording only successful PUT version IDs
misses writes whose responses were lost. That alternative is larger and changes the cleanup model.

The bucket, IAM policies and lifecycle are a separate operational approval after the concrete
configuration and verification commands are reviewed. No server action has been performed.

## Decision 2 — R6 patient-credit range semantics

Approved: preserve the existing current clinic-wide remaining-balance calculation, and explicitly
exempt R6 from the date filter in the specification and UI. The date range remains validated by the
shared request shape, but must not be described as limiting R6's current balance.

The current screen, mock and export subtract all funded allocations and credit refunds, including
later spending. Existing tests deliberately expect the same balance for a different selected period.
The broad sentence in the parent specification does not explicitly settle this exception.

Alternatives not selected:

- A historical balance as of `to`, with a defined treatment of earlier credit, later allocations and
  later refunds; `from` would not by itself define a balance.
- Current remaining balances restricted to credits originating within `from`/`to`.

Do not add a `created_at` WHERE clause: it silently chooses one interpretation.
Add an acceptance case with credit before the range and spending after it for the selected meaning.

## Decision 3 — bounded file handling

Approved: implement incremental report/file handling with encrypted temporary files, rather than
introducing an unapproved business row/byte cap or truncating successful exports.

Required properties of the implementation design:

- Bound SQL transfer and writer working sets; retain a consistent report view, stable row order,
  forced RLS and current scope checks. Naive pagination across changing finance data is insufficient.
- Avoid holding the export row lock for the whole build, so heartbeats can renew. Preserve the
  existing database statement timeout; the 15-minute attempt budget is not a SQL timeout setting.
- Add bounded streaming encryption/integrity verification while retaining clinic/export/attempt AAD
  and key-version handling. Never spill patient plaintext or unauthenticated decrypted bytes.
  FieldCipher currently buffers; write-excel-file's toStream also builds sheet content first.
- Upload from a bounded source with known length, keeping allocated/uploaded/published fencing,
  cancellation, lost-response recovery and cleanup. No lock spans storage network I/O.
- Bound the own patient set as well: use server-side, tenant-isolated bookkeeping if required,
  publish the set only in the winning transaction, and keep download reach evaluation in SQL.
  Any schema addition needs a new migration/RLS/negative tests; never edit applied 0068.
- Verify complete download integrity, repeat current authorization before the first response byte,
  and hold a bounded download slot until response completion. Clean encrypted temporary files on
  success, errors, abort and shutdown. Do not create an unbounded waiting queue.

Keep the storage/config correction in #133. If the resource correction exceeds the delivery slice
limit, put it in an additional dependent PR; the full stack stays unmerged and disabled until ready.
Freeze the web API only after implementing these decisions and passing the checks, then send Lovable its web-only brief.

Acceptance: growing valid datasets under deployment resource limits; exact CSV/XLSX money and formula
guards; no partial successful file; responsive heartbeat/cancellation; no bytes on integrity failure;
revocation during read/download; own reach purge; real MinIO byte deletion and late-PUT lifecycle.
