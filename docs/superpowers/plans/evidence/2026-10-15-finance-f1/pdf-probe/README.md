# Task 8g feasibility probe — Typst on Alpine (2026-10-15)

Disposable probe for `docs/specs/finance-f1-pdf-design.md` §5. **Synthetic data only** (fictional clinic, branch
and an injection string as the patient name). No production code, no 8g implementation. The scripts in this
folder are the exact ones run; they are evidence, not code to ship.

Tags: **[tested]** ran here, output quoted · **[observed]** seen in an artefact · **[upstream]** third-party report.

## 1. Release pinned

| Item                  | Value                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Release               | Typst **v0.15.1**, published 2026-07-17T11:12:06Z (`gh api repos/typst/typst/releases/tags/v0.15.1`)                              |
| Asset                 | `typst-x86_64-unknown-linux-musl.tar.xz`, 17 462 992 bytes                                                                        |
| Asset sha256 (GitHub) | `a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c`                                                                |
| Downloaded sha256     | `a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c` — **match** [tested]                                           |
| Unpacked binary       | `typst`, 55 739 488 bytes, sha256 `29273eaa04f6d00edd0c2bec578f565fc9c65be856bfbffc894567c68ed0b237`                              |
| `typst --version`     | `typst 0.15.1 (9dfd3a08)`, exit 0 [tested]                                                                                        |
| Other assets          | `typst-aarch64-unknown-linux-musl.tar.xz` sha256 `5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee` (ARM servers) |

Fonts (from `google/fonts` `main`, OFL 1.1):

| File                                    | Bytes   | sha256                                                                                                   |
| --------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `IBMPlexSansArabic-Regular.ttf`         | 235 924 | `6f611412270a132bbac838da9259d4c68569b4175f3b3b8fa3fa36a30b56dab9`                                       |
| `IBMPlexSansArabic-SemiBold.ttf`        | 244 616 | `597bd5502e5997be4414e4c9c88834b30ff3784250c84f20bce2b20e53ebd467`                                       |
| `OFL.txt` (ibmplexsansarabic)           | 4 456   | `7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da`                                       |
| `IBMPlexSans[wdth,wght].ttf` (variable) | 537 244 | `3b031aa4216174205bd8471f88a49b91f093169e9e87bd5262242bc5967fe2e3` — **not used by the output** (see §4) |

## 2. Environment

`node:24-alpine` (image digest `sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f`):
Alpine 3.24.2, x86_64, Node v24.22.0. Host: Docker Desktop 29.8.2 on WSL2 (kernel 6.18.54.1), Intel i7-8700
@ 3.20 GHz, 8 CPUs, 16 GB. **Not** the production host class (§6).

## 3. Commands and exits

Run 1 — offline, read-only root, everything mounted read-only except `/out` [tested]:

```sh
docker run --rm --network none --read-only --tmpfs /tmp:size=1m \
  -v .../typst-x86_64-unknown-linux-musl:/opt/typst:ro -v .../fonts:/fonts:ro -v .../work:/work:ro \
  -v .../root:/probe-root:ro -v .../out:/out node:24-alpine \
  sh -c 'cat /etc/alpine-release; uname -m; node --version; /opt/typst/typst --version; node /work/probe.mjs /opt/typst/typst /fonts /out'
```

The harness (`probe.mjs`) spawns, per compile:
`typst compile --format <pdf|png> --ignore-system-fonts --font-path <fonts> --root /probe-root - -`
with `env: {}`, `cwd: "/"`, the document on **stdin** and the output read from **stdout**. The model travels
inside the document as one Typst string literal (`doc.mjs`, escaping `\`, `"` and control characters); the
argv carries no data (`argvHasData: false`). Results: every compile exit 0, stderr 0 bytes, output starts with
`%PDF-`; PNG exit 0 (86 741 bytes).

Run 2 — PDF inspection and timing (`measure.sh`; network only for `apk add poppler-utils time`) [tested]:

```text
pdfinfo:  Pages: 3 · Page size: 595.276 x 841.89 pts (A4) · PDF version: 1.7
pdffonts: IBMPlexSansArabic-SemiBold  CID TrueType  Identity-H  emb yes  sub yes  uni yes
          IBMPlexSansArabic-Regular   CID TrueType  Identity-H  emb yes  sub yes  uni yes
header row ("Description") found on page 1: 1, page 2: 1, page 3: 1
```

A first timing attempt failed with `EPIPE` because `/probe-root` did not exist in that container: Typst exited
before reading stdin. The harness now ignores the stdin error and reports the child's exit — the production
adapter must do the same (fail the request with `pdf_render_failed`, never crash the API).

## 4. Results

**Timing** (binary and fonts on tmpfs; 12 runs per size, warm = runs 2–12) [tested]:

| Lines | Cold ms | Warm p50 ms | Warm p95 ms | PDF bytes |
| ----- | ------- | ----------- | ----------- | --------- |
| 1     | 31.6    | 23.4        | 24.9        | 34 607    |
| 20    | 40.2    | 38.7        | 46.9        | 62 874    |
| 50    | 77.6    | 76.6        | **84.2**    | 108 891   |

With binary and fonts read through the Windows bind mount (run 1) the 50-line p95 was 258 ms — file I/O, not
layout; in the image both live on the container filesystem.

**Memory:** GNU `time` on three 50-line compiles: max RSS **32 420 / 32 388 / 32 304 KB**, elapsed 0.12–0.13 s
including the Node process that emits the document [tested].

**Arabic** — `probe-3.png` (rendered by the same binary) [observed]:

- Letters join correctly; the lam-alef ligature in «الأسنان» is correct; parentheses mirror in «(متابعة)» and
  «(خصم موظف)».
- The injection string `"); #panic("injected") // \ end` printed as text; nothing ran (exit 0).
- **Mixed-direction paragraphs reorder per the Unicode bidi algorithm:** «١٥ أكتوبر ٢٠٢٦ / 15 October 2026»
  inside an RTL paragraph shows as «October 2026 15 / ١٥ أكتوبر ٢٠٢٦», and the mixed total line reads out of
  order. Layout rule for the template: **one language per paragraph or cell**; English and amounts in their own
  `dir: ltr` cells.
- Latin glyphs in the PDF come from IBM Plex Sans Arabic (`pdffonts` lists only that family), so the second
  family is unnecessary.

**Text extraction** — copy, search and screen readers [tested]:

| Word           | pdf.js 6.3.289 (`extract.mjs`)      | pdftotext |
| -------------- | ----------------------------------- | --------- |
| استشارة, عيادة | found                               | found     |
| علاج           | **absent** — extracted «عالج»       | «عالج»    |
| الأسنان        | **absent** — «األسنان»              | «األسنان» |
| بشرة           | **absent** — «برشة»                 | «برشة»    |
| التجريبية      | **absent** — split «التجر» + «يبية» | split     |

Words that contain a ligature or a mark cluster extract with characters reordered. Turning optional ligatures
off (`ligatures: false`, `invoice-noliga.typ`, `noliga.sh`) changed nothing [tested]. This matches the open
upstream issue **typst/typst#4225 "PDF text extraction can fail in complex shaping scenarios"** (open; last
updated 2026-09-26) [upstream]; a related RTL selection issue #6352 is closed as completed [upstream].
The printed and on-screen invoice is correct; copy-paste and in-PDF search of some Arabic words are not.

## 5. Probe hygiene

Synthetic data only. Run 1 had no network and a read-only root. The no-ligature run piped its synthetic
document through `/dev/shm` (memory) for convenience; the production design keeps stdin only. Downloads were
kept in their own folder and verified before use; nothing was installed on the host.

## 6. What the probe does not prove

- Timing on the production host (Dokploy server) — repeat once on staging before enabling the route.
- Behaviour under the 2-render semaphore with concurrent requests (design §3.1) — an 8g test.
- Text extraction with Chromium (option C) — not run; whether it extracts Arabic ligatures correctly is an
  assumption.
