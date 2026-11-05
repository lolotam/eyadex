# Synthetic invoice-template run ? 2026-11-05

This is an isolated local result, not production or staging acceptance.

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

The 16 invoice fixtures contain 33 pages in total. MAXCONTENT covers 50 lines with 200-character descriptions and 300-character discount reasons. It contains 8,574 ordered source words.

Negative guards passed for omitted fields, reordered repeated headers, duplicate field instances, original format controls (including Latin-only text), unsupported scripts, and the two known extractor-loss cases. The latter are explicit refusals, not evidence of full input acceptance.

Remaining gates: lossless mixed angle brackets and compatibility Latin ligatures; interactive selection/accessibility; the five-second runtime deadline; process/authorization/deployment/staging acceptance. A focused earlier run of the same MAXCONTENT source took 9,508 ms in Typst alone, also above that deadline.
