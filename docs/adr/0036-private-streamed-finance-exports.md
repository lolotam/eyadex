# ADR-0036: Independent private storage and bounded finance exports

Status: accepted for local implementation by the owner, 2026-10-27. Operational application is not approved.

## Context

F3 export review established that deleting a key in the versioned medical attachment bucket leaves
old bytes behind. Whole-report and whole-download buffers also grow with valid clinic data; the
three-year period and local concurrency do not bound rows. R6 period semantics needed clarification.

## Decision

Use a newly created export-only bucket per environment which has never had versioning enabled.
Require independent `FINANCE_EXPORT_BLOB_S3_*` configuration in the API and worker, with no fallback
to attachment settings. Read `GetBucketVersioning` before starting exports and fail closed for an
enabled, suspended or inaccessible bucket. Keep private object access, canonical export keys,
export-only grants, no listing, immediate own purge and the tagged lifecycle backstop. Medical
attachment storage remains unchanged. Operators must verify the bucket creation history and actual
least-privilege deletion/stat behavior; metadata alone is not an operational acceptance record.

R6 remains the current clinic-wide credit balance across the complete ledger, including subsequent
allocations and refunds. Its validated shared request dates do not filter the result. Explain the
exception in both UI languages and the export action; introduce no new date-based money behavior.

Implement report SQL transfer, writers, encryption, upload and download incrementally with encrypted
temporary files. Preserve every row rather than adding a new business cap. Bound the own patient
set as well, maintain a consistent financial view and current authorization/fencing, authenticate the
complete download and repeat authorization before sending any byte. Temporary files contain only
ciphertext, and must be removed on success, errors, cancellation and shutdown. Changes to persisted
bookkeeping use a new forward-only migration with forced RLS and negative isolation tests, never an
edit to applied 0068. The concrete resource design and acceptance cases are recorded in
`docs/specs/finance-f3-export-review-decisions.md`.

## Consequences

Exports remain disabled until resource implementation, independent review, CI, owner-approved
operational setup and actual staging success/denial/queued-revocation checks all pass. Creating the
bucket, applying policies/lifecycle or SQL on a server each requires the separate operational gate.
The web brief is sent only after the API is frozen. No production SQL or storage change is performed
by this decision. The rejected shared-versioned-bucket approach would require complete version
tracking and reconciliation, including PUT responses lost in transit, and is larger than this slice.
