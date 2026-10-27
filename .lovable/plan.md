# F3 export — web slice plan (frontend only)

## 0. Checkout verified (read-only)

- Working ref: sandbox edit branch, HEAD `1cd4d9fc394e7add33cb117dcdc5c688b9085a59`, which is exactly
  `feat/f3-export-web` and `origin/feat/f3-export-web`.
- Contains reviewed runtime `2810c698` (ancestor) and the catalogue prerequisite `1cd4d9fc` (HEAD).
- Web catalogue already has `export_busy` / `export_amount_too_large` with ar+en text (`ar-finance.ts`,
  `en-finance.ts`, `finance-error-codes.test.ts`). Preserved as is.
- Not edited: no source, manifest, lock, contracts, API, SQL, storage or Git change.

## 1. Facts that shape the plan

- Contracts (frozen): `reportExportRequestSchema` (report + report fields + optional `groupBy` for
  R1/R2 only + `format` csv|xlsx + `language`, range ≤ 1096 days), `reportExportSchema` (8 fields),
  `reportExportResponseSchema`, `reportExportListResponseSchema`, `reportExportListQuerySchema`
  (limit 1–100, default 20, export-id cursor), `REPORT_EXPORT_COLUMNS` (headers ar/en + kind).
- API order (read from `report-exports.ts` / `report-export-admission.ts`): guard (active account →
  clinic access → `finance` module) → schema parse (`report_range_too_long`, else `validation`) →
  report scope (report key + covering key) else `forbidden` → under clinic lock: freeze branch reach
  → busy if the caller already has a `running` job or the clinic has ≥ 10 `queued` → `export_busy`
  (429) → insert queued, 202. Status/list/download are requester-only; others are `not_found`.
  Download: lost permission `forbidden`, narrower reach / unfinished / expired / purged / other
  requester or clinic `not_found`.
- `ReportsApi` has the ten on-screen reports only; HTTP transport already has `download(path): Blob`.
- No report screens exist yet (roadmap "Slice 5: the report screens" is open; no `/clinic/reports`
  route). See open question Q1.
- No XLSX, ZIP or compression package is in the workspace. See §4.

## 2. Increments (each one reviewable on its own; target total about 2,500–3,000 changed lines)

### Inc 1 — client interface and HTTP adapter (~250 lines)
- `shared/api/reports-client.ts`: add `requestExport(persona, body)`, `listExports(persona, query)`,
  `getExport(persona, id)`, `downloadExport(persona, id): Promise<Blob>`.
- `shared/api/http/http-report-exports.ts`: POST/GET `/v1/finance-reports/exports[/:id[/download]]`;
  JSON answers through the contract `safeParse` (bad shape → the existing parse-failure error);
  download via `transport.download`, never a URL. Encode ids like the other adapters.
- Tests: paths, methods, body, `safeParse` rejection of an extra field, Blob passthrough,
  `export_busy` / `export_amount_too_large` / `report_range_too_long` reach the screen as their own code.

### Inc 2 — mock export store, access order and lifecycle (~600 lines, all in `shared/api/mock/`)
- `mock-report-export-access.ts`: same order as the API (reuses `mock-actor` + the existing
  `mock-report-access` report scope / covering keys / branch filter); freezes `branchIds`, `scope`,
  `requestedBy`, clinic.
- `mock-report-exports.ts`: queued row; admission busy rule (caller running, or clinic queued ≥ 10);
  requester+clinic isolation (`not_found`); list newest first by `(createdAt, id)` with export-id cursor.
- Lifecycle without a worker and without canned success: a deterministic step driven by the mock clock
  on each status/list read (queued → running → done/failed). At "run" it re-checks access exactly like
  the worker: lost key → `failed` (no file); it then builds the file from **current** report data via
  the existing R1–R10 builders with the frozen params. `expiresAt` = finish + 24 h; reads after it give
  `expired`; an own export whose patient left reach → `purged`. Download re-checks access before
  returning bytes. CSV over 15 significant digits → `failed` (`export_amount_too_large` semantics).
- Artifacts live in memory only (`Uint8Array` keyed by export id), never in browser storage and never
  as an object URL. Metadata never carries params, names or patient ids. `byteSize` is set but not shown.
- No audit row (the API writes none for export requests in the runtime read; confirm in Q3).

### Inc 3 — genuine CSV and XLSX writers for the mock (~400 lines, `shared/api/mock/`)
- `mock-export-csv.ts`: UTF-8 BOM, RFC 4180 quoting, headers from `REPORT_EXPORT_COLUMNS` in the
  request language, money in major units with the currency exponent, dates `YYYY-MM-DD`, formula guard
  on every text cell (`= + - @ \t \r` → `'`), numbers unguarded.
- `mock-export-xlsx.ts` + `mock-export-zip.ts`: real OOXML package (`[Content_Types].xml`, `_rels`,
  `xl/workbook.xml`, `xl/_rels`, `xl/worksheets/sheet1.xml`), inline-string cells, money as typed text
  from the canonical decimal string, same formula guard, written as a **stored (uncompressed) ZIP**
  with CRC-32. MIME types match the format. A CSV is never relabelled as XLSX.
- Tests read the bytes back: ZIP signatures, CRC of each entry, entry list, sheet XML cells; CSV BOM,
  quoting, guard, precision refusal.

### Inc 4 — screens (~800 lines, new business folder `apps/web/src/report-exports/`)
- Export dialog: report picker limited to reports the caller `can()` open (report key + covering key,
  never role names), CSV/XLSX, header language (default = UI language), from/to (≤ 1096 clinic days,
  clinic time zone), branch filter only from the reach of that report's permission, `groupBy` for R1/R2.
  R6 shows the approved ar/en note that the period does not limit balances; no credit-date filter.
  Submit disabled while pending; repeated clicks send one request.
- History table (own exports, cursor pagination): report, format, created, expires, rows, status
  (icon + label + tint: queued, running, done, failed, expired, purged); no file-size column.
  Loading, empty and error-with-retry states.
- `use-export-polling.ts`: polls only queued/running rows, stops on a final status and on unmount.
- Download action: only for `done`; `forbidden` / `not_found` / `expired` refreshes the row, shows
  the translated error and leaves no download button; the object URL is created after the bytes
  arrive and revoked right after the click (no `window.open`).
- i18n keys ar+en (Arabic says «المراجع»); logical CSS; one component per file, ≤ 300 lines.
- Placement per Q1. Platform area gets nothing.

### Inc 5 — tests, preview matrix, docs (~300 lines)
- Vitest (mock): request/status/history/download, queue cap 10 and running-per-caller busy, caller and
  clinic isolation, missing report key, missing covering key, branch reach, own reach, revocation while
  queued → failed with no file, revocation after done → download `forbidden`, expiry, purge, range 1096
  ok / 1097 `report_range_too_long`, `groupBy` on a non-grouped report → `validation`.
- Hook/UI tests: polling stops on final status and on unmount; duplicate click sends one request;
  stale download button removed after refusal.
- Each rule gets a test that fails when the rule is removed.
- Gates: typecheck, lint, relevant tests, Prettier on touched files,
  `NITRO_PRESET=node-server pnpm build:all` (reported as blocked with the tool alternative if the
  sandbox Node/pnpm engines still refuse; no bypass).
- Preview: ar and en at 1440 and 390 as clinic admin, branch report user (receptionist with
  `view:report_takings:branch`), own-only doctor (R10), and a role without any report key. Record only
  what was actually checked; synthetic data only.
- `AGENTS.md` Lovable quick rule for the new area; `roadmap.md` progress (F3 stays unchecked).

## 3. Open questions (the brief closes product rules; these are placement/technical)

- Q1. Placement: report screens (slice 5) do not exist. Proposal: a thin `/clinic/reports` page that
  holds only the export dialog and the history now, with a finance nav item shown when the caller holds
  any report key; slice 5 later adds the on-screen tables to the same page. Alternative: wait for slice 5.
- Q2. Mock job progress: advance one step per status read (deterministic, testable) — acceptable?
- Q3. Confirm the export request writes no audit row (mock will mirror whatever the API does).

## 4. XLSX dependency

- Not required. The mock only needs to emit a valid XLSX, and a stored (no compression) ZIP with
  CRC-32 is enough for Excel/LibreOffice. About 120 lines in `shared/api/mock/`, no package, no lock
  change. The HTTP path receives the API's bytes and needs no writer.
- If a dependency is ever preferred, the smallest option is `fflate` (zip only, no dependencies,
  MIT), subject to the 24-hour supply-chain guard. Not proposed for this slice.

## Technical notes
- Areas: `report-exports/` imports no other business area; report names/branch options come through
  `ApiClient`. Route file thin (head + re-export).
- No change outside `apps/web`, `AGENTS.md` quick rules, `.lovable/plan/`, `roadmap.md`.
