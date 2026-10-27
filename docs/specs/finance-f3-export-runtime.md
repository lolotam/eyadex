# F3 export runtime and rollout

Status: implemented locally, not deployed or accepted on staging. This extends the decided export
pipeline, not F3's product scope. The stored-business-day release (0071–0073) stays separate. These
queries intentionally use the same pre-contract business days as the on-screen API.

## API for the web slice

All routes require a clinic session, an active account and clinic, and the `finance` feature. A
platform host has no route. Report and covering permissions are checked by the report requested.

| Method | Path under `/v1/finance-reports/exports` | Answer                                                                                                 |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| POST   | `/`                                      | `202`, `reportExportResponseSchema`; body `reportExportRequestSchema`                                  |
| GET    | `/`                                      | `reportExportListResponseSchema`; `reportExportListQuerySchema` (`limit`, optional export-id `cursor`) |
| GET    | `/:id`                                   | `reportExportResponseSchema`, requester only                                                           |
| GET    | `/:id/download`                          | Private attachment bytes, CSV or XLSX; requester only                                                  |

Export metadata contains only the frozen contract's eight fields: `id`, `report`, `format`, `status`,
`createdAt`, `expiresAt`, `byteSize`, `rowCount`. No params, storage key, patient set, name or reason.
The list is newest first by `(created_at, id)`. The download is `private, no-store` with an id-only
attachment filename and a MIME type matching the format. No signed storage URL is returned.

Download authorization is read from the database before storage I/O and again afterwards. A lost
permission is `forbidden`; narrower reach is `not_found`. Another requester or clinic, an unfinished,
expired or purged job, or an own export without its patient set is `not_found`. Own patient reach uses
`BillingPatientReader.ownPatientFilter`; a file containing a patient who left that reach is deleted
before the blob marker and export are changed to `deleted` and `purged`. Patient ids clear at expiry.
All new export artifacts use the bounded `EYADEXE1` encrypted record format (ADR-0036), with
FieldCipher f1 key versions and clinic/export/attempt/index binding. Downloads authenticate the whole
object before the final authority check and first response byte. The API uses at most two active
download slots per process, rejects excess work with 503 without waiting, and keeps a slot and its
encrypted temporary file until response completion/abort. Expected ciphertext length comes from the
published metadata; an oversized source is destroyed before consuming its remaining body.

## Enabling the runtime

`FINANCE_EXPORTS_ENABLED=false` is the additive rollout default. No export controller is mounted and
the worker claims no export event until the switch is explicitly `true`. The API and worker must be
enabled together only after the private-store prerequisites below pass.

For the enabled API, `FINANCE_EXPORT_MAX_QUEUED=10` explicitly injects the owner-approved queue bound.
A missing, zero, negative, fractional or unsafe integer refuses boot. There is no implicit queue
value. `EXPORT_CONCURRENCY=2` is the separate worker-local build bound;
`EXPORT_SWEEP_INTERVAL_MS=60000` controls its periodic cleanup. Both processes require independent `FINANCE_EXPORT_BLOB_S3_*` settings
and the same versioned medical keys as the API. Do not copy credentials into a brief, command, log,
source file or review artifact.

The worker's dedicated poller records leases only during claims. Its post-commit queue runs the
reader and writers, heartbeats every 20 seconds, and bounds builds at 15 minutes. Every PUT has a
five-minute timeout and the tag `eyadex-kind=finance-export`. The 50-row-per-clinic sweep skips live
leases, expires published files at their stored 24-hour expiry, and re-deletes a `deleted` key after
22 minutes (longer than build + lease + PUT budgets). Only a missing stat makes it `gone`.

A ready preflight is only metadata. After allocating the attempt blob, the production reader derives
the frozen job from the live fence again inside `withTenant`. One non-holdable SELECT cursor retains
the financial snapshot and transfers 500 rows at a time. Plain SELECT authority/fence checks run
before and after pages, after name resolution and after writer finalization; no export-row lock spans
the read, so the heartbeat can renew. Pages feed the encrypted local writer with backpressure. No
network storage I/O runs in that transaction. Failed reads discard their local artifact and allocated
blob; a failed or revoked read cannot upload or publish.

Migration `0074_finance_export_patient_sets.sql` (0071-0073 remain reserved for the separate stored-day
release) adds a forced-RLS per-attempt own ledger and widens file-size/row-count metadata to bigint.
Own summaries stream per-patient monthly values into bounded monthly buckets, recording patients in
SQL pages. The ledger and completion marker commit only after the complete read/writer succeeds.
Publication requires the winning attempt's complete ledger and current patient reach. Downloads
check that set in SQL; no complete patient-id array leaves PostgreSQL. Legacy array records are
checked in SQL as well. Identifiers are redacted in bounded sweep pages once their file is deleted or
expired; no user entity or attempt trail is hard-deleted.

CSV preserves the reviewed formula/precision rules one row at a time. XLSX uses sequential ZIP64,
inline text cells and explicit text money, with no shared-string table or whole-sheet XML buffer.
After 1,048,575 data rows it opens another worksheet and repeats headers. All report rows remain in
the workbook. See `finance-f3-export-streaming.md` for the authenticated record format and tests.

## Storage actions prepared for owner approval, not applied

Use a newly created private exports-only bucket that has never had versioning enabled (owner design
approval 2026-10-27; ADR-0036). There is no fallback to `MEDICAL_BLOB_S3_*`. Both processes read bucket
versioning metadata before starting exports; Enabled, Suspended or inaccessible metadata refuses boot.
The existing attachment bucket and its versioning/policies remain unchanged. Additional resources
below use the actual bucket name only on the server:

| Principal           | Additional operations                                                    | Resource suffix              |
| ------------------- | ------------------------------------------------------------------------ | ---------------------------- |
| API storage user    | `s3:GetObject`, `s3:DeleteObject`                                        | `clinic/*/finance-exports/*` |
| Worker storage user | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:PutObjectTagging` | `clinic/*/finance-exports/*` |

Both principals also need `s3:GetBucketVersioning` on the export bucket itself. Neither principal receives bucket listing. The API receives no export PUT or tagging grant. Neither
export delete grant includes attachment keys. The lifecycle rule has only the tag filter
`eyadex-kind=finance-export` and `Expiration.Days=2`; it is the eventual backstop for a PUT that lands
after its key was marked `gone`, and does not shorten the published 24-hour retention.

Before enabling, record creation of the new never-versioned bucket, versioning metadata readback, and actual server checks: anonymous GET denied; worker export PUT/tag/delete/stat
allowed; worker tagging or deleting an attachment denied; API tagging or PUT on exports denied; API
export GET/delete allowed; lifecycle rule read back from the bucket. A document or an HTTP test
double does not prove these grants. Owner approval is still required before any policy or lifecycle
mutation. The additive 0074 migration needs a separately approved server plan; no production SQL, backfill or server storage mutation has been performed.

## Verification and remaining acceptance

Local verification includes the real PostgreSQL 18 runtime roles and Redis 8. The API flow test starts
the production export poller/runner in a separate Node process and uses signed S3 HTTP requests to a
test store. It proves HTTP request → committed outbox → worker → tagged bytes → authorized HTTP
download, plus revocation while queued producing a final `forbidden` with no object. Other tests
cover live lease fences, retries, lost publish responses, exact money, formula injection, current
download authorization, own purge, expiry and repeated deletion. The HTTP test store is not evidence
of a live MinIO policy.

Outstanding: security prerequisite PR #128; independent code review and CI on release heads; actual
staging deployment and private-bucket checks; authenticated staging success, forbidden caller and
queued revocation; Lovable's web slice in Arabic and English at 1440px and 390px. Keep the F3 roadmap
item unchecked and do not merge until these gates pass.
