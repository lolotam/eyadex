# F3 export follow-up (web only)

Scope: `apps/web/src/report-exports/*`, the two report-export dictionaries, and `shared/api/mock/mock-export-sheet-xml.ts` plus its tests. No contracts, API, worker, SQL or dependency changes. Every file stays at 300 lines or fewer, one component per file.

## Items

1. **Desktop history labels** (`export-history.tsx`, `export-history-row.tsx`)
   Add a header row above the list, visible only at `md` and up. It repeats the same columns as the row grid (report / requested / available until / rows / action) and uses the existing `reportExports.*` label keys. Rows keep their `md:sr-only` per-cell labels, so screen readers still announce each value. The 390px cards stay as they are.
2. **One numeral system** (`export-history-row.tsx`)
   Format the row count with `new Intl.NumberFormat(locale)`, using the same `ar-KW` / `en-GB` locale as the dates.
3. **No-access form** (`export-request-form.tsx`)
   `disabled = isPending || noEligibleReports`. When the hook reports no eligible report, every field and the submit button are disabled and the notice is linked to the form with `aria-describedby`. History does not change. If the requester only lost the selected report, the existing selector behaviour stays.
4. **Arabic date hint**
   The app has no shared date field: audit, appointments, payments and closings all use native `type="date"`. I keep the native inputs and add a translated format hint (`YYYY-MM-DD`, with the Arabic wording) under each date field, linked through `aria-describedby` next to the clinic time-zone help.
5 and 7. **History pagination gap and fan-out** (`use-export-history.ts`)
   Replace the one-by-one `getExport` tail refresh with cursor walking. On refresh, request pages from the head and follow `nextCursor` sequentially until one of these happens:
   - the walk has covered as many rows as were loaded before plus any new ones, so a reached loaded row stops it, or
   - `nextCursor` is `null`.

   The fresh pages replace the loaded rows (stable dedupe by id, API order), and `nextCursor` comes from the last fresh page. This removes the stale-cursor gap (20 loaded + 25 new → all 45, correct `hasMore`). Fresh pages also carry current expiry and purge state, so a purged row drops out. There is no row cap. Every awaited page is guarded by the existing signal, mount, identity and generation checks before the next call. Pages are sequential, so they never overlap, and polling stays at 2s, only while a job is queued or running.
6. **Permission restoration** (`use-export-download.ts`)
   A forbidden/not_found mark is tied to the access fingerprint: session permissions, finance state and blocked state. When that fingerprint changes, the marks clear and the button comes back. While access is still denied, a new attempt hits the adapter again and marks the row again, so it stays hidden. There is no automatic retry.
8. **XLSX 16-digit counts** (`mock-export-sheet-xml.ts`)
   Integer count cells with more than 15 significant digits are written as text cells with the `@` style, the same way money is. Counts of 15 digits or fewer stay numeric `t="n"`. Assumption: exact text is acceptable for counts of 16 digits or more, matching what the orchestrator does in the worker.
9. **Test-kit split**
   Move `NativeSelect` and `Harness` out of `export-request-form.test-kit.tsx` into `export-native-select.test-kit.tsx` and `export-form-harness.test-kit.tsx`, then update the imports. No behaviour change.
10. **Stale corrected-date feedback** (`use-export-form.ts`)
    Each stored field issue records the draft values it was raised for. When the draft changes, the issues for the changed fields (and dependent ones: dates for each other, report for branch) drop out. Request schema issues for changed paths are filtered the same way in the form, so `aria-invalid` follows. An invalid submit still sends no POST.
11. **Commit-safe actor generations** (`use-export-form.ts`)
    The generation is no longer bumped during render. Render computes a candidate generation from the identity, and a layout effect commits `committedIdentity` and `generation` only when that render commits. Setters and submit compare against the committed identity and epoch, so an abandoned speculative B render can't invalidate A's callbacks. A committed switch to B still fences A, and A→B→A still gets a fresh epoch. The late-result, duplicate and branch-reach fences in `use-request-export` and `use-export-branch-options` stay as they are. Only this hook's render-time counter changes.

## Tests (real root mock client, state, roles and lifecycle; no stubbed business success)

- `export-history-row.test.tsx` and `export-history.test.tsx`:
  - Desktop header labels in AR and EN.
  - Arabic count digits match the date digits (`١٠٠٬٠٠٠`).
- `export-request-form-guards.test.tsx`:
  - A no-key requester gets every control disabled, Enter sends no POST, and history stays visible.
  - The date hint shows in AR and EN.
- `use-export-history.test.tsx`:
  - 20 loaded terminal jobs + 25 new from a second client → 45 rows and correct `hasMore`.
  - Refresh uses `listExports` pages only, with zero `getExport` calls.
  - A purged or expired row updates.
  - Unmount during the page walk starts no tail page.
- `use-export-download.test.tsx`: denial → hidden → permission restored → download succeeds with a real Blob, and it stays hidden while access is still denied.
- `mock-export-xlsx.test.ts`: counts of 15 digits (numeric) and 16 digits (exact text) checked with the independent reader.
- `use-export-form.test.tsx`:
  - Fixing an invalid date clears its issue and `aria-invalid`.
  - Abandoned B transition (`startTransition` + suspending child) leaves A's setter and submit working with exactly one POST.
  - A committed A→B→A still resets the draft and its stale submit is refused.
- Mutation proofs:
  - Revert the cursor walk to the old cursor: the gap test fails.
  - Drop the fingerprint reset: the restoration test fails.
  - Go back to the render-time generation bump: the transition test fails.

  Each is restored byte for byte afterwards.

## Checks

Focused, full web, typecheck, ESLint, Prettier, diff check, and `NITRO_PRESET=node-server pnpm build:all`. If the build fails, I report the Node 22/pnpm 10 sandbox block without using bypass flags. Browser checks at 1440 and 390 in AR and EN for the admin, doctor and technician personas on `/clinic/reports`.
