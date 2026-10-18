# Finance F1 follow-ups — web (2026-10-18)

> Sent to Lovable in **Plan mode** first; building starts only after a separate "Execute the approved plan"
> message. Web only: the backend part (logo 4xx, edit price rule, one price query, patient name read,
> `invoicePrefix` in the branch audit snapshot, worker skip order) is already on `lovable`.

**PLAN MODE ONLY: do not edit any file or commit. Reply with your implementation plan and wait for the go-ahead.**

- **Branch:** `lovable`
- **Origin:** PR #78's "Follow-ups" list (non-blocking review findings, owner policy 2026-10-17).
- **Rules:** read `CLAUDE.md` fully, then `CLAUDE.architecture.md`, then **`.lovable/review-lessons.md` (the whole file)**.
  Tick its checklist before you say a task is done. Spec: `docs/specs/finance-design.md` §3, §8, §8b.

Every string ar + en, logical CSS, shadcn/ui + react-hook-form, «المراجع» never «المريض», «موظف استقبال»
never «كاشير». Files ≤ 300 lines, one component per file. The mock refuses exactly what the API refuses.
Money is never a JS `number`.

Do not edit `packages/contracts`, `apps/api`, `apps/worker`, `db/`, `docs/`, or `apps/web/src/components/ui`.
If one of these looks wrong for your task, stop and say so in the plan.

## Order of work

Item 1 first (it is the mock audit work the owner approved on its own); the rest in the order listed.
If the whole change is more than about 3,000 changed lines, say so in the plan and propose where to split it
into two pushes.

## 1. Mock writes clinic audit rows for the finance writes (first)

The API records an append-only clinic audit row for each finance write; the mock records none. Add them in
`apps/web/src/shared/api/mock/` (see `mock-audit.ts`, `mock-audit-log.ts`, `mock-finance*.ts`,
`mock-invoice-writes.ts`, `mock-clinic-settings.ts`), with the same action names, entity types, snapshot
shape and the same order (inside the same write, after validation, before the response) as the API:

- invoice issue / edit / void (`invoice.issued`, `invoice.edited`, `invoice.voided`), service price set,
  provider prices set, commercial registration set, logo set, branch invoice prefix set
  (`branch.invoice_prefix_set`; the branch snapshot now carries `invoicePrefix`, so the audit screen
  shows the value — check `ar-audit.ts` / `en-audit.ts` and `audit-format` for the label).
- The API's finance audit stores an **exact snapshot** and only the **length** of a free-text reason;
  read `apps/api/src/modules/billing/use-cases/**` (`audit(...)` calls) and copy the allowlist.
- **Invoice-snapshot scrub exemption:** the mock's audit scrub (`mock-audit-scrub.test.ts`, `scrubAuditText`
  equivalent) must not mangle an invoice snapshot's numbers/strings the way it scrubs typed names; the API
  exempts the invoice snapshot from that scrub. Mirror it.
- Tests: for each write, a mock test that fails without the row; one for the scrub exemption; a rejected
  write (permission/validation) leaves **no** audit row.

## 2. Move `shared/finance` out of `shared/`

`apps/web/src/shared/finance/` (the source invoice button and menu item, `use-source-invoice-link`) decides
invoices, so it is business code in `shared/` (lesson 8.2). Compose it from the routes instead, as
`area-boundaries.test.ts` expects: the invoice code lives in `invoices/`; `appointments/appointment-actions.tsx`
and `visits/visit-content.tsx` receive the button/menu item as a slot/prop from the route files (or whatever
composition the other areas already use). Do not weaken `area-boundaries.test.ts`; do not add an exception.
Delete the `shared/finance` folder when it is empty.

## 3. Source invoice button (same files)

- Look up the encounter's live invoice on **both** the appointment and its visits (`GET /v1/invoices` with
  `source` + `sourceId`; one invoice per encounter exists across an appointment and its visits).
- A user who holds a create key but **no view key** still gets «فاتورة» (it opens the new-invoice flow);
  they do not get a link to an existing invoice they cannot view. Think in custom roles (lesson 1.3).
- Gate by the **record's branch** (lesson 1.1).

## 4. New-invoice page

- Discount controls: gate with `canAtBranch("create", "discounts", branchId)` on the draft's selected
  branch (lesson 1.2), and re-validate when the branch changes. Mock rejects too (lesson 1.5).
- Show an error state with a retry button when the existing-invoice lookup fails, instead of opening the
  form (lesson 5.2).
- Services picker: page through **all** services (cursor, max 100 per page; lesson 5.3), not the first 100.
  Look at `invoices/invoice-options.ts`.

## 5. Invoice PDF

`invoices/invoice-page.tsx`: open the new tab **inside the click** (before any `await`), navigate it to the
object URL after the download, revoke the object URL, and when the popup is blocked fall back to a normal
download link. The API answers 503 until the server renderer ships; the existing inline message for that
stays (lesson 6.1, 6.2).

## 6. Dialogs and cards: do not overwrite unsaved edits

- `services/service-price-dialog.tsx`, `services/provider-prices-dialog.tsx`, the platform clinic's finance
  tab (`platform/`), and `settings/invoice-prefixes-card.tsx` / `invoice-prefix-dialog.tsx`: initialise the
  form once per open; a background refetch must not reset what the user typed (lesson 4.1, 4.2).
- When the prefixes read fails, show an error with a retry button, not an empty card (lesson 5.1).

## 7. Role editor

`roles/permission-matrix.tsx` `viewScope(...)`: when the exact scope is not in the catalog, fall back to the
**widest** scope available for the viewed resource, not the first one found. Add the test.

## 8. Services screen for price-only roles

A role holding only `view:prices` / `update:prices` (no `view:services`) must reach the Services screen and
see the price column (read what the API lets such a role read: `GET /v1/services` is gated by the services
view key; check `apps/api/src/modules/**/services*` and the spec; if the API cannot serve it, STOP and say
so in the plan instead of guessing). A role without any of these keys still cannot open it. Nav item,
route guard and the mock must agree.

## 9. Mock clinic create

`shared/api/mock/` clinic create (platform): put the finance fields in the **replay fingerprint**
(`mock-clinic-replay.ts`), and parse the body through `parse()` so a bad body is
`ApiError("validation")` before any state changes (lessons 2.2, 2.3). Tests for both.

## 10. `prices.ts`

Drop the non-null assertion (`!`) on the `readPrices` result; handle the missing case explicitly.

## 11. Invoice list

Debounce the invoice-number search and the patient picker (`invoices/invoices-content.tsx`,
`invoices/invoice-patient-picker.tsx`): the request fires after the user stops typing (about 300 ms),
the previous selection is kept while loading, and the debounce timer is cleaned up on unmount. Test with
fake timers. Do **not** add patient names to the list rows (a separate task owns it).

## 12. Invoice page patient name (new API field)

`GET /v1/invoices/:id` now answers an optional `patientName` (contract `invoiceSchema`, detail only; the
list rows never carry it). `invoices/invoice-patient-name.tsx` / `invoice-page.tsx` today read the name by
opening the patient file, which writes one `patient_access` audit row per page view. Read the name from the
invoice detail instead and stop calling the patient endpoint from the invoice page. The mock's invoice
detail returns `patientName` under the same reach rules as the API (an invoice the caller cannot see is
`not_found`, no name leaks), and records no patient-access audit row. If `patientName` is missing, show the
patient file number or a neutral «المراجع» label, never an empty cell.

## Tests and gates

- Every rule above gets a test that fails without it (lesson 9.2); no secret-looking strings (9.1).
- `pnpm --filter @eyadex/web typecheck && pnpm --filter @eyadex/web lint && pnpm --filter @eyadex/web test`
  and `NITRO_PRESET=node-server pnpm build:all` (not the root `pnpm build`).
- Prettier on every touched file. No lockfile change.
- Check the screens in Arabic and English at 1440px and 390px.
- Report: which items are done, test counts, and anything you left out and why.
