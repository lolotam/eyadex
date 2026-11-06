# Invoice PDF runtime assets

The renderer runs `render.mjs` as a child process. It accepts the allowlisted
model on stdin and emits only the final PDF on stdout. The script compiles the
layout with Typst, reads qpdf JSON through the memory bridge, binds extraction
text, serializes through the memory bridge, and rechecks the final page count.
Its native tool paths are trusted deployment configuration, never request data.

The layout and binder originate in the repository's synthetic invoice proof.
`provenance.json` records the original source hashes. Runtime adaptations add
the saved invoice-level discount and both void-date languages. The source proof
is retained independently; production code does not import from `docs/`.

## Limits and deployment status

The parent permits two active pipelines, at most two seconds of queue wait,
and five seconds for the complete child lifetime. PDFs are limited to 5 MiB;
input and decoded JSON are limited to 32 MiB. Child stderr is discarded. A
maximum of two requests may wait; excess is refused immediately. Model
serialization happens only after admission to an execution slot, so waiting
models do not retain serialized buffers.
A
failure kills the process group, including when the bridge exits early. Linux
tests use container init to reap orphaned descendants. Capacity stays reserved
until the kernel confirms that the process group is gone. If cleanup remains
unconfirmed after one second, the request fails and this renderer instance
rejects queued and future work; it never reuses unconfirmed capacity. This
cleanup interval does not extend the five-second execution allowance.

This adapter is **not wired into BillingModule**. The API still uses
`UnavailableInvoicePdf`. The API image now packages pinned Typst/Amiri/qpdf
tools and their licenses, with a non-root image smoke test. Core limits must be zero in the API and
children; a piped host crash collector causes the adapter to refuse rendering.
Effective host crash capture and forced-crash verification remain release
gates, as do the staging performance and authorization scenarios.

The synthetic Linux tests exercise the child directly with zero core limits.
They do not bypass the deployment guard for real requests. They verify Arabic
and English extraction with the pinned pdf.js and pdftotext, normal/void
invoices, timeout cleanup and early-exit cleanup. They are not full acceptance
of the maximum-content, maximum-logo or production-performance requirements.

Local 50-line timing was inconsistent: one complete void render succeeded
near the five-second bound and another hit that bound. No timeout was raised
to accommodate it. Synchronous API eligibility (p95 at most 150 ms) remains
unproven and is not authorized by this implementation checkpoint.

## Image packaging

`apps/api/Dockerfile` builds qpdf 12.3.2 from checksum-verified source and
installs the checksum-verified Typst 0.15.1 release. Amiri 1.002 is vendored in
`apps/api/assets/fonts`, with `SHA256SUMS` and its OFL license. Runtime binaries
are in `/usr/local/bin`; fonts are in `/app/assets/fonts`. The package file list
keeps TypeScript sources and native build sources out of the runtime bundle.
The approved Typst artifact is x86-64: the image and native build script reject
other target architectures before downloads or compilation.

The image uses `tini` and `pdf-limit-launcher` before Node, setting inherited
soft and hard core limits to zero. This does not authorize a piped crash
collector: `assertPdfDumpPolicy` still refuses that host policy. No renderer
binding or PDF activation flag is added by packaging.

`docker/tests/pdf-toolchain.mjs` checks the final image without network access
or writable document storage: pinned tools, font hashes and licenses, non-root
execution, core limits, one synthetic PDF, its page count and embedded fonts.
Its font check requires nonempty Type3 glyph programs as well as embedded Amiri
files; missing font objects do not pass. Five negative/positive unit cases cover
the font-check boundary.
