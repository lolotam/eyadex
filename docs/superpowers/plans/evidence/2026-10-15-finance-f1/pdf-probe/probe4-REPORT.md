# PDF probe 4 — widened criterion (40 words), more fonts, features, ActualText, Chromium (2026-10-15)

Disposable probe by the research subagent; synthetic data; offline renders; nothing in the repo touched.
Scripts `work/`, results `out/`, downloads `dl/` (all verified against published digests, `out/downloads.txt`).

## Answer [tested]
No candidate passes all 40 words strictly in both pdf.js 6.3.289 and `pdftotext -raw` (poppler 25.12.0).
Best: 35/40 (Readex Pro, Rubik, Almarai, Changa, El Messiri, Markazi Text, Baloo Bhaijaan 2 — Typst or
Chromium); Amiri 33/40 (but 9/9 on the original check words). «د.ك» fails in pdftotext for every renderer and
font (poppler returns «‫ك‬.‫د‬»).

| Font (Typst 0.15.1) | /40 | check 9 | Failing words |
|---|---|---|---|
| Readex Pro, Rubik, Almarai, Changa, El Messiri, Markazi Text, Baloo Bhaijaan 2 | 35 | 6 | علاج, الأسنان, الإجمالي, الملاحظات (lam-alef); د.ك (pdftotext) |
| Lateef | 34 | 6 | the 4 + أكتوبر, د.ك |
| Amiri | 33 | 9 | pdftotext: الخصم, المجموع, الحساب, تحليل, لمحة, اللجنة, د.ك |
| IBM Plex Sans Arabic | 32 | 5 | علاج, الأسنان, بشرة, الإجمالي, أكتوبر, الملاحظات, الضريبة, د.ك |
| Harmattan | 32 | 6 | lam-alef 4 + أكتوبر, د.ك; pdftotext المراجع, مراجع |
| Scheherazade New | 31 | 6 | lam-alef 4 + فرع, الفرع, أكتوبر, المجموع, د.ك |
| Noto Sans Arabic static 2.013 | 5 | 3 | almost all |
| Mada | 4 | 2 | almost all |
| Reem Kufi | 2 | 0 | all but 2 |

- Optional features off (liga, dlig, calt, kern, mset, ccmp, curs; on Readex Pro and Amiri): no extraction
  change; joining and lam-alef stay correct (checked by eye). `rlig` not touched.
- LuaLaTeX with one /ActualText span per word: 2/40, same as without; poppler reads the spans but returns each
  word reversed.
- Chromium 152.0.7977.82: Amiri 33/40, Readex Pro 35/40 — same misses as Typst; results follow the font.
  Image 1.36 GB, ~0.5–0.7 s, ~205 MB RSS.

## Not tested
Other pdf.js/poppler versions; «د.ك» in an isolated run or another form; reversed-string ActualText; other
variable-font instances; WeasyPrint (broken in round 1).

## Inference (not tested)
Remaining failures come from lam-alef ligatures in sans fonts, Amiri's lam joined to the next letter under
poppler, and poppler's bidi ordering of «د.ك».
