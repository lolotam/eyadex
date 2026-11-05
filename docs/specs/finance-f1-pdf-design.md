# F1 Task 8g — server-rendered invoice PDF (design note for review)

- **Status:** implementation approved by the owner on 2026-11-03 (§7 item 8), following the feasibility
  probes (`docs/superpowers/plans/evidence/2026-10-15-finance-f1/pdf-probe/README.md`). Reproducible
  extraction/rendering proof and the staging runtime measurement remain release gates.
- **Contract (unchanged, approved):** `GET /v1/invoices/:id/pdf` — "Bilingual PDF rendered by the API from the
  stored invoice" (`finance-design.md` §3.3, FIN-5, FIN-6). D-P1 (browser print view) is declined by the owner
  (2026-10-15); this note only chooses how the API renders.
- Decision record: [ADR-0037](../adr/0037-bilingual-server-pdf.md), recorded before implementation of
  the production renderer. Staging measurement still decides API versus worker placement.

## 1. Requirements the renderer must meet

| #   | Requirement                                                                                                                                                           | Source                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| R1  | Arabic letters joined correctly (contextual forms, lam-alef) and mixed Arabic/Latin/number runs in Unicode bidi order                                                 | FIN-6 bilingual       |
| R2  | One A4 portrait document, both languages, fonts embedded; **every Arabic and English word extracts in logical order** (pdf.js and pdftotext) — **not met yet, §5 L1** | FIN-5, FIN-6          |
| R3  | Header: clinic name ar + en, logo, branch name, address, phone, commercial registration number (when set)                                                             | FIN-6                 |
| R4  | Amounts identical to the stored invoice (no recomputation in the template)                                                                                            | R1-1, §2 shared rules |
| R5  | No patient data in logs, argv, temp files or caches; `Cache-Control: no-store`                                                                                        | CLAUDE.md §8, §5      |
| R6  | Inside the API's 200 ms budget for a request, or moved to the worker (CLAUDE.md §6)                                                                                   | CLAUDE.md §6          |
| R7  | No network fetch at render time (fonts and logo supplied by us)                                                                                                       | supply chain, R5      |

## 2. Options

| Option                                                     | Arabic (R1)                                                                                                                                                                                                                                                                                                                                                               | Footprint                                                                       | Data path (R5)                                               | Verdict                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| **A. PDFKit** (pure JS)                                    | Fontkit shapes glyphs but does **no bidi reordering**; Arabic comes out joined in reversed order unless a third-party layer (e.g. `bidi-shaper`) reorders and shapes in one pass and disables fontkit's own features ([adapter notes](https://app.unpkg.com/bidi-shaper@0.1.2/files/dist/adapters/pdfkit.d.ts)). That layer's maintenance and correctness are unverified. | npm only                                                                        | in-process                                                   | Rejected: R1 rests on an unvetted adapter     |
| **B. Typst CLI** (Rust, static binary)                     | Native: text `dir: rtl`, `lang`, and "the bidirectional reordering algorithm" ([Typst text docs](https://typst.app/docs/reference/text/text/)); shaping is HarfBuzz-class (rustybuzz).                                                                                                                                                                                    | one pinned static binary in the API image                                       | child process; data on stdin, PDF on stdout (**tested**, §5) | **Recommended**                               |
| **C. Headless Chromium** (Gotenberg service or Playwright) | Full browser shaping and bidi ([Gotenberg](https://computingforgeeks.com/gotenberg-html-to-pdf-api/); Chrome-based renderers handle joining and mixed order, e.g. [Printly](https://packagist.org/packages/g4t/printly))                                                                                                                                                  | a Chromium image (hundreds of MB) or a new Dokploy service on `dokploy-network` | patient data over the internal network to another container  | Fallback; **fails R2 extraction too** (§5 L1) |

## 3. Proposed design (option B)

### 3.1 Process

1. Use case (`billing/use-cases/invoice-pdf/invoice-pdf.ts`): guard `view:invoices:*` (with `own` reach), load
   the invoice, lines, clinic header, branch and patient display name inside `withTenant`. Close the
   transaction **before** rendering. The audit row is written only after the final PDF exists; the public
   link also retains its post-render revocation/void checks. After rendering, reload the invoice under
   `FOR SHARE` inside `withTenant`. On the public path, lock the original `invoice_links` row `FOR SHARE`
   after the invoice (the existing invoice-before-link order), and validate its id, token hash,
   clinic/invoice binding, non-revoked state and expiry against a fresh injected-clock read in this
   same transaction. Compare the invoice version/status with the rendered snapshot and keep the
   locks through the audit insert. A missing/revoked/expired/mismatched public link or void invoice
   returns `invoice_link_expired` first; only an otherwise valid public link with a changed version
   returns the existing `version_conflict` (412). Authenticated version changes also discard the bytes
   with `version_conflict`; neither refusal writes an open audit row. An authenticated void invoice
   is deliverable only when that same void version was rendered with its banner. An earlier live-link
   lookup is routing only. The final check/audit transaction is the delivery decision point; no
   database lock spans rendering or network transmission.
2. Build a **whitelisted** `InvoicePdfModel` (no ids except the invoice number; patient = display name only — no
   civil ID, phone or email). Every string is formatted in TypeScript first: amounts with `formatMinor`, dates
   with `Intl.DateTimeFormat("ar-KW" | "en-GB", { timeZone: clinic.timezone })` exactly as the prescription
   print view does (`prescription-print-view.tsx:17`). Arabic currency names are written in full: KWD is
   «دينار كويتي», never «د.ك» in the PDF (§7 item 7); the English block retains `KWD`. The template only
   lays out strings (R4).
3. Port `InvoicePdfRenderer.render(model): Promise<Uint8Array>`; adapter `TypstInvoicePdfRenderer`:
   `spawn(typstPath, ["compile", "--format", "pdf", "--ignore-system-fonts", "--font-path", fontsDir, "--root",
emptyDir, "-", "-"])` (the exact form the probe ran)
   with `stdin` = the main document (template import + the model as one escaped JSON string literal) and
   `stdout` = the PDF. No argv data, no temp file, an empty `env` (the binary is called by absolute path), `cwd` = `/`. The adapter ignores a stdin `EPIPE` and
   reports the child's exit (a child that dies before reading its input must fail the request, not crash the API —
   seen in the probe). This Typst stdout is an intermediate PDF, never the response.
4. Required **qpdf 12.3.2 post-render pass**: a separate killable helper reads the intermediate PDF
   through libqpdf's memory API over stdin, applies the §7 item 7 `/ActualText` correction to
   Arabic-letters-only runs (reversed code points), and serializes the final PDF in memory to stdout.
   Native qpdf work never blocks the API event loop. No input PDF, decoded JSON or patient text may be written to a
   temporary file; the qpdf CLI's seekable-file requirement is not permission to spill to disk. The
   in-memory bridge and correction need reproducible extraction and rendering proof before release.
   A failed parse, unsupported content, correction failure or serialization warning fails the render;
   it never falls back to returning the uncorrected Typst PDF. At runtime, final output must be a valid
   PDF within the size limit and preserve the page count. Page-image equivalence and the pinned
   pdf.js/pdftotext R2 assertions run in the §6 adapter tests in CI, not on each request; the extractors
   are not runtime dependencies.
5. Limits cover the **whole Typst plus qpdf pipeline**: a semaphore of **2** concurrent renders per API
   process (excess waits ≤ 2 s, then 503 `pdf_busy`, a `RULE_ONLY` code); a **5 s** total kill timeout;
   intermediate/final PDFs capped at 5 MB each and any decoded JSON representation capped at 32 MB.
   Limit or process failure terminates and reaps the remaining children before releasing the semaphore. A non-zero
   child exit is logged as `pdf_render_failed` with its exit code only; stderr, exception text and
   document buffers are never logged. Partial output is never delivered or cached.
   Patient-bearing parent and child processes must have core dumping disabled: inherited soft/hard
   `RLIMIT_CORE=0`, plus verified effective container/host crash-capture settings. A piped host
   `core_pattern` can bypass the size limit, so the deployment gate must also prove that no collector
   persists their memory; the native helper disables dumpability before accepting input. Unverified
   dump protection prevents enabling the renderer. Forced-crash checks use synthetic markers only.
6. Response: only the corrected PDF, `200`, `Content-Type: application/pdf`, `Content-Disposition: inline; filename="<number>.pdf"`,
   `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.

### 3.2 Fonts

- **Amiri 1.002** only (Regular 400, Bold 700), including its Latin glyphs for the English text. This
  supersedes the original IBM Plex Sans Arabic proposal (§7 items 7–8); the web font is unchanged.
  Licence SIL OFL 1.1 (bundling allowed). The approved files are `Amiri-Regular.ttf` (431,116 bytes,
  sha256 `ab391c4147d054c48976e98322ad0eefe1427aa0e0502a12a4c75d80a70cfcd7`) and `Amiri-Bold.ttf`
  (413,480 bytes, sha256 `cfccb794268e7d573d857e6d6a67f89cf8a053e8ffd85dfa0c8ec1bb36fc4827`),
  recorded in `docs/superpowers/plans/evidence/2026-10-15-finance-f1/pdf-probe/probe3-REPORT.md`.
- Vendored TTFs in `apps/api/assets/fonts/` with `OFL.txt` and a `SHA256SUMS` file checked in CI; the image
  never downloads fonts at runtime (R7). `--ignore-system-fonts` makes the result identical on every machine.
- Digits and date words come from `Intl` (step 2), so they match the web for the same locale.

### 3.3 A4 layout

- Page 210 × 297 mm, margins 15 mm, body 10 pt, table 9 pt. One document, bilingual labels side by side
  (Arabic block right-aligned `dir: rtl`, English block left-aligned) — the layout bilingual Gulf invoices use.
- **One language per paragraph or cell, or explicit isolation.** A mixed RTL paragraph reorders per the Unicode
  bidi algorithm («15 October 2026» → «October 2026 15»). Tested fixes (probe 2 §3): one language per table
  cell, or each LTR run wrapped in `box(text(dir: ltr))` — both render and extract «15 October 2026» and
  «15.000 KWD» intact.
- **Header (FIN-6):** logo top-start (≤ 40 × 20 mm, PNG/JPEG from BlobStore; transport per decision L2, §7),
  clinic name ar / en, branch name, address, phone, CR number when set.
- **Invoice block:** number, issue date (clinic timezone), status; patient display name.
- **Lines table** (header row repeats on every page): # · description ar / en · qty · unit price · discount
  (with reason) · line total. The contract allows at most 50 lines; the document may use as many
  pages as their complete descriptions and discount reasons need. Repeat the table header and
  page numbering without omitting text or shrinking below the specified font sizes (owner
  decision §7 item 9). The existing 5 MB output bound still applies.
- **Totals:** subtotal, discounts, tax line only when `taxMinor > 0`, total with the currency code.
- **Void:** a full-width banner «فاتورة ملغاة / VOID INVOICE» with reason and date on every page.
- **Footer:** page `n / N`, "version v" of the invoice.

## 4. Where it runs (R6)

Render synchronously in the API **only if** the complete Typst plus qpdf pipeline's p95 ≤ 150 ms for a
50-line invoice on the production host class.
The probe measured **84.2 ms** p95 (77.6 ms cold) and **≈ 32 MB** peak RSS per compile on a developer host
(i7-8700, Docker Desktop); the staging re-measure decides. Otherwise the alternative is: the worker renders on each issue/edit/void (outbox event
with `{invoiceId, version}`), stores `invoices/<clinic>/<invoice>/v<version>.pdf` through the shared BlobStore,
and the endpoint streams the stored object (`409 pdf_pending` while the current version is not rendered yet).
The decision is made by measurement, not assumed.

## 5. Probe results (`docs/superpowers/plans/evidence/2026-10-15-finance-f1/pdf-probe/README.md`)

| Check                                             | Result                                                                                                                                                    | Tag      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Exact release                                     | Typst **0.15.1** (2026-07-17), `typst-x86_64-unknown-linux-musl.tar.xz` sha256 `a6d077d0…3118c` matches GitHub                                            | tested   |
| Alpine                                            | `node:24-alpine` (Alpine 3.24.2, x86_64): `typst 0.15.1 (9dfd3a08)`, exit 0                                                                               | tested   |
| stdin → stdout                                    | `typst compile … - -` with the document on stdin and the PDF on stdout: exit 0, `%PDF-`, no argv data                                                     | tested   |
| Offline                                           | compiles with `--network none` and a read-only root                                                                                                       | tested   |
| Arabic joining, lam-alef, bracket mirroring       | correct on the rendered page                                                                                                                              | observed |
| Template injection through data                   | an injected `#panic(...)` string rendered as text                                                                                                         | tested   |
| A4, pages, repeated header, embedded subset fonts | 3 pages of 595.276 × 841.89 pt, header on every page, fonts embedded + subset + Unicode maps                                                              | tested   |
| Timing / memory (dev host)                        | 50 lines p95 84.2 ms; RSS ≈ 32 MB                                                                                                                         | tested   |
| Amounts equal `computeInvoiceTotals` for E1–E5    | equal to spec §8b.1 for all five; every amount present in the PDF (`docs/superpowers/plans/evidence/2026-10-15-finance-f1/pdf-probe/probe2/README.md` §1) | tested   |
| Mixed-direction isolation                         | one-language cells or `box(text(dir: ltr))` render and extract correctly (probe 2 §3)                                                                     | tested   |
| Logo, 50 KB PNG as byte array on stdin            | 60 ms, exit 0, renders (probe 2 §2)                                                                                                                       | tested   |
| Logo, ≈ 1 MB PNG                                  | byte array: 0.75–1.22 s, ≈ 172 MB RSS · file under `--root`: 0.24–0.41 s, ≈ 25 MB (probe 2 §2)                                                            | tested   |

**Limitations found:**

- **L1 — copy/search of some Arabic words is wrong.** Words with a ligature or mark cluster extract with
  characters reordered in both pdf.js 6.3.289 and pdftotext («علاج» → «عالج», «الأسنان» → «األسنان», «بشرة» →
  «برشة», «التجريبية» split); words without them («استشارة», «عيادة») extract correctly. Turning optional
  ligatures off did not help. It matches open upstream issue typst/typst#4225. The printed and on-screen invoice is
  correct. **Probe 2 §4: Chromium 152 with the same font fails the same words (and pdf.js returns its Arabic as
  single glyphs); Typst with Noto Sans Arabic (variable) fails more words.** No probed renderer and font meets
  R2's extraction criterion. Not probed: a static Noto Naskh Arabic, LuaLaTeX, PDF `ActualText`.
- **L2 — logo transport (measured).** A byte-array literal works but costs ≈ 172 MB and ~1 s at the 1 MB cap; a
  logo file under a private `--root` costs ≈ 25 MB and 0.24–0.41 s. Patient data stays on stdin either way.

## 6. Tests that ship with 8g

- Unit: `InvoicePdfModel` builder (whitelist, formatting, tax line hidden at 0, void banner).
- Adapter: renders the E1–E5 models; **text extraction (pdf.js) contains every Arabic and English line
  description in logical order**, the invoice number and the exact totals (R2 — this test fails today, L1); a
  model with the patient name never appears in captured logs; a child that exits before reading stdin fails the
  request.
- Extraction CI: pin **pdf.js 6.3.289** and **poppler 25.12.0**. Independently assert every expected
  textual field in representative models using both pdf.js and `pdftotext -raw`: both-language clinic
  and branch headers, address/phone/registration text, labels, synthetic patient names, dates,
  descriptions, quantities/prices/stored amounts, discount and void reasons, the void banner,
  currency names, page numbers, version and footer text. Expected manifests come from all visible
  model/template text; no Arabic field may be silently excluded or normalized to conceal reordered
  letters. Include the explicitly versioned replacement corpus in
  `docs/superpowers/plans/evidence/2026-11-04-pdf-corpus.json` and every supported full currency name.
  Its 40 entries are a reconstructed regression set, not the recovered probe 5 list or evidence of
  a passing run. «د.ك» is forbidden in the rendered PDF and is never a positive extraction assertion;
  its replacement «دينار كويتي» must extract as a complete logical phrase. A pass in one extractor
  cannot compensate for a failure in the other; dependency changes rerun both.
- Rendering CI: rasterize every page before and after the qpdf correction using the same pinned
  poppler renderer, fonts, resolution and color settings. Assert equal page counts/dimensions and
  decoded pixel arrays (not PNG metadata or PDF bytes). A changed pixel fails the correction gate.
- Process safety: run stalled-child cases independently for Typst and the qpdf helper. Each must hit
  the shared total deadline, terminate/reap every started child, and permit a subsequent render to
  acquire released capacity. Also test a slow Typst followed by a slow helper to prove the deadline
  is not reset per stage. Test non-zero exits, malformed output, size limits and `EPIPE`; no
  partial/raw fallback PDF or document text in captured logs. In disposable processes with synthetic
  marker data only, independently force crashes of the qpdf helper, Typst and the Node parent (API,
  and worker when selected). For each process, verify no core/crash artifact in the container or
  configured host capture target; a helper-only pass does not establish protection for the others.
  Record effective limits and host `core_pattern`/collector behavior for every process role under
  deployment-equivalent settings. Live staging/production services are never deliberately crashed:
  their effective settings are checked read-only and matched to the isolated crash evidence. Missing
  evidence, a persisting collector or a policy mismatch keeps renderer enablement blocked.
- API db spec: `own` reach, `view` permission, module off ⇒ `module_disabled`, audit row written, headers
  (`no-store`), void invoice still renders with the banner; an edit committed during rendering rejects
  the stale bytes with `version_conflict` and writes no open audit row on both authenticated and public
  paths; public revocation/void keeps `invoice_link_expired`.
- Public-link concurrency: revoke/rotate the original link after its preliminary routing lookup but
  before the final transaction; expiry at the fresh final clock boundary, or a simultaneous void and
  version change, returns `invoice_link_expired`, no bytes and no open audit row. Prove serialization
  when a revoker races the final locked check, using the established invoice-before-link lock order.
  A valid unrevoked link with only an invoice edit returns `version_conflict`.
- Public-link binding regressions: independently test a missing original row and id, token-hash,
  clinic and invoice-binding mismatches between preliminary routing and the final locked read.
  Every case returns `invoice_link_expired`, no document bytes and no open audit row. Use valid
  synthetic fixture rows or the routing/read seam; database constraints and forced RLS remain
  enabled. Cross-clinic final reads remain invisible rather than resolving a foreign link.

## 7. Owner decisions (decisions page batch 14, 2026-10-15)

1. Renderer: Typst **0.15.1**, x86_64 musl (production `musalam-2` is `x86_64`) — approved (F1-PDF-LIB).
   Chromium is not an extraction fallback (probe 2 §4).
2. **L1 — (a) approved:** the R2 extraction criterion stays as written, and a further bounded search (static
   Noto Naskh Arabic, other Arabic fonts, LuaLaTeX, `ActualText`) runs **before** any 8g code and reports to the
   owner. This historical search hold led to the probe 3–5 results and owner choice recorded in item 7;
   item 8 confirms the remaining dependencies. Reproducing the chosen solution is still required.
3. Original fonts decision: IBM Plex Sans Arabic (Regular, SemiBold) — superseded by Amiri in items 7–8.
4. **L2 — (a) approved:** the logo is a file under a private per-render `--root` (1 MB cap kept; ≈ 25 MB).
5. **Where it runs — approved:** measure p95 on staging first; ≤ 150 ms ⇒ in the API, else the worker path of §4.
6. **Approved (F1-PDF-BUSY):** a new `RULE_ONLY` error `pdf_busy` (503, `Retry-After: 2`) — and `pdf_pending` (409) only if §4 moves rendering to the worker.
7. **L1 result (probe 5, 2026-10-15) and the owner's choice ("ok do" on option 1, 2026-10-15):** no renderer or
   font meets all 40 words in both extractors while the currency is written «د.ك» (poppler splits it around the
   period in every form). Best: Typst 0.15.1 + **Amiri** + a post-render pass (qpdf 12.3.2) that wraps each
   Arabic-letters-only run in `/ActualText` with its code points stored reversed — pdf.js 40/40, pdftotext
   39/40, pages pixel-identical (scratchpad `pdf-probe5/REPORT.md`). Option 1 chosen: the invoice prints the
   currency as «دينار كويتي» (the KWD word; other currencies get their full Arabic name) instead of «د.ك», and
   the R2 criterion stays as written. Consequences to confirm before 8g code: the invoice's Arabic font becomes
   Amiri (replacing item 3's IBM Plex Sans Arabic, which reached 32/40), the image gains qpdf (~1.8 MB), and CI
   pins the pdf.js and poppler versions, since the pass relies on pdf.js ignoring `ActualText` and poppler
   reversing it.
8. **Owner confirmation (2026-11-03):** Amiri, adding qpdf to the runtime image, and pinning both text
   extractors in CI are approved. Implementation of that chosen solution may proceed: item 2's
   alternative-search stage is recorded by the results and choice in item 7, not waived or counted as
   a fresh passing test. The R2 extraction criterion, no patient data in argv/logs/temp files, and the
   staging p95 decision remain unchanged. Reproducing the selected post-render solution is a gate
   before wiring it into the production renderer; the old probe is not a substitute for that proof.
9. **Owner page-count decision (2026-11-05):** allow additional pages when the complete permitted
   descriptions and discount reasons require them, with repeated table headers and page numbers.
   Do not remove text or shrink it below the approved sizes to retain the former three-page target.
   This changes the page-count constraint only; it does not waive extraction, security, size,
   timing, staging or deployment gates.
