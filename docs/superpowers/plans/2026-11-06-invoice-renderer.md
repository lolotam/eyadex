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
