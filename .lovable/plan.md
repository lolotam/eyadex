# Phase 4 F1 web — service prices and invoices

Branch `lovable` at `7c91e5e` (already the latest; brief, spec and frozen contracts present). Web only. No edits to `packages/contracts`, `apps/api`, `apps/worker`, `db/`, `docs/adr`, `components/ui`. Money stays minor-unit strings; totals via `computeInvoiceTotals`, display via `formatMinor` with the clinic's exponent from `GET /v1/clinic/settings/finance` (never hardcoded KWD/3).

## §0 Type errors and labels
- Points 1–3: verify the 14 error keys, `finance: false` in module maps (seed already has it), role-editor group, `invoice_void` history label. Add only what is missing: platform label «المالية»/"Finance" with `moduleDependencyGap` on patients; `permission-matrix.tsx` Finance group (Invoices, Discounts, Prices) with the `VIEWED_THROUGH` write-needs-view rule; `mock-role-rules.ts` `CLINIC_BOUND` + `view:invoices:own → view:invoices:clinic`; `seed-roles.ts` receptionist `view/create/update:invoices:branch` + `view:prices:clinic`, doctor `view:invoices:own`.
- Point 4 (new): `ar-audit.ts` / `en-audit.ts` gain `invoice.issued`, `invoice.edited`, `invoice.voided`, `invoice.link_opened` («فتح المراجع رابط الفاتورة»), platform `clinic.finance_changed`.

## Client layer (shared)
- New `shared/api/finance-client.ts` (FinanceApi: prices, finance settings, logo, prefixes, invoices, draft, pdf Blob, void, send, platform finance + totals); added to `api-client.ts`.
- New `shared/api/http/http-finance.ts`, `http-invoices.ts`, `http-platform-finance.ts`: safeParse every answer; `Idempotency-Key` on create; `If-Match` on edit/void; ETag version; logo PUT with raw body + content type; pdf as Blob. Transport gains a blob/raw-body path if missing.
- Mock: `mock-finance-state.ts` (prices, prefixes, used prefixes, invoices, counters, send ids, logo, commercialRegNo), `mock-prices.ts`, `mock-invoice-prefixes.ts`, `mock-invoices.ts` (issue/edit/void), `mock-invoice-reads.ts` (list/get/draft/pdf), `mock-invoice-send.ts`, `mock-platform-finance.ts`; wire in `mock-adapter.ts`, `mock-store.ts` (demo storage version bump), `seed.ts`.
- Queries: `invoices/invoice-queries.ts`, `services/price-queries.ts`, `settings/finance-queries.ts`, `shared/money/use-clinic-money.ts` (format/parse with the clinic exponent).

## §1 Services prices (`services/`)
- `use-service-columns.tsx`: price column («بدون سعر» when null), "Edit price" and "Doctor prices" actions; data merged from `GET /v1/prices` only.
- New `service-price-dialog.tsx` (major-unit input → `parseMajorToMinor`, null clears), `provider-prices-dialog.tsx` (whole list, PUT).
- Shown with `view:prices:clinic`, edit with `update:prices:clinic`, hidden when finance is off.

## §2 Settings → Clinic finance (`settings/`)
- New `clinic-finance-card.tsx` (read-only currency + tax rate; commercial reg. no. form ≤ 40), `clinic-logo-card.tsx` (PNG/JPEG ≤ 1 MB preview + upload), `invoice-prefixes-card.tsx` + `invoice-prefix-dialog.tsx` (locked = read-only; needs `update:branches:clinic`). Mounted in `clinic-settings-content.tsx`.

## §3 Invoice button (`invoices/invoice-source-button.tsx`)
- On appointment actions and visit page: looks up the issued invoice by `source`/`sourceId`; "View invoice" if found, else "Invoice" (needs `create:invoices:*`) opening the form pre-filled from the draft; `priceMissing` lines show the `price_missing` message.

## §4 Invoice form (`invoices/`)
- `invoice-form-dialog.tsx`, `invoice-line-row.tsx`, `invoice-discount-fields.tsx`, `invoice-totals-panel.tsx` (tax line only when rate > 0), `invoice-form-draft.ts` (form ↔ request, pure). Manual picks patient + branch; sourced sends only source + sourceId. Discount controls only with `create:discounts:*`. Edit sends If-Match; `version_conflict` shows message + "Reload".

## §5 Invoices list
- Route `routes/clinic.invoices.tsx`; `invoices/invoices-page.tsx`, `invoices-content.tsx`, `invoice-filters.tsx` (branch, patient, status, from/to in clinic timezone, number), `use-invoice-columns.tsx`, `invoice-status-badge.tsx`. Nav item with `view:invoices:*`, hidden when finance is off.

## §6 Invoice page
- Route `routes/clinic.invoices.$invoiceId.tsx`; `invoice-page.tsx`, `invoice-detail.tsx`, `invoice-void-banner.tsx`, `invoice-void-dialog.tsx` (reason, If-Match), `invoice-send-menu.tsx` (email/WhatsApp; one UUID per press, reused on retry), `use-invoice-pdf.ts` (Blob → object URL in a new tab).

## §7 / §7b
- Error copy: existing keys reused; inline display via the existing `errors.<code>` path.
- Platform: create-clinic form gains currency (default KWD) + tax rate bp (0–10000, default 0); clinic page gets `platform/clinics/clinic-finance-tab.tsx` (view/PATCH, `currency_locked` inline) and `clinic-finance-totals.tsx` (read-only month table).
- i18n: new `en-finance.ts` / `ar-finance.ts`, plus route and nav keys.

## §8 Mock rules
- Doctor price beats base price; draft flags `priceMissing`.
- Every seeded branch has a prefix; number `PREFIX-YYYY-NNNNNN` per branch and clinic-timezone year, gap-free; no prefix ⇒ `invoice_prefix_missing`.
- One non-void invoice per appointment/visit ⇒ `invoice_already_exists`.
- Discount changes (old vs new compared) need `create:discounts:*`; `TotalsError` ⇒ `discount_exceeds_total` / `validation`.
- `version` starts 1, +1 on edit and void; no If-Match ⇒ `precondition_required`, stale ⇒ `version_conflict`; void refuses edits (`invoice_void`).
- Send: same id + invoice + channel ⇒ same notificationId; otherwise `send_request_conflict`; void ⇒ `invoice_void`.
- Prefix locked after a branch's first invoice; used now or before by another branch ⇒ `invoice_prefix_taken`.
- Platform currency ⇒ `currency_locked` once any price or invoice exists.
- Finance off ⇒ `module_disabled` on every finance call; own-reach doctor list copies the patients `own` scope; audit rows for issued/edited/voided and `clinic.finance_changed`.

## Tests (vitest, mock)
- `invoices/invoice-numbering.test.ts`, `invoice-issue-rules.test.ts`, `invoice-versioning.test.ts`, `invoice-send.test.ts`, `invoice-discount-permission.test.ts`, `invoice-own-reach.test.ts`, `invoice-totals-parity.test.ts` (E1–E6 table shared with the contracts' examples), `invoice-form-draft.test.ts`.
- `services/prices-mock.test.ts`, `settings/invoice-prefixes-mock.test.ts`, `settings/clinic-finance-mock.test.ts` (reg. no., logo type/size), `platform/clinics/platform-finance-mock.test.ts`, `shared/api/http/__tests__/http-finance.test.ts` (headers, Blob, safeParse), `roles` matrix test for the Finance group and `VIEWED_THROUGH`, module-disabled test.
- Done = web typecheck, lint 0 errors, full test run; Arabic/English at 390/1440 checked.

## Assumptions to confirm
- The demo clinic gets `finance: true` so the screens are visible in the preview (other maps stay false).
- No commits possible in this sandbox; root `pnpm` cannot run, so checks run inside `apps/web`.
