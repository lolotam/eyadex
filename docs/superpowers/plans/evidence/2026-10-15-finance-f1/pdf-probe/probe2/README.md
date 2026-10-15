# Task 8g probe 2 — amounts, logo, isolation, extraction comparison (2026-10-15)

Same environment and Typst 0.15.1 binary as `../README.md`. **Synthetic data only.** Disposable; no 8g code.

## 1. E1–E5 against the approved worked examples [tested]

`probe2.mjs` imports the real `computeInvoiceTotals` and `formatMinor` from
`packages/contracts/src` at `f694a52` (copied into the container with `zod@3.25.76`, the locked version; run
with `node --experimental-transform-types`), computes each example of spec §8b.1 (approved in R2 at `5f28618`),
renders it through Typst on stdin and extracts the PDF text with pdf.js 6.3.289.

| #   | Function (line totals · tax · total, KWD) | Spec §8b.1          | Equal | Every amount in the PDF | PDF total cell |
| --- | ----------------------------------------- | ------------------- | ----- | ----------------------- | -------------- |
| E1  | 0.499, 0.500 · — · 0.999                  | 499, 500 · 0 · 999  | yes   | yes                     | `TOTAL=0.999`  |
| E2  | 0.000, 0.000, 0.001 · — · 0.001           | 0, 0, 1 · 0 · 1     | yes   | yes                     | `TOTAL=0.001`  |
| E3  | 0.000 · — · 0.000                         | 0 · 0 · 0           | yes   | yes                     | `TOTAL=0.000`  |
| E4  | 0.002, 0.004 · 0.001 · 0.007              | 2, 4 · 1 · 7        | yes   | yes                     | `TOTAL=0.007`  |
| E5  | 11.110 · — · 11.110                       | 11110 · 0 · 11110   | yes   | yes                     | `TOTAL=11.110` |

E6 is a rejection (`discount_exceeds_total`), not a document; it is covered by `invoice-totals.spec.ts`.
All renders exit 0.

## 2. Logo transport [tested]

| Logo (synthetic PNG)                  | Transport                                   | Document  | Compile                  | Peak RSS   |
| ------------------------------------- | ------------------------------------------- | --------- | ------------------------ | ---------- |
| 50 424 B gradient (`logo-small.png`)  | byte-array literal in the stdin document    | 179 721 B | 60 ms, exit 0            | —          |
| 1 010 153 B random pixels (≈ 1 MB cap) | byte-array literal in the stdin document    | 3 606 815 B | 673 ms (harness); 0.75–1.22 s (GNU time), exit 0 | **≈ 172 MB** |
| same 1 010 153 B                      | file `/logo.png` under `--root` (logo only) | 2 lines   | 0.24–0.41 s, exit 0      | **≈ 25 MB** |

The small logo renders at the top of the page (`logo-small.png`). A random-pixel image is the worst case; real
logos compress far better. The file path puts **clinic** data (the logo, already in BlobStore) on a private
directory — never patient data, which stays on stdin.

## 3. Language isolation in mixed cells [tested]

`isolation.png`, same content three ways (`invoice2.typ`):

| Variant                                                   | Rendered                                       | pdf.js items                       |
| --------------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| MIX — one RTL paragraph, nothing isolated                 | «October 2026 15», «KWD 15.000» (wrong order)  | `October 2026`, `KWD` split        |
| ISO — each LTR run in `box(text(dir: ltr))`               | «15 October 2026», «15.000 KWD» (correct)      | `15 October 2026`, `15.000 KWD`    |
| CELLS — one language per table cell                       | correct                                        | `Date: 15 October 2026`, `Total: 15.000 KWD` |

## 4. Arabic extraction — is L1 specific to Typst? [tested]

Same words, extracted with pdf.js 6.3.289 and `pdftotext -raw`:

| Renderer + font                                   | علاج | الأسنان | بشرة | استشارة | عيادة | التجريبية | الإجمالي |
| ------------------------------------------------- | ---- | ------- | ---- | ------- | ----- | --------- | -------- |
| Typst 0.15.1 + IBM Plex Sans Arabic (probe 1)     | ✗    | ✗       | ✗    | ✓       | ✓     | ✗         | ✗        |
| Chromium 152.0.7977.82 (Alpine) + IBM Plex Sans Arabic | ✗ | ✗     | ✗    | ✗ (pdf.js: one glyph per item) | ✗ | ✗ | ✗ |
| Typst 0.15.1 + Noto Sans Arabic (variable, sha256 `63111b5b…e869e`) | ✓ (pdf.js) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

pdftotext gives the same reordered forms for Chromium as for Typst («عالج», «األسنان», «برشة», «اإلجمايل»), and
pdf.js returns Chromium's Arabic as individual presentation-form glyphs. **No probed renderer and font meets
the extraction criterion.** Of the three, Typst + IBM Plex Sans Arabic extracts the most words correctly.
Chromium needs 308 MB (`/usr/lib/chromium`); its render time was not measured (busybox `date` has no `%N`).

Not probed: static (non-variable) Noto Naskh Arabic, LuaLaTeX (named in typst/typst#4225 as producing correct
text), and PDF `ActualText` spans (Typst has no documented way to emit them).

## 5. Hygiene

Synthetic data only. The logo comparison and the Noto check wrote synthetic documents to `/dev/shm` or `/tmp`
inside throwaway containers; Chromium needs its HTML as a file. None of this is the production data path.
