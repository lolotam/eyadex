# ADR-0037: Bilingual server PDFs with memory-only Arabic extraction correction

Status: accepted design, recorded 2026-11-04 following the owner's 2026-11-03 confirmation of Amiri,
qpdf and pinned CI extractors. Production implementation and acceptance remain open. This record does
not grant operational authority.

## Context

The approved invoice endpoint returns a bilingual server-rendered PDF; a browser print view was
declined. The receipt uses the same rendering mechanism under its own payment permission. Typst
renders Arabic correctly, but the recorded probes found extraction failures with both the original
IBM Plex font and uncorrected Amiri output. The selected solution adds an ActualText correction and
prints Arabic currency names in full. The source probe 5 files are no longer available, so its
reported results cannot replace reproducible extraction and rendering tests of the implementation.

Patient text must not enter argv, logs, caches or temporary files. The qpdf command-line interface
expects seekable input; writing a patient PDF to disk to satisfy it would violate that constraint.

## Decision

- Render with pinned Typst 0.15.1 and Amiri 1.002 Regular 400/Bold 700. Vendor fonts, licence and hashes
  as specified in `docs/specs/finance-f1-pdf-design.md` §3.2. No runtime network fetching.
- Add qpdf 12.3.2 and apply the selected Arabic-only `/ActualText` correction before returning a PDF.
  Use libqpdf memory APIs behind the rendering adapter, carrying document bytes over stdin/stdout
  or in-process buffers. No document input files or decoded JSON files are permitted. The existing
  memory-bridge experiment proves only a roundtrip, not the correction's extraction correctness.
- Keep model fields allowlisted and amounts formatted from stored values. Patient display name is
  the only patient field in the document. The layout performs no money arithmetic. The Arabic KWD
  label is «دينار كويتي»; other currencies use their full Arabic names.
- Bound the entire Typst/qpdf pipeline: two concurrent renders, queue wait at most two seconds,
  total execution timeout five seconds, intermediate/final PDFs at most 5 MB each and any decoded
  JSON at most 32 MB. Failure kills children, releases capacity and returns no partial/uncorrected
  output. Logs carry fixed failure identifiers/exit codes, never child stderr or document text.
- Pin pdf.js 6.3.289 and poppler 25.12.0 in CI for reproducible extraction assertions. Visual page
  equivalence and every required Arabic/English word are adapter-test gates. These extraction tools
  do not run for each request and are not API runtime dependencies.
- Recheck the rendered invoice version/status under `FOR SHARE` in the post-render audit transaction
  for authenticated and public access. A changed version rejects stale bytes as `version_conflict`
  (412) without an open audit row. Public revocation/void retains `invoice_link_expired`; an
  authenticated void invoice may render its matching void version and banner. Rendering and network
  transmission hold no database lock; the final check/audit transaction is the decision point.
- Measure the complete pipeline on staging with a 50-line invoice. Only p95 ≤150 ms permits the
  synchronous API path. Otherwise use the versioned worker path of the PDF design §4, in a separate
  reviewed slice with its own storage/access tests. Developer timing does not choose placement.

## Consequences

The runtime image gains a pinned native dependency and a reviewed memory adapter. Its build,
licences, failure paths, output bounds and no-disk-data behavior need explicit checks. Any change
to fonts or extractor versions requires rerunning the bilingual extraction and rendering evidence.

The existing `UnavailableInvoicePdf` remains until the selected correction is reproduced and the
production implementation passes its gates. This ADR does not claim successful extraction,
production PDF availability or staging performance. Receipt sending and a public receipt link are
outside this decision; receipt PDF access retains `view:payments:*` and its branch/clinic isolation.
