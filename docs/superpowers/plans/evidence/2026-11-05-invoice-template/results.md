# Synthetic invoice-template run — 2026-11-05

These are isolated local results, not production or staging acceptance. The first table records the initial f16446d run; the review follow-up below supersedes its changed fixtures.

- `syntheticOnly`: true; `runtimeActivation`: false; `fullInvoiceAcceptance`: false.
- Image ID: `sha256:526cda57f2c8f4f128ed838ce0ad704e8d0c7ec569be387cebb32db8f465e2e2`.
- Full generated `invoice-results.json` SHA256: `05fefe31af8409d3f764056fafb14dac165795b29f1ee305944565f679d847b8`.
- The existing 40-word regression corpus and 24 marked-word documents also passed in the same Docker command.
- Every invoice below passed ordered pdf.js and Poppler extraction, `qpdf --check`, size bounds and exact pixel equality (all pages at 96 DPI; first page again at 144 DPI).
- Timings are individual local Typst measurements under shared-host load, not production p95 or the complete render pipeline.

| Fixture    | Pages | Intermediate bytes | Final bytes | Typst ms |
| ---------- | ----: | -----------------: | ----------: | -------: |
| E1         |     1 |              95691 |       78112 |      190 |
| E2         |     1 |              97899 |       76178 |      181 |
| E3         |     1 |              87920 |       75510 |      187 |
| E4         |     1 |              97622 |       79177 |      204 |
| E5         |     1 |              87592 |       74864 |      159 |
| FIFTY      |     3 |             409426 |      168258 |      895 |
| VOID       |     3 |             418621 |      176210 |      960 |
| MIXED      |     2 |             248851 |      116838 |      625 |
| LONGWORD   |     1 |              89797 |       77367 |      188 |
| BHD        |     1 |              77710 |       67976 |      161 |
| OMR        |     1 |              78121 |       68387 |      155 |
| SAR        |     1 |              77804 |       68085 |      186 |
| AED        |     1 |              77889 |       68156 |      169 |
| QAR        |     1 |              77977 |       68233 |      185 |
| MAXCONTENT |    13 |            4984011 |     2283163 |    23482 |
| INJECTION  |     1 |              86027 |       72114 |      169 |

The initial 16 invoice fixtures contain 33 pages in total. The initial MAXCONTENT Arabic fields included a trailing space, leaving trimmed lengths of 199 and 299; the corrected follow-up below supersedes that fixture result. It contains 8,574 ordered source words.

Negative guards passed for omitted fields, reordered repeated headers, duplicate field instances, original format controls (including Latin-only text), unsupported scripts, and the two known extractor-loss cases. The latter are explicit refusals, not evidence of full input acceptance.

Remaining gates: lossless mixed angle brackets and compatibility Latin ligatures; interactive selection/accessibility; the five-second runtime deadline; process/authorization/deployment/staging acceptance. A focused earlier run of the same MAXCONTENT source took 9,508 ms in Typst alone, also above that deadline.

## Review follow-up

LONGWORD now includes two unbroken 300-character Arabic discount reasons, with and without diacritics. MAXCONTENT asserts trimmed 200/300-character limits for both languages and ends the Arabic fields in visible text. Each emitted ToUnicode destination is asserted to be at most 512 bytes.

Generated follow-up result SHA256: `834a88edeedf623d538efb9fc29e175d98d360f4a8e7d254133594513b1b7f13`. Both fixtures passed ordered extraction in both tools, all-page 96 DPI pixel equality and first-page 144 DPI equality.

| Fixture    | Pages | Intermediate bytes | Final bytes | Typst ms |
| ---------- | ----: | -----------------: | ----------: | -------: |
| LONGWORD   |     1 |              95501 |       80363 |      226 |
| MAXCONTENT |    13 |            4989609 |     2288516 |     9305 |

Regression proof against the previous source: the new ToUnicode bound fails with `ToUnicode destination exceeds 512 bytes`; the trimmed-length assertion fails with `199 !== 200`. Both pass after the fix. Runtime activation and full acceptance remain false.

## Terminology and complete-input validation follow-up

The English patient label is now `Patient`. Format/control characters are rejected on complete
field strings before whitespace splitting. Guards cover Arabic and Latin format controls plus
tab, LF and CR; the tab guard fails against the previous template with `Missing expected exception`.
The changed E1 fixture passes both extractors, qpdf and pixel equality (one page, 95,692 intermediate
bytes, 78,130 final bytes). This targeted run does not replace the earlier complete-run record.

Review also confirmed limitations in unknown/partial glyph matching and subsequence-only extraction
verification. A diagnostic admits an unmapped `bfrange` glyph and another admits `extra expected extra`
for an expected single word. Those checks, the near-limit-logo combination and bilingual header layout
remain follow-ups before full invoice acceptance. Current passing results must not be interpreted as
proof that those adversarial or maximum-logo inputs are supported.

## Source-defined repeated order and page-tree follow-up

The latest complete invoice run passes all 16 fixtures (31 pages). The header now has separate English/Arabic columns. Repeated field order is checked against source-defined sequences in annotations and both extractors; page indexes follow the catalog page tree.

Generated result SHA256: `e89f688aad32a4dcdef6a06597cd9d9c1658cfd909c2fdb398096cb92596bc05`. Every page passed the same extraction, size, qpdf and pixel gates.

| Fixture    | Pages | Intermediate bytes | Final bytes | Typst ms |
| ---------- | ----: | -----------------: | ----------: | -------: |
| E1         |     1 |              95801 |       78123 |      193 |
| E2         |     1 |              97885 |       76009 |      222 |
| E3         |     1 |              88049 |       75416 |      216 |
| E4         |     1 |              97729 |       79071 |      274 |
| E5         |     1 |              87721 |       74789 |      190 |
| FIFTY      |     2 |             407670 |      166989 |     1194 |
| VOID       |     2 |             414590 |      173311 |     1190 |
| MIXED      |     2 |             245496 |      112239 |      608 |
| LONGWORD   |     1 |              95616 |       80266 |      220 |
| BHD        |     1 |              77818 |       67910 |      182 |
| OMR        |     1 |              78232 |       68290 |      217 |
| SAR        |     1 |              77921 |       68012 |      213 |
| AED        |     1 |              78009 |       68069 |      210 |
| QAR        |     1 |              78100 |       68142 |      161 |
| MAXCONTENT |    13 |            4990378 |     2289152 |    10812 |
| INJECTION  |     1 |              86172 |       72085 |      165 |

New mutation guards reject swaps of complete table-header cells and complete footer sections. Reversing indirect-object insertion order leaves expected page contents unchanged. The previous code fails both the header-swap assertion and page-order equality assertion.

The earlier header-layout and object-order follow-ups above are now closed. The documented maximum-logo, unknown/partial glyph, extra-text, Unicode, runtime and deployment limitations remain open.

## CMap block bounds follow-up

CMap bfchar sections now contain at most 100 entries; the Type 3 code and 512-byte destination limits remain separate. The output check verifies declared versus actual block counts. The previous binder fails the new LONGWORD assertion with `bfchar block exceeds 100 entries`. E1 and LONGWORD pass both extractors, qpdf, and pixel equality at 96/144 DPI after the fix. Mutation-guard Typst and qpdf calls now have explicit 60-second and 15-second test timeouts. These are test-harness limits, not production-deadline acceptance. The launch log now uses the latest 31-page total.

## Unknown glyph-code rejection follow-up

For the pinned generated text subset, glyph matching now rejects unknown codes, empty mappings, and malformed or incomplete code strings. Each string is validated separately before aggregation. Guards cover fully unknown and partly mapped runs, split odd-byte strings, malformed delimiters and empty destinations, alongside valid hex and literal strings. The old helper fails the new unknown-code regression. FIFTY and VOID pass both extractors, qpdf and pixel equality on four pages at 96 DPI and their first pages at 144 DPI. Aggregate whole-word drawing correspondence and absence of extra extracted text remain separate open gates.

## Text-operand grammar follow-up

Glyph matching now reads only string operands consumed by supported text-showing operators inside balanced BT/ET bodies. Arrays and the pinned ReversedChars/Span marked-content forms are balanced; ActualText remains metadata. Hex strings remove PDF whitespace only, and CMap keys retain their exact two-byte width. Regressions reject missing show operators, unmatched delimiters, non-PDF whitespace, outside-BT text, and mismatched source-code widths. The previous scanner fails these guards. FIFTY, VOID, MIXED and LONGWORD pass both extractors and pixel checks across seven pages. This remains a pinned-generator subset, not a general PDF validator.

## Complete extracted-text inventory follow-up

Both extractors passed the complete per-page text inventory for all 16 fixtures and 31 pages. The inventory includes word and punctuation multiplicity, source-defined separators, and page counters; existing source-order checks remain active. Mutation guards reject duplicated words, leading and trailing extra text, missing counters, and extra separators. The previous subsequence check accepts the extra-text example that the new inventory rejects.

This closes the extracted-text inventory gap for these fixtures only. It does not close whole-word drawing correspondence: shaped Arabic can contain glyphs without a complete direct ToUnicode mapping. Maximum-content plus maximum-logo coverage, Unicode coverage, production timing, runtime integration and deployment remain open. The renderer remains inactive.

## Separator ordering follow-up

Fixed separators now have their own field IDs and participate in source and repeated-role order validation. The checker no longer infers separator counts from the previous field's page. A generated-PDF regression moves a separator after its following field and verifies rejection by the source-order check. Both extractors pass all 16 fixtures and 31 pages. Whole-word Arabic drawing correspondence remains open; this change does not activate a renderer.

## Independent outline and position validation

The new checker reads glyph IDs, font programs and positioned text operators, without relying on ToUnicode or ActualText to identify drawn letters. It independently shapes each source word using pinned HarfBuzz and bidi data, then compares original Amiri outlines against the embedded outlines, glyph multiplicities and positions. Wrapped words must partition the complete source into consecutive grapheme slices matching every drawn line. All 16 saved raw fixtures passed this standalone check: 11,529 word/counter instances across 31 pages, including diacritics, mixed text, maximum content and long wrapped words.

Local review identified two gaps that are now guarded: embedded unitsPerEm must match the source face, and advancing glyph ink must intersect its word annotation. Nonspacing marks may extend above the annotation, but must retain their independently calculated position relative to the anchored letters. Nine mutations reject missing, duplicated, replaced, individually displaced and misassociated drawings, whole-word displacement, altered font scale, a source character missing from the font, and displacement with erased font advances. This is glyph evidence for the pinned fixture set, not general Unicode or runtime acceptance. The integration run and CI remain separate gates.
