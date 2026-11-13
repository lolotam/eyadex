# Invoice PDF staging gate

Status: preparation only. No deployment, migration, live-data write or renderer
activation is authorized by this document. Waleed decides those actions directly.

## Candidate and release order

The dependency order is PR #162 (delivery authorization), #163 (model), #164
(bounded renderer), #165 (packaged tools), then #166 (document binding). Record
the full tested head and image digest before any approved staging promotion.
CI and required reviews must cover that exact head. Verify each preserved Git
bundle and confirm the candidate contains the current staging commit before a
fast-forward. No schema change is intended; any new `db/sql` difference stops
this procedure for a separate migration decision.

The default application still binds `UnavailableInvoicePdf`. Deploying this
candidate alone must not be reported as a successful live PDF integration test.
The `invoicePdfModel` injection is test-only. There is no production activation
switch in this stack.

## Evidence before proposing activation

1. Record the staging service identifiers, current deployed SHA/image digest,
   previous healthy deployment, branch head, resource limits and restart policy.
   Exclude environment values, cookies, tokens, patient fields and private keys.
2. Verify the candidate's API image checks: tool and font hashes, distinct Regular
   and Bold embedded programs, Type3 glyph streams, licenses, non-root identity,
   inherited zero soft/hard core limits, and init/process-group cleanup.
3. On the intended Linux host, verify crash capture is disabled for every
   patient-bearing process. Zero core limits alone do not prove this when the
   kernel routes dumps to a pipe. A piped collector is a stop condition until an
   approved host policy supplies evidence. Do not crash a process holding real
   data; use only isolated synthetic probes after explicit authorization.
4. Benchmark the packaged renderer on the intended resource class using isolated
   synthetic fixtures, outside the staging business database. Cover small,
   maximum permitted 50-line, Arabic/English, marked Arabic, void, discount and
   maximum-logo cases. Record sample count, p50/p95/max, memory and refusal rates,
   both extraction results, page count and maximum output bytes. Keep the shared
   five-second execution deadline and bounded admission unchanged.
5. Apply the approved synchronous API p95 budget (150 ms). If it fails, stop
   synchronous activation and propose the separately reviewed worker design.
   A single successful render near five seconds does not pass this gate.
6. Close the malformed-logo follow-up: current PNG/JPEG magic-byte validation is
   not structural validation. Validate decodability and bounded dimensions on
   upload, cover previously stored malformed logos, and prove the render failure
   remains a sanitized `pdf_render_failed`. Do not silently omit the stored logo.

## Checks after an explicitly approved deployment

- Run `docker/smoke-test.sh` for the two staging hosts. Confirm web/API/worker
  SHA or image digests and health, tenant/platform host separation and cookies.
- With the renderer still disabled, confirm an authorized PDF request refuses
  with 503 and does not create a successful-open audit record. Lack of permission
  must still fail before rendering. Use existing authorized staging records only;
  no invitations, date edits, new staff or synthetic staging rows.
- An enabled-renderer test requires a separately approved activation candidate.
  Check authenticated and public-link success, complete bilingual content,
  private-logo cleanup, correct amounts and download headers. Keep document
  bytes and tokens out of logs and persisted evidence.
- Retain the isolated automated race suite as evidence for permission/role/link
  revocation and invoice version changes during rendering. Do not mutate shared
  staging permissions or dates to reproduce these races. Document this limit
  explicitly rather than claiming a real staging race test.
- Check saturation (`pdf_busy`, `Retry-After: 2`), native deadline, crashed child,
  unconfirmed process cleanup, stalled logo preparation/disposal and late cleanup
  in an isolated synthetic harness. No capacity reuse after unconfirmed cleanup.
- Record every pass/fail with exact SHA, environment, timestamp and non-sensitive
  result. Local isolated tests do not replace the real endpoint acceptance gate.

## Rollback and decision record

Before deployment, identify the exact previous healthy deployment and confirm
it is available for redeployment. On health, isolation, cleanup or performance
failure, stop acceptance and ask Waleed to authorize the concrete service rollback.
Do not rewrite published branches, reset databases or change host crash policy as
an implicit recovery action. Preserve the failing image, sanitized evidence and
Git bundles. Do not change production.

Merge readiness requires exact-head CI/reviews, all blocking findings resolved,
verified backups and applicable staging results in dependency order. Receipt and
UI work follow the stable invoice contract; production remains a separate owner
decision. The open production R9 check uses real rows read-only only when a clinic
with closings exists; it is not cleared by synthetic tests.
