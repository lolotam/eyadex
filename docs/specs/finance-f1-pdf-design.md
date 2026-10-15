# F1 Task 8g — server-rendered invoice PDF (design note for review)

- **Status:** proposal for focused review, 2026-10-15. No code until approved.
- **Contract (unchanged, approved):** `GET /v1/invoices/:id/pdf` — "Bilingual PDF rendered by the API from the
  stored invoice" (`finance-design.md` §3.3, FIN-5, FIN-6). D-P1 (browser print view) is declined by the owner
  (2026-10-15); this note only chooses how the API renders.
- On approval this becomes an ADR (new runtime binary in the API image).

## 1. Requirements the renderer must meet

| #   | Requirement                                                                                                           | Source                |
| --- | --------------------------------------------------------------------------------------------------------------------- | --------------------- |
| R1  | Arabic letters joined correctly (contextual forms, lam-alef) and mixed Arabic/Latin/number runs in Unicode bidi order | FIN-6 bilingual       |
| R2  | One A4 portrait document, both languages, selectable text, fonts embedded                                             | FIN-5, FIN-6          |
| R3  | Header: clinic name ar + en, logo, branch name, address, phone, commercial registration number (when set)             | FIN-6                 |
| R4  | Amounts identical to the stored invoice (no recomputation in the template)                                            | R1-1, §2 shared rules |
| R5  | No patient data in logs, argv, temp files or caches; `Cache-Control: no-store`                                        | CLAUDE.md §8, §5      |
| R6  | Inside the API's 200 ms budget for a request, or moved to the worker (CLAUDE.md §6)                                   | CLAUDE.md §6          |
| R7  | No network fetch at render time (fonts and logo supplied by us)                                                       | supply chain, R5      |

## 2. Options

| Option                                                     | Arabic (R1)                                                                                                                                                                                                                                                                                                                                                               | Footprint                                                                       | Data path (R5)                                                 | Verdict                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| **A. PDFKit** (pure JS)                                    | Fontkit shapes glyphs but does **no bidi reordering**; Arabic comes out joined in reversed order unless a third-party layer (e.g. `bidi-shaper`) reorders and shapes in one pass and disables fontkit's own features ([adapter notes](https://app.unpkg.com/bidi-shaper@0.1.2/files/dist/adapters/pdfkit.d.ts)). That layer's maintenance and correctness are unverified. | npm only                                                                        | in-process                                                     | Rejected: R1 rests on an unvetted adapter |
| **B. Typst CLI** (Rust, static binary)                     | Native: text `dir: rtl`, `lang`, and "the bidirectional reordering algorithm" ([Typst text docs](https://typst.app/docs/reference/text/text/)); shaping is HarfBuzz-class (rustybuzz).                                                                                                                                                                                    | one pinned static binary in the API image                                       | child process; data on stdin, PDF on stdout (to be proven, §5) | **Recommended**                           |
| **C. Headless Chromium** (Gotenberg service or Playwright) | Full browser shaping and bidi ([Gotenberg](https://computingforgeeks.com/gotenberg-html-to-pdf-api/); Chrome-based renderers handle joining and mixed order, e.g. [Printly](https://packagist.org/packages/g4t/printly))                                                                                                                                                  | a Chromium image (hundreds of MB) or a new Dokploy service on `dokploy-network` | patient data over the internal network to another container    | Fallback if B fails §5                    |

## 3. Proposed design (option B)

### 3.1 Process

1. Use case (`billing/use-cases/render-invoice-pdf.ts`): guard `view:invoices:*` (with `own` reach), load the
   invoice, lines, clinic header, branch, patient display name inside `withTenant`; write the
   `patient_access` audit row (Task 8j). Close the transaction **before** rendering.
2. Build a **whitelisted** `InvoicePdfModel` (no ids except the invoice number; patient = display name only — no
   civil ID, phone or email). Every string is formatted in TypeScript first: amounts with `formatMinor`, dates
   with `Intl.DateTimeFormat("ar-KW" | "en-GB", { timeZone: clinic.timezone })` exactly as the prescription
   print view does (`prescription-print-view.tsx:17`). The template only lays out strings (R4).
3. Port `InvoicePdfRenderer.render(model): Promise<Uint8Array>`; adapter `TypstInvoicePdfRenderer`:
   `spawn(typstPath, ["compile", "--format", "pdf", "--ignore-system-fonts", "--font-path", fontsDir, "-", "-"])`
   with `stdin` = the main document (template import + the model as one escaped JSON string literal) and
   `stdout` = the PDF. No argv data, no temp file, an empty `env` (the binary is called by absolute path), `cwd` = the read-only
   template directory.
4. Limits: a semaphore of **2** concurrent renders per API process (excess waits ≤ 2 s, then 503
   `pdf_busy`, a new `RULE_ONLY` code); a **5 s** kill timeout; stdout capped at 5 MB; a non-zero exit is logged
   as `pdf_render_failed` with the exit code only (never stderr, which can echo content).
5. Response: `200`, `Content-Type: application/pdf`, `Content-Disposition: inline; filename="<number>.pdf"`,
   `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.

### 3.2 Fonts

- **IBM Plex Sans Arabic** + **IBM Plex Sans** (weights 400/600), the fonts the web app already loads
  (`apps/web/src/routes/__root.tsx:105`), so the PDF matches the screen. Licence SIL OFL 1.1 (bundling allowed).
- Vendored TTFs in `apps/api/assets/fonts/` with `OFL.txt` and a `SHA256SUMS` file checked in CI; the image
  never downloads fonts at runtime (R7). `--ignore-system-fonts` makes the result identical on every machine.
- Digits and date words come from `Intl` (step 2), so they match the web for the same locale.

### 3.3 A4 layout

- Page 210 × 297 mm, margins 15 mm, body 10 pt, table 9 pt. One document, bilingual labels side by side
  (Arabic block right-aligned `dir: rtl`, English block left-aligned) — the layout bilingual Gulf invoices use.
- **Header (FIN-6):** logo top-start (≤ 40 × 20 mm, PNG/JPEG from BlobStore, passed as bytes on stdin — never a
  path), clinic name ar / en, branch name, address, phone, CR number when set.
- **Invoice block:** number, issue date (clinic timezone), status; patient display name.
- **Lines table** (header row repeats on every page): # · description ar / en · qty · unit price · discount
  (with reason) · line total. 50 lines max (contract) ⇒ at most 3 pages.
- **Totals:** subtotal, discounts, tax line only when `taxMinor > 0`, total with the currency code.
- **Void:** a full-width banner «فاتورة ملغاة / VOID INVOICE» with reason and date on every page.
- **Footer:** page `n / N`, "version v" of the invoice.

## 4. Where it runs (R6)

Render synchronously in the API **only if** the spike (§5) shows p95 ≤ 150 ms for a 50-line invoice on the
production host class. Otherwise the alternative is: the worker renders on each issue/edit/void (outbox event
with `{invoiceId, version}`), stores `invoices/<clinic>/<invoice>/v<version>.pdf` through the shared BlobStore,
and the endpoint streams the stored object (`409 pdf_pending` while the current version is not rendered yet).
The decision is made by the spike, not assumed.

## 5. Spike before approval of the code (throwaway branch, results attached to the ADR)

1. `typst compile - -` reads the main document from **stdin** (documented for stdout; stdin for `compile` is not
   yet confirmed — if absent, fall back to a `memfd`/tmpfs file owned 0600 and deleted, and record it).
2. The pinned release (≥ 2 weeks old, sha256 verified) runs on `node:24-alpine` (musl static build).
3. Arabic checks in the output, read back with `pdfjs-dist` text extraction and by eye: joining forms, lam-alef,
   a mixed line («استشارة Consultation 15.000 د.ك»), parentheses mirroring, Arabic-Indic vs Latin digits as
   `Intl` produced them.
4. Timing: p50/p95 for 1, 20 and 50 lines, cold and warm; peak RSS.
5. Amounts in the PDF equal `computeInvoiceTotals` for examples E1–E5.

## 6. Tests that ship with 8g

- Unit: `InvoicePdfModel` builder (whitelist, formatting, tax line hidden at 0, void banner).
- Adapter: renders the E1–E5 models; text extraction contains every line description and the exact totals; a
  model with the patient name never appears in captured logs.
- API db spec: `own` reach, `view` permission, module off ⇒ `module_disabled`, audit row written, headers
  (`no-store`), void invoice still renders with the banner.

## 7. Decisions requested

1. Option B (Typst) with C as the fallback.
2. The spike in §5 as the gate for writing 8g code.
3. Fonts: IBM Plex Sans Arabic + IBM Plex Sans, vendored with checksums.
4. A new `RULE_ONLY` error `pdf_busy` (503) — and `pdf_pending` (409) only if §4 moves rendering to the worker.
