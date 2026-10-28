# F3 export — web slice plan (frontend only)

## 0. Checkout verified (read-only)

- Working ref: sandbox edit branch, HEAD `1cd4d9fc394e7add33cb117dcdc5c688b9085a59`, which is exactly
  `feat/f3-export-web` and `origin/feat/f3-export-web`.
- Contains reviewed runtime `2810c698` (ancestor) and the catalogue prerequisite `1cd4d9fc` (HEAD).
- Web catalogue already has `export_busy` / `export_amount_too_large` with ar+en text (`ar-finance.ts`,
  `en-finance.ts`, `finance-error-codes.test.ts`). Preserved as is.
- Not edited: no source, manifest, lock, contracts, API, worker, SQL, storage or Git change.

## 1. Facts that shape the plan (read from code)

- Contracts (frozen): `reportExportRequestSchema` (report + report fields + optional `groupBy` for
  R1/R2 only + `format` csv|xlsx + `language`, range ≤ 1096 inclusive days), `reportExportSchema`
  (8 fields), `reportExportResponseSchema`, `reportExportListResponseSchema`,
  `reportExportListQuerySchema` (limit 1–100, default 20, export-id cursor), `REPORT_EXPORT_COLUMNS`.
- API admission (`apps/api/.../report-exports.ts`, `domain/report-export-admission.ts`): guard (active
  account → clinic access → `finance` module) → schema parse (`report_range_too_long`, else
  `validation`) → report scope (report key + covering key) else `forbidden` → under the clinic lock:
  freeze branch reach (branch names in the request language) → busy if the caller already has a
  `running` job or the clinic has ≥ 10 `queued` → `export_busy` → insert queued, 202. Admission writes
  **no** audit row. Status/list/download are requester-only; any other caller or clinic is `not_found`.
- Publication (`apps/worker/src/finance-exports/persistence/pg-export-publish.ts`): in one transaction
  blob → `published`, **one** `audit_log` row `finance_report.exported` (entity
  `finance_report_export`, entity id = export id, branch null, actor = requester), then export →
  `done` with `rowCount`, `expiresAt = finish + 24 h`. Category from `domain/export-audit.ts`:
  `daily_takings`, `period_summary`, `by_service`, `by_doctor`, `cash_closings`, `own_summary` →
  `administrative`; R5–R8 (and any unknown key) → `patient_access`. Details exactly
  `{ report, from, to, branchIds (lower-case), rowCount }`. Failed or refused jobs write no export row.
- Cells (`domain/export-cells.ts`): guard prefixes `'` when the first code unit is `=` `+` `-` `@`
  TAB **LF** CR (`0x3d 0x2b 0x2d 0x40 0x09 0x0a 0x0d`); text is never trimmed; `null` text → empty;
  date cells are guarded text; money = `formatSignedMinor(minor, exponent)` with exponent 0|2|3 only;
  counts stay `bigint`. CSV (`export-csv.ts`) refuses with `export_amount_too_large` (no bytes) when
  any amount exceeds 15 significant digits (sign, point and leading zeros not counted).
- XLSX (`export-xlsx.ts`, `export-sheet-xml.ts`, `export-xlsx-stream.ts`): inline-string cells
  (`t="inlineStr"`), money as typed text, no formula cell, XML escaping `&` `<` `>` and CR as `&#13;`,
  `_xHHHH_` escaped to `_x005F_xHHHH_`, invalid XML code points refused (`export_value_invalid`),
  `xml:space="preserve"` on untrimmed text; after 1,048,575 data rows a new worksheet repeats the
  headers; no row is dropped.
- Worker dependencies already present and locked: `@zip.js/zip.js@2.24.0` and `write-excel-file@4.1.1`
  (`apps/worker/package.json`, `pnpm-lock.yaml`). Neither is a dependency of `apps/web` today.
- Mock report builders (`mock-report-takings.ts`, `-analytics.ts`, `-balances.ts`, `-adjustments.ts`)
  take `(ctx: ReportContext, query)` and do **not** check the range; the 366-day check lives in
  `parseReportQuery` / `openReport` (`mock-report-access.ts`). Four builders page through
  `reportPage` (`refunds`, `discounts`, `outstanding`, `patientCredit`); the other six are aggregates.
- No report screens exist (roadmap "Slice 5: the report screens" is open; no `/clinic/reports`).

## 2. Increments (each reviewable alone; target total about 2,500–3,000 changed lines)

### Inc 1 — client interface and HTTP adapter (~250 lines)
- `shared/api/reports-client.ts`: add `requestExport`, `listExports`, `getExport`,
  `downloadExport(...): Promise<Blob>`.
- `shared/api/http/http-report-exports.ts`: POST/GET `/v1/finance-reports/exports[/:id[/download]]`;
  JSON through the contract `safeParse`; download through `transport.download` (bytes, never a URL).
- Tests: paths, methods, body, rejection of an extra field, Blob passthrough, and
  `export_busy` / `export_amount_too_large` / `report_range_too_long` reaching the screen as their code.

### Inc 2 — mock admission, lifecycle, full-data read and audit (~650 lines, `shared/api/mock/`)
- `mock-report-export-admission.ts`: the API admission order above, reusing `guardFinance`,
  `grantFor`/`ROUTE_KEY` and `reportScope`; freezes `{ from, to, language, branchIds, groupBy? }`,
  `scope`, `requestedBy`, clinic. Queue rule: caller running or clinic queued ≥ 10 → `export_busy`.
- `mock-report-export-read.ts` (full data, no screen page): builds a `ReportContext` from the
  **frozen** params (branch reach = frozen ids ∩ current reach; names in the request language), then
  calls the same builders directly, bypassing `openReport`'s 366-day check (the 1096-day check already
  ran at admission):
  - aggregates: `dailyTakings` / `periodSummary` with the frozen `groupBy`, `byService`, `byDoctor`,
    `cashClosings`, `ownSummary` (own reach from the current own-patient rule);
  - lists: `outstanding`, `patientCredit`, `refunds`, `discounts` looped page by page with the
    maximum page size until `nextCursor` is null, concatenated in order; a test proves the row count
    equals the full matching set beyond one page (no silent truncation, no business row cap).
  - R6 keeps the approved rule: current clinic-wide balances; the period does not filter.
- `mock-report-exports.ts`: deterministic progress inside the adapter on the injected mock clock
  (queued → running → done/failed when status/list is read after fixed steps). At run: re-check
  account, clinic, module, report key, covering key and reach exactly like the worker; a lost key →
  `failed` with no artifact; build from **current** data (no canned artifact). At publish, in one step:
  store the artifact, write **one** audit row through `mock-audit.ts` (sole writer) with the category
  and details above, and set `done`. A flag on the job makes publication happen once: polling,
  repeated status reads, list reads, retries and repeated downloads never add a row. Failed, revoked,
  expired or purged jobs never write an export row.
- Download: re-check permission (lost → `forbidden`; narrower reach / not done / expired / purged /
  other requester or clinic → `not_found`); own export with a patient who left reach → `purged` and the
  artifact deleted. Bytes live in memory only (never browser storage, never an object URL in the mock).
- Metadata: only the eight contract fields; `byteSize` set but not displayed.

### Inc 3 — cell preparation, CSV and XLSX for the mock (~350 lines, `shared/api/mock/`)
- `mock-export-cells.ts`: mirrors `export-cells.ts`: the 7-character first-code-unit guard (including
  LF), no trimming, `null` → empty, guarded dates, money from `formatSignedMinor` with exponent 0|2|3,
  counts as `bigint`, unknown kinds refused.
- `mock-export-csv.ts`: UTF-8 BOM, RFC 4180 quoting (comma, quote, CR, LF), headers from
  `REPORT_EXPORT_COLUMNS` in the request language, money/counts as plain numbers, and the
  > 15-significant-digit refusal → job `failed`, no bytes.
- `mock-export-xlsx.ts`: genuine OOXML package written through the zip library in §4 (no handwritten
  archive): inline strings only, money as typed text from the canonical decimal string, never a
  formula cell, XML escaping as above (`&`, `<`, `>`, CR, `_xHHHH_`), invalid code points → job
  `failed`, `xml:space="preserve"` when untrimmed, and a new worksheet with repeated headers after
  1,048,575 data rows (tested on the sheet-splitting function with a small injected limit, never by
  dropping rows). MIME types match the format; a CSV is never labelled XLSX.
- Independent artifact tests read the bytes back with the zip library's reader (entry list,
  `[Content_Types].xml`, sheet XML cells and types) and parse CSV text separately from the writer.

### Inc 4 — export controls and history only (~800 lines, new area `apps/web/src/report-exports/`)
- Bounded placement (no on-screen reports): one thin route `/clinic/reports` that holds only the
  "New export" dialog and the caller's export history, and a finance nav item visible when the caller
  holds any report key. Slice 5 later adds the ten on-screen reports to this page; nothing of slice 5
  is built here. Platform area gets nothing.
- Export dialog: reports the caller can open (report key + covering key via `can()`, never role
  names), CSV/XLSX, header language, from/to (≤ 1096 clinic days, clinic time zone), branch filter
  from that report's permission reach, `groupBy` for R1/R2 only. On R6 the approved ar/en note: the
  selected period does not limit these balances. Submit disabled while pending; repeated clicks send
  one request.
- History (cursor pagination): report, format, created, expires, rows, status (icon + label + tint for
  queued, running, done, failed, expired, purged); no file-size column. Loading, empty and
  error-with-retry states.
- `use-export-polling.ts`: polls only queued/running rows; stops on a final status and on unmount.
- Download only for `done`; a `forbidden`/`not_found` answer refreshes the row, shows the translated
  error and removes the button. The object URL is created after the bytes arrive and revoked right
  after the click.
- i18n ar+en (Arabic says «المراجع»), logical CSS, one component per file, ≤ 300 lines.

### Inc 5 — tests, preview matrix, docs (~350 lines)
- Mock: request/status/history/download; queue cap 10 and running-per-caller busy; caller and clinic
  isolation; missing report key; missing covering key; branch reach; own reach; revocation while
  queued → failed, no artifact, no export audit row; revocation after done → download `forbidden`;
  expiry; purge; 1096 days ok, 1097 `report_range_too_long`; `groupBy` on a non-grouped report →
  `validation`; full-data read beyond one page for all four list reports.
- Audit parity: exactly one `finance_report.exported` row per done job; category per report (all ten
  asserted); details keys exactly `report/from/to/branchIds/rowCount`; no row on admission; still one
  after repeated polling, list reads and three downloads; no row for failed/revoked jobs; a scan of
  the row proves no patient id, patient name, staff name, reason or note appears.
- Cells/CSV: each of the 7 triggers incl. leading LF; a non-trigger second character is untouched;
  untrimmed text; quoting of comma/quote/CR/LF; money for exponents 0, 2 and 3 including negatives;
  15 significant digits accepted, 16 refused with no bytes.
- XLSX: money stays text, no `<f>` anywhere, escaping cases, invalid code point refusal, sheet split
  with repeated headers keeps every row.
- UI hooks: polling stops on final status and on unmount; duplicate click sends one request; stale
  download button removed after refusal. Every rule has a test that fails without it.
- Gates: typecheck, lint, relevant tests, Prettier on touched files,
  `NITRO_PRESET=node-server pnpm build:all` (reported blocked with the underlying tool if the sandbox
  engines still refuse; no bypass).
- Preview: ar and en at 1440 and 390 as clinic admin, branch report user, own-only doctor, and a role
  without a report key; record only what was checked; synthetic data only.
- `AGENTS.md` quick rule for the new area; `roadmap.md` progress (F3 stays unchecked).

## 3. Open items (placement/technical only)

- Q1. Confirm the bounded placement in Inc 4 (export controls + history on `/clinic/reports`, no
  on-screen reports), or name another existing page.
- Q2. The direct dependency in §4 must be added by the orchestrator before Inc 3 starts.

## 4. XLSX path and dependency (for orchestrator review; Lovable edits no manifest or lock)

- Smallest genuine path: add `@zip.js/zip.js` **2.24.0** as a direct dependency of `apps/web`
  (same pinned version the worker uses; already in `pnpm-lock.yaml`, so no new third-party package
  enters the workspace). It runs in the browser and in vitest, writes the OOXML package and reads it
  back for the independent tests. The sheet XML follows the worker's `export-sheet-xml.ts` rules.
- Alternative: `write-excel-file` 4.1.1 browser entry (also already locked); larger, and its
  sheet-splitting and inline-text behavior would need separate checks. Not preferred.
- No handwritten archive writer and no package change in this slice by Lovable.

## Technical notes
- `report-exports/` imports no other business area; report names and branch options come through
  `ApiClient`. Route file thin (head + re-export).
- No change outside `apps/web`, `AGENTS.md` quick rules, `.lovable/plan/`, `roadmap.md`.
