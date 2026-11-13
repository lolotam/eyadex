# Production readiness plan — remaining tasks

Scope: the remaining path to production launch, reconciled with the owner-uploaded handoff dated 2026-11-13. Items are grouped by owner because Lovable may only change `apps/web` and its own planning documents. Each web card is planned, approved and executed separately.

Production and pull-request states taken from that handoff are attributed here; they were not independently verified against GitHub or the production servers.

## Phase 1 — Starting point and documentation

1. Owner/orchestrator confirms the current GitHub `main` hash and launch-handoff list.
2. Local read-only check completed on 2026-11-13: `origin/main` (`fb569ccf`) is an ancestor of `feat/f3-export-web`; no local content merge is needed. This does not verify GitHub's current branch state.
3. Card 0 completed: refresh `roadmap.md` and this plan so completed work is not rebuilt.

## Phase 2 — Remaining web work (Lovable)

### Card 2 — cleanup

1. Card 2a completed: `visits/use-list-flush.ts` and `shared/api/new-clinic-finance.ts` already use the compatibility APIs and needed no change.
2. Card 2a separated the badge/button/toggle/navigation/form non-component exports and the encounter-slots provider, clearing six warnings without disabling rules or changing behaviour. Existing import paths remain in place except for the provider's two composing routes and the small set of variant/hook consumers.
3. Card 2b completed its bounded part: the API and persona providers are separate from their contexts/hooks, only the 13 API and four persona provider import sites changed, and the sidebar's unused public hook export is gone. Four warnings cleared; no hook consumer or behaviour changed.
4. Card 2c remains: one i18n provider warning. Splitting it also changes `invoice-page.test.tsx` and `receipt-details.test.tsx`, both excluded until the PDF delivery stack syncs, so it moves with that synced review. The sidebar is now 743 lines but has no lint warning; a structural shadcn rewrite is not part of this cleanup.
5. Keep tests green; any changed behaviour requires a focused test.

### Card 1 — finance accessibility and print

Run only after the PDF delivery stack merges and is synced into this branch. Review service prices, invoices, payments, receipts, refunds, cash closings, exports and history, and R1–R10 in Arabic and English at 1440px and 390px. Cover keyboard, screen reader semantics, touch targets and report print. Fix confirmed defects only; do not change data requests, query keys, retries, branch scope, totals, export behaviour or the R10 rules.

The invoice and receipt PDF web buttons already exist in PRs #168 and #171. Do not build them again. Any follow-up is limited to confirmed accessibility or print defects in the merged implementation.

## Phase 3 — PDF delivery and backend activation (owner/orchestrator)

1. F1/F2 PDF renderer and proofs: merged in #156–#161 according to the handoff.
2. PDF delivery stack #162–#171 and worker pipeline #172–#178: in review/draft on HOLD. The owner must separately lift the HOLD before the orchestrator merges or activates them, with staging checks, backup, performance, logo and storage gates.
3. CSV/XLSX server export is already live: production exports opened on 2026-11-02 and the first real export was verified according to the handoff. Only the owner's own XLSX and real-rows checks remain; these are not web implementation tasks.
4. F3 open inputs: a taxed R3/R4 row, production permission smoke, owner XLSX/real-rows checks, disposition of the owner-expanded data gaps, and the final F3 receipt.
5. Medical activation: confirm whether the ICD-10-CM catalogue is loaded and whether `medical-release-catch-up.sql` has run on staging and production; complete whichever remains.
6. Operations: backups with a tested restore, error monitoring, and real email/WhatsApp delivery.

## Phase 4 — Release verification

1. Gates on the required engines (Node 24+, pnpm 12.5.1): typecheck, lint, tests and node-server build. Lovable's sandbox cannot run these required engine versions.
2. Staging check against the real API for every persona, Arabic and English, 1440px and 390px, plus print.
3. R9 read-only check on the first clinic with real closings: no seeded data and no writes.
4. Launch go/no-go by the owner after all launch items are closed.

## Out of scope for launch

F4 (online payment, insurance and booking deposits), per-clinic public pages and the landing-page builder, specialty sections, and AI. Each needs its own specification and owner decisions before any Lovable card exists. Finance exclusions also remain unchanged: packages, doctor commission, government e-invoicing, double-entry ledger, inventory and dental chart.

## Next executable web step

No unblocked web card remains before the PDF sync: Card 2c and Card 1 both wait for the excluded invoice/receipt files to merge. Card 2b's direct typecheck, formatting, focused tests and browser report check pass; the required-engine gates still belong to the orchestrator. This plan neither lifts the PDF HOLD nor authorizes deployment.
