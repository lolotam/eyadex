# Production readiness plan — remaining tasks

Scope: what is left between today's state (F1, F2, F3 screens R1–R10 merged) and a production launch. Items are grouped by owner, because Lovable may only change `apps/web`. Each web item is one small slice, planned and approved separately before execution.

## Phase 1 — Confirm the starting point (read-only, no code)
1. Owner/orchestrator confirms current `main` hash and the open launch-handoff list.
2. Refresh `roadmap.md` so completed F2/F3 cards are marked done and only real open items remain (Lovable, roadmap only).

## Phase 2 — Remaining web work (Lovable, one slice each)
1. Invoice and receipt PDF on the web side: open/download buttons, `window.open` before any `await`, object URLs revoked, clear bilingual message while the API answers 503. Starts only after the orchestrator wires plan Task 8g.
2. Web cleanup from review follow-ups: Zod 4 compatibility for `visits/use-list-flush.ts` and `new-clinic-finance.ts` (planned earlier, not executed); fix the remaining lint warnings.
3. Final accessibility and print pass on finance screens (keyboard, RTL, clamped text prints whole).

## Phase 3 — Backend activation (orchestrator, not Lovable)
1. Wire PDF generation (Task 8g) and the patient link.
2. CSV/XLSX export on the real server: private storage, permissions, download, expiry and deletion, isolation tests.
3. Medical file: load the `ICD-10-CM` catalogue; update permissions for existing clinics (new SQL file).
4. Operations: backups plus a tested restore, error monitoring, real email and WhatsApp delivery.

## Phase 4 — Release verification
1. Gates on the required engines (Node 24+, pnpm 12.5.1): typecheck, lint, tests, node-server build.
2. Staging check against the real API for every persona, Arabic and English, 1440px and 390px, plus print.
3. R9 read-only check on the first clinic with real closings (no seeded data, no writes).
4. Launch go/no-go by the owner.

## Out of scope for launch
F4 (online payment, insurance), per-clinic public page, specialty sections, AI assistant.

## Open questions for the owner
- Should the PDF slice wait for Task 8g, or start now against the 503 state?
- Which Phase 2 slice goes first?
