# F3 export web slice — prepared brief, not sent

Status: pending API review/freeze and a permitted Lovable connection. The orchestrator has not sent
this brief or requested a build. Use the reviewed runtime commit on Lovable's working branch before
starting; do not reconstruct backend code from this brief.

## Read first

`AGENTS.md`, `CLAUDE.md`, `CLAUDE.architecture.md`, `apps/web/AGENTS.md`, `.lovable/review-lessons.md`,
`docs/specs/finance-f3-reports-design.md` §3–§7 and §11–§12,
`docs/specs/finance-f3-export-runtime.md`, `packages/contracts/src/finance-reports.ts`,
`finance-reports-export.ts`, `finance-reports-export-list.ts`, and the existing `ReportsApi`, HTTP
report client and report mock. The backend belongs to the orchestrator. No further product decision
is open for this slice.

## Scope

1. Extend `ReportsApi` through `ApiClient`, with export request, own history, status and binary
   download methods matching the four documented routes. Screens use `useApi()` only. HTTP JSON
   responses use their contract's `safeParse`; downloads are file bytes, never a storage URL.
2. Add the export controls and requester history to the report area only. Offer CSV and XLSX, header
   language, a range up to 1096 days and the applicable report filters. The export always queues a
   job, even for an empty or small report. Poll only queued/running jobs; stop on final status and
   unmount. Disable duplicate submission while the request is pending. Show loading, empty, queued,
   running, done, failed, expired and purged states with translated text, icons and labels.
3. Download through the client when a job is done. Refused/expired access must not open a file or
   leave a stale download button. Treat the API's error as authoritative. Add the export error keys
   `export_busy` and `export_amount_too_large` to the web catalogue with Arabic/English messages and
   adjust the API-only error list through an orchestrator contract change if needed. Ask for that
   contract change in the plan; do not edit `packages/contracts` yourself.
4. The mock mirrors the API's access order and requester/clinic isolation. Use current report data;
   do not use canned successful jobs, pretend authorization, patient data in metadata, CSV renamed
   as XLSX, or public object URLs. Keep file generation and business rules in the mock, never a React
   component. No new dependency or lockfile change; if an implementation needs one, explain it in
   the plan before writing.
5. Visibility follows report permission strings and their covering keys, never role names. Platform
   sees no finance report or export. Keep Arabic-first RTL, English LTR, logical CSS and the existing
   clinical visual system. Do not add reports, PDF generation, a new financial write, 0071–0073, or
   specialty features. Browser print is already the decided PDF alternative.

## Tests and acceptance

Vitest against the mock must cover request/status/history/download, queue cap 10, caller/clinic
isolation, missing report or covering key, branch and own reach, and permission revocation while a
job waits. A final or unmounted job stops polling. Check disabled and repeated clicks and errors.
Run typecheck, lint, relevant tests and `NITRO_PRESET=node-server pnpm build:all`.

Check Arabic and English at 1440px and 390px as clinic admin, a branch report user, own-only doctor,
and a role without a report key. Record what was actually checked, with no real patient data or
credentials in screenshots or logs. The orchestrator repeats the relevant journeys against the real
staging API; a mock preview does not replace that gate.

## Hard rules

Change `apps/web` and its tests only, plus Lovable-owned planning files and roadmap progress for this
slice. No `apps/api`, `apps/worker`, `packages/*`, `db/sql`, Cloud, Supabase or server-side business
logic. No adapter import from a screen. All copy through i18n. One component per file, at most 300
lines per file. Format every touched file. Do not mark F3 complete, deploy or merge. Return changed
files, test counts and the checked language/viewport/persona matrix.

## Approved R6 exception (2026-10-27)

Patient-credit is the current clinic-wide remaining balance across the complete credit ledger.
Dates are still validated by the shared request, but do not filter this report. Explain in both
languages on the R6 screen and export action that the selected period does not limit these balances.
Do not add a credit-creation-date filter to the mock or HTTP adapter.
