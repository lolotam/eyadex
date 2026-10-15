# PDF probe 3 — Arabic text extraction: static fonts, LuaLaTeX, WeasyPrint (2026-10-15)

Disposable probe run by a research subagent; synthetic data only; nothing in the repo changed. Scripts: `work/`;
outputs: `out/`; downloads: `dl/`. Saved verbatim from the subagent's hand-back (its own Write was refused).

## Answer
No tested option meets the criterion as written (every Arabic and English word in logical order in BOTH pdf.js
6.3.289 and `pdftotext -raw`, poppler 25.12.0).

- Typst 0.15.1 + Amiri 1.002 (static): 9/9 check words strict in both extractors, in the 5-line doc and in
  probe 1's 50-line invoice (Regular + Bold). pdf.js extracts every Arabic word tested correctly. pdftotext
  breaks words with Amiri's lam + following-letter ligatures: «الخصم»→«خصم|ل|ا», «تحليل»→«حليل|ت»,
  «المجموع», «الحساب», «لمحة», «اللجنة». Turning calt/liga/clig/dlig off changed nothing.
- Other Typst fonts: Tajawal 6/9, IBM Plex 5/9, Cairo 5/9, Noto Naskh 3/9 (static = variable), Noto Kufi 2/9.
- LuaLaTeX (Debian trixie, LuaHBTeX 1.18.0, luaotfload v3.29; HarfBuzz and Node; Plex and Amiri): 2/9 —
  renders correctly, extracts one item per glyph (presentation forms with Amiri). Image 552 MB; warm 0.7–1.1 s.
- WeasyPrint 62.3: 0/9 — broken ToUnicode CMap. Image 627 MB.
- Typst has no ActualText switch; its backend emits ActualText automatically (25 spans in the Noto Naskh PDF,
  0 in Plex/Amiri). typst/typst#4225 still open (updated 2026-09-26).

## Facts to weigh
- Word order inside an RTL line is visual (reversed) in every Typst PDF for both extractors; letters inside
  each word are in order.
- The English checks pass because LTR runs are isolated.
- The Amiri PDF embeds only Amiri: Latin text and digits use Amiri's Latin glyphs, not IBM Plex.

## Cost (Typst + Amiri, dev host i7-8700, Docker Desktop)
50-line invoice: cold 76.5 ms, warm p50 74.4 ms, p95 81.9 ms, peak RSS ~33 MB. Amiri Regular + Bold 844 596 B.
Offline.

## Pinned downloads (verified)
- Amiri-Regular.ttf 431 116 B sha256 ab391c4147d054c48976e98322ad0eefe1427aa0e0502a12a4c75d80a70cfcd7
  (google/fonts blob 14dfa0d6…, upstream aliftype/amiri 04d40ee6…, release 1.002, OFL 1.1)
- Amiri-Bold.ttf 413 480 B sha256 cfccb794268e7d573d857e6d6a67f89cf8a053e8ffd85dfa0c8ec1bb36fc4827
- Others (Tajawal, Noto Naskh static 2.021 and variable, Noto Kufi, Cairo) listed with checksums in the
  subagent hand-back.

## Not proven
Other Amiri ligature sequences; other viewers (Acrobat, PDFium, Preview) and screen readers; other LuaLaTeX
setups (accsupp ActualText, luabidi); a newer WeasyPrint; Chromium with Amiri; production-host timing.
