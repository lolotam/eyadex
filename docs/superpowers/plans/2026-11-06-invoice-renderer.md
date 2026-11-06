# Invoice renderer implementation slices

Status: implementation in progress. Scope follows the owner's renderer request,
`finance-f1-pdf-design.md` and ADR-0037. This record is not release authority.

## 1. Delivery decision transaction

- Revalidate the invoice version and status after rendering under `FOR SHARE`.
- On the public path, lock the original link after the invoice and validate its
  identity, token hash, clinic/invoice binding, revocation and fresh expiry.
- A public link refusal takes precedence over a version conflict. Neither
  refusal returns bytes or writes an open audit event.
- Preserve authenticated reach checks and existing PDF response headers.
- Verify with real isolated PostgreSQL tests, including edits, revocation,
  expiry and lock serialization. Rendering must hold no database lock.

## 2. Allowlisted model and bounded renderer

- Build the documented view model from stored amounts and permitted display
  fields. Patient display name is the only patient field.
- Move the verified layout/correction into runtime-owned code; production must
  not import research files or depend on the Python verification toolchain.
- Add pinned Typst/Amiri/qpdf assets and a killable memory-only bridge.
- Enforce two execution slots, two-second queue wait, five-second shared
  execution deadline, output limits, EPIPE handling and child cleanup.
- Prove timeout, failure and concurrency behavior with synthetic processes.
  Verify actual rendering/extraction and pixel equivalence independently.

## 3. Integration and release evidence

- Wire the renderer only after the applicable execution/crash-protection gates.
- Measure the complete 50-line path on staging: the documented p95 threshold
  decides synchronous API versus a separately reviewed worker slice.
- Preserve the existing five-second limit; a slow local proof is not a waiver.
- Receipt and web integration follow the stable invoice API. Staging/deployment
  actions and production enablement remain subject to the owner's direct gates.

Each slice gets its own reviewable PR, exact-head CI, and applicable staging
evidence. The synthetic outline proof merged in PR #161 does not by itself
activate PDF rendering or satisfy production acceptance.

## First-slice local verification

The public-link and invoice-send database suites passed 23 tests on isolated
PostgreSQL 18 and Redis 8. Four focused regressions failed against the preceding
invoice/public-link use cases: edited public PDF, edited authenticated PDF,
permission loss during rendering, and serialization behind link revocation.
Candidate sources were restored and typechecking passed. The API linter passed.
No SQL migration or live-environment data change is part of this slice.

Review round 1 added inactive-role and role-plus-disabled-module regressions.
The two suites now pass 25 tests; both new cases fail against the preceding
role check. Role refusal follows the subscription and module decisions, and
expiry rules live in the billing domain. Port methods carry Arabic JSDoc.

## Second-slice model checkpoint

The unwired `invoicePdfModel` builds an explicit text-only allowlist from the
stored invoice, permitted header fields and the separately supplied patient
display name. It carries no internal IDs or patient contact fields. Stored
minor amounts are formatted without recalculating totals; a saved percentage
discount stays a percentage and a saved fixed discount stays an amount.
Dates use the clinic timezone and the same long-date locales as prescription
printing. The model retains complete descriptions, reasons and void facts.

Fourteen focused unit cases cover currency exponents, exact large amounts,
timezone date rollover, allowlisting, complete 50-line content, tax visibility,
void data, and invalid-input refusals. Typecheck, lint and formatting pass.
Database/header loading, logo transport, template adaptation and the bounded
process runner are not yet connected. `UnavailableInvoicePdf` remains active;
this checkpoint neither enables PDF responses nor clears the staging gate.

## Third-slice bounded runtime checkpoint

The unwired Typst adapter now launches a memory-only child pipeline with two
slots, two-second queue expiry and a shared five-second execution deadline.
It refuses oversized input/output and unsafe core-dump policy. The child uses
the runtime-owned layout and binder, qpdf's memory bridge, and a final page-count
check. No production imports point into the research directory.

Thirteen unit cases passed for the process/policy boundary. Seven Linux cases
passed with the existing pinned research toolchain: timeout cleanup, early
bridge-exit descendant cleanup, and E1/E2/void extraction through pdf.js and
pdftotext. The review's early-exit cleanup defect was reproduced before fixing
it; the missing Arabic void date was added to the runtime layout.
The next review also required kernel confirmation before capacity reuse. Two
new regressions fail against the earlier source and pass with bounded cleanup
confirmation and fail-closed admission when cleanup cannot be confirmed.

A full 50-line void render succeeded once near the execution limit and hit the
five-second deadline in another run. The small correctness fixtures in CI do
not stand in for the maximum-content performance gate. This host also has a
piped WSL crash collector, which the production adapter correctly refuses.
The pinned tools/fonts still need production-image packaging, header/logo
loading and final wiring are pending, and staging measurements must determine
API-versus-worker placement before activation. The timeout remains five seconds.
