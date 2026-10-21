# Finance — design (post-MVP phase 4)

- Status: owner decisions taken 2026-10-14 (decisions page batches 10–13). F1 is implemented and in
  production (PRs 78, 84, 85, 87); F2 is designed in §4 and approved by the owner (SQL plan and F2-Q1 … F2-Q19, 2026-10-20), not built yet; F3 and F4 are outlines.
- PRD: §8.3 item 4 ("finance"), §4.7 (permissions), §4.8 (module flags), §4.11 (audit), §5 (database
  rules), §8 (security: the platform never sees patient data).
- Decision records: ADR-0033 (money, numbering and the invoice life cycle,
  `docs/adr/0033-f1-money-numbering-invoice-life-cycle.md`) and ADR-0034 (payments, refunds and the cash
  closing, with F2).
- Vocabulary: the Arabic UI says «فاتورة» (invoice), «إيصال» (receipt), «المراجع» (never «المريض»),
  «موظف الاستقبال». Amounts show with the clinic currency code, e.g. «12.500 د.ك».

## 1. Owner decisions (2026-10-14)

| #      | Question                          | Decision                                                                                                                                                                                                        |
| ------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FIN-A1 | Scope                             | All four parts, as four sub-phases: **F1** prices and invoices → **F2** manual payments → **F3** reports → **F4** online payment and insurance. Each has its own plan, PR and merge.                            |
| FIN-A2 | Currency                          | One currency per clinic, set by the platform when it creates the clinic; default KWD (3 decimals).                                                                                                              |
| FIN-A3 | Tax                               | One tax rate per clinic, set by the platform, default 0 %. The tax line shows only when the rate is above zero. No government e-invoicing now.                                                                  |
| FIN-A4 | Invoice numbers                   | A gap-free sequence per branch with a branch prefix: `SLM-2026-000123`. A voided invoice keeps its number.                                                                                                      |
| FIN-A5 | Editing an issued invoice         | **Editable at any time**; every edit is audited with before/after values. (The owner's choice over "lock after issue".)                                                                                         |
| FIN-A6 | Where an invoice comes from       | From an appointment or a visit (the patient, service and price are filled in), or manual. Never created automatically.                                                                                          |
| FIN-A7 | Discount                          | On a line or on the whole invoice, as a percentage or an amount, behind its own permission, with a written reason. No maximum.                                                                                  |
| FIN-A8 | Service price                     | A base price per service, plus an optional different price for a given doctor.                                                                                                                                  |
| FIN-1  | How it is built                   | Inside Eyadex, simple tables (a `billing` module); amounts as integers in the currency's smallest unit (fils). Not a double-entry ledger, not an external accounting product.                                   |
| FIN-2  | Module flag                       | A `finance` module the platform switches on per clinic, like `appointments` and `medical`.                                                                                                                      |
| FIN-3  | What the platform sees            | **Revenue totals only, with no patient names or invoice rows** (e.g. "this clinic invoiced 3,000 KWD this month"). Enforced by database grants: the platform reads an aggregate view, never the invoice tables. |
| FIN-4  | Default permissions (new clinics) | Receptionist: view/create/update invoices of their branches. Doctor: view the invoices of their own patients. Clinic admin: everything, including discount and void. Existing roles are not changed.            |
| FIN-5  | Sending to the patient            | Print / PDF, and a «ابعت» button that sends it by email or WhatsApp through the existing notifications.                                                                                                         |
| FIN-6  | Invoice header                    | Clinic name and logo; branch name, address and phone; commercial registration number (optional); bilingual (ar + en).                                                                                           |
| FIN-7  | Free lines                        | Allowed on any invoice: a typed description and price (e.g. a sunscreen sold at the desk).                                                                                                                      |
| FIN-8  | Void                              | Its own permission and a written reason; the voided invoice stays, with its number.                                                                                                                             |
| FIN-9  | No-show fee                       | Nothing automatic; a manual invoice if the clinic wants one.                                                                                                                                                    |
| FIN-10 | Packages                          | Later, in their own phase.                                                                                                                                                                                      |
| FIN-11 | Payment methods (F2)              | A fixed list: cash, KNET card terminal, bank transfer, other. Each clinic switches off the ones it does not use.                                                                                                |
| FIN-12 | Partial payment (F2)              | Allowed; the invoice shows "partly paid" and its balance.                                                                                                                                                       |
| FIN-13 | Paid more than the new total (F2) | The difference becomes the patient's credit, used on a later invoice or refunded on request.                                                                                                                    |
| FIN-14 | Refund (F2)                       | Its own permission, a reason and a method; a separate movement (the original payment is never deleted).                                                                                                         |
| FIN-15 | Cash closing (F2)                 | Daily per branch: expected cash vs counted, the difference, who closed and when.                                                                                                                                |
| FIN-16 | Receipt numbers (F2)              | A gap-free sequence per branch, like invoices (`SLM-R-2026-000045`, R1-9).                                                                                                                                      |
| FIN-17 | Deposit at booking                | Later, with online payment (F4).                                                                                                                                                                                |
| FIN-18 | Reports (F3)                      | Revenue by day/period, branch, doctor, service and method; outstanding balances; discounts; cash closings; Excel/CSV export.                                                                                    |
| FIN-19 | Doctor commission                 | Later, in its own phase.                                                                                                                                                                                        |
| FIN-20 | Online gateway (F4)               | **MyFatoorah, Tap and UPayments** behind one gateway port; each clinic picks one and uses its own merchant account. Money goes to the clinic, never through Eyadex.                                             |
| FIN-21 | Online payment use (F4)           | A payment link for an invoice sent by WhatsApp or email; the invoice updates itself when paid.                                                                                                                  |
| FIN-22 | Insurance (F4)                    | Insurers per clinic; the patient's policy (insurer, number, patient share %); the invoice split into patient share and insurer share; claims tracked by hand (sent, accepted, rejected, paid). No e-claims.     |
| FIN-23 | Competitor features               | Inventory, a dental chart and a clinic website become later phases in the PRD; their questions come when they start.                                                                                            |

## 2. Shared rules (every sub-phase)

- **Money:** every amount is a `bigint` count of the currency's minor unit (KWD: fils, 1 KWD = 1000).
  The clinic's `currency` (ISO 4217) and `currency_exponent` (KWD 3, SAR/AED 2) are fixed at creation
  and never change once the clinic has an invoice. No floating point anywhere: contracts carry minor
  units as integers; the web formats them.
- **Rounding:** percentages (discount, tax, insurer share) round half-up to the minor unit, per line,
  then the invoice total is the sum of its lines. One shared pure function computes totals; the API,
  the mock and the PDF all use it, so a printed total never differs from the stored one.
- **Module:** `finance` joins `CLINIC_MODULES` and requires `patients` (an invoice names a patient).
  Off ⇒ every finance route answers `module_disabled`, and prices are hidden on the services screen.
- **Platform (FIN-3):** no grant on any finance table. A `SECURITY DEFINER` function owned by a
  NOLOGIN role (the 0059 pattern) returns per-clinic monthly totals (invoiced, paid, refunded) to
  `eyadex_platform` only — no rows, no names, no counts per patient.
- **Audit:** every create, edit, discount, void (and in F2 every payment, refund and closing) writes
  an audit row with before/after amounts. Patient names never go into audit snapshots (the existing
  scrub applies); the invoice number and amounts do.

## 3. F1 — service prices and invoices (detailed)

### 3.1 Permissions (new resources; the catalogue grammar stays `action:resource:scope`)

| Resource    | Actions and scopes                                                                                             | Meaning                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `invoices`  | view `clinic`/`branch`/`own`; create `clinic`/`branch`; update `clinic`/`branch`; deactivate `clinic`/`branch` | `own` = invoices of the caller's own patients (A3 reach). `deactivate` = **void**. |
| `discounts` | create `clinic`/`branch`                                                                                       | Apply a discount on an invoice the caller can update.                              |
| `prices`    | view `clinic`; update `clinic`                                                                                 | Service prices and per-doctor prices.                                              |

New clinics: receptionist = view/create/update `invoices:branch`, `view:prices:clinic`; doctor =
`view:invoices:own`; clinic admin = the **seven clinic-scope** finance keys (`view`/`create`/`update`/
`deactivate:invoices:clinic`, `create:discounts:clinic`, `view`/`update:prices:clinic`), the same set an
existing locked admin receives (R2-4, §8c.3). Existing roles change only by the clinic admin's hand.

### 3.2 Data model (clinic tables: `clinic_id`, PK `(clinic_id, id)`, RLS enabled + forced, FKs indexed)

| Table / change                  | Columns                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clinics` (change)              | `currency char(3) NOT NULL DEFAULT 'KWD'`, `currency_exponent smallint NOT NULL DEFAULT 3`, `tax_rate_bp int NOT NULL DEFAULT 0` (basis points, 0–10000), `commercial_reg_no text NULL`, `logo_blob_key text NULL`. Existing clinics get KWD / 0 %.                                                    |
| `branches` (change)             | `invoice_prefix text NULL` (2–6 upper-case letters/digits, unique per clinic). An invoice cannot be issued in a branch without one; the admin sets it on the branch form.                                                                                                                              |
| `clinic_services` (change)      | `price_minor bigint NULL` (NULL = no price yet; ≥ 0).                                                                                                                                                                                                                                                  |
| `service_provider_prices` (new) | `service_id`, `member_id`, `price_minor`; unique `(clinic_id, service_id, member_id)`. Wins over the base price for that doctor.                                                                                                                                                                       |
| `invoice_sequences` (new)       | `branch_id`, `year`, `next_number`; one row per branch and year, taken `FOR UPDATE` inside the issuing transaction ⇒ gap-free.                                                                                                                                                                         |
| `invoices` (new)                | `branch_id`, `patient_id`, `number` (text, unique per clinic), `status` (`issued`/`void`), `source` (`appointment`/`visit`/`manual`), `source_id NULL`, `issued_at`, `currency`, `subtotal_minor`, `discount_minor`, `tax_rate_bp`, `tax_minor`, `total_minor`, `invoice_discount` (jsonb: `{kind: pct | amount, value, reason}`or NULL),`void_reason NULL`, `voided_at NULL`, `created_by`, `updated_at`. |
| `invoice_lines` (new)           | `invoice_id`, `position`, `kind` (`service`/`free`), `service_id NULL`, `provider_id NULL`, `description_ar`, `description_en`, `quantity` (1–999), `unit_price_minor`, `line_discount` (jsonb or NULL), `line_total_minor`.                                                                           |

- An appointment or visit may have **at most one** non-void invoice (partial unique index on
  `(clinic_id, source, source_id) WHERE status <> 'void'`), so the «فاتورة» button cannot bill twice.
- Invoices are **never deleted**; a void keeps the row, its number and its lines.
- FIN-A5: an issued invoice stays editable (lines, discounts, patient-facing fields); the number,
  branch, source and issue date never change. Each edit is one transaction: recompute totals with the
  shared function, write the audit row with before/after totals and changed lines.
- No invoice is issued with a total below zero; a 100 % discount gives a zero total, which is allowed.

### 3.3 API (REST under `/v1`, Zod contracts, error envelope, guards in CLAUDE.md §6 order)

| Route                                         | Permission                                                         | Notes                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /services/:id/price`                   | `update:prices:clinic`                                             | Base price; `{priceMinor}` or null.                                                                                              |
| `PUT /services/:id/provider-prices`           | `update:prices:clinic`                                             | The whole per-doctor list for one service.                                                                                       |
| `GET /invoices/draft?source=appointment&id=…` | `create:invoices:*`                                                | Pre-filled lines (service, doctor price, patient) — nothing is stored.                                                           |
| `POST /invoices`                              | `create:invoices:*` (+ `create:discounts:*` if a discount is sent) | `Idempotency-Key`; issues with the next branch number.                                                                           |
| `GET /invoices` / `GET /invoices/:id`         | `view:invoices:*`                                                  | Cursor list with filters: branch, patient, status, date range, number, and source + source id (owner 2026-10-15, F1-ADD-FILTER). |
| `PATCH /invoices/:id`                         | `update:invoices:*` (+ discounts)                                  | FIN-A5 edit; `If-Match` version so two desks cannot overwrite each other.                                                        |
| `POST /invoices/:id/void`                     | `deactivate:invoices:*`                                            | `{reason}` required.                                                                                                             |
| `GET /invoices/:id/pdf`                       | `view:invoices:*`                                                  | Bilingual PDF rendered by the API from the stored invoice (approved contract; D-P1 declined 2026-10-15).                         |
| `POST /invoices/:id/send`                     | `view:invoices:*`                                                  | `{channel: email                                                                                                                 | whatsapp}`; queues a `patient_notifications`row of a new kind`invoice` (the N1/N2 pipeline sends it with the PDF link). |
| `PATCH /clinic/settings/finance`              | `update:clinic_settings:clinic`                                    | Commercial registration number and logo upload (BlobStore, image ≤ 1 MB).                                                        |
| `GET /clinic/settings/finance`                | any member, finance on                                             | Currency, exponent, tax rate, CR number, `hasLogo` (owner 2026-10-15, F1-ADD-SETTINGS).                                          |
| Platform: clinic create/edit                  | platform                                                           | Currency, exponent and tax rate fields (currency locked once an invoice exists).                                                 |

Error codes (new): `price_missing` (a service line without a price), `invoice_prefix_missing`,
`invoice_already_exists` (source already billed), `invoice_void` (edit a void invoice),
`appointment_not_billable` (a draft or issue from a no-show or cancelled appointment; FIN-9),
`currency_locked`, `discount_reason_required`; `pdf_busy` (503 with `Retry-After: 2`, when the API's PDF
renderer is at capacity — owner 2026-10-15, F1-PDF-BUSY).

### 3.4 Web (Lovable; the mock mirrors every rule)

- **Settings → Services:** a price column and a «أسعار الدكاترة» dialog per service.
- **Settings → Clinic:** commercial registration number and logo. **Branch form:** the invoice prefix.
- **Appointment and visit pages:** a «فاتورة» button (hidden when one exists — then «عرض الفاتورة»).
- **Invoices list** (new nav item «الفواتير»): filters, status chips (issued / void), totals.
- **Invoice page:** lines, discounts (with reason), tax line only when > 0, total; edit, void, print,
  «ابعت». A banner on a void invoice. Every string ar + en; amounts with the clinic currency.
- **Platform clinic form:** currency and tax rate.

### 3.5 Tests that must exist

- Totals: rounding half-up per line, discount pct vs amount, tax only above 0, 100 % discount = 0,
  the same function in API and mock (one shared test table).
- Numbering: gap-free under two concurrent issues in one branch (DB test), per-branch and per-year.
- RLS negative tests for every new table; the platform reads only the totals function.
- Permissions: `own` reach for doctors; discount without `create:discounts` refused; void needs
  `deactivate`; module off ⇒ `module_disabled`.
- One non-void invoice per source; editing a void invoice refused; audit rows with before/after.

## 4. F2 — manual payments (detailed; approved by the owner 2026-10-20)

- Status: approved. On 2026-10-20 the owner approved the SQL plan of §4.5 (owner rule from PR #86) and
  decided every question of §4.10 (F2-Q1 … F2-Q19) as recommended, in his own words: «موافق على خطة SQL بتاعة
  F2 في PR 89، وكل الأسئلة F2-Q1 لحد F2-Q19 زي ترشيحك.» No rule of this section is left open.
- Decision record: ADR-0034 (`docs/adr/0034-payments-refunds-cash-closing.md`). ADR-0033 records F1's money and
  numbering (`docs/adr/0033-f1-money-numbering-invoice-life-cycle.md`); ADR-0034 cites §3, §8 and §8b for the F1 rules.
- F2 builds on F1 and **changes F1 code in one place**: the invoice edit and void (`InvoiceChanges`)
  release money that no longer fits the invoice into patient credit (R1-5, R2-2, §4.3).

### 4.1 Permissions (new resources; module `finance`)

| Resource        | Actions and scopes                               | Meaning                                                                                        |
| --------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `payments`      | view `clinic`/`branch`; create `clinic`/`branch` | Receipts and their movements; recording a payment and applying a patient credit to an invoice. |
| `refunds`       | create `clinic`/`branch`                         | Giving money back (FIN-14). No view of its own: `VIEWED_THROUGH.refunds = "payments"`.         |
| `cash_closings` | view `clinic`/`branch`; create `clinic`/`branch` | The daily cash closing of a branch (FIN-15).                                                   |

- **10 new keys**, catalogue ids `00000000-0000-7000-8000-0000000c0041` … `…c004a`, in `PERMISSION_CATALOG`
  order. No `own` scope: a doctor sees what is paid and owed on the invoice page through `view:invoices:own`
  (§4.6 `settlement`), never the receipts. The payment-methods setting uses the existing
  `update:clinic_settings:clinic`; no key is added for it.
- The **branch scope is the invoice's branch** for payments and refunds, and the closing's branch for cash
  closings: money is received in the invoice's branch (F2-Q8, owner decision 2026-10-20).
- Write-needs-view (roles.ts) holds: `create:payments` needs `view:payments`, `create:refunds` needs
  `view:payments` (through `VIEWED_THROUGH`), `create:cash_closings` needs `view:cash_closings`.
- New clinics (`system-roles.ts`, F2-Q15 (owner decision 2026-10-20)): receptionist = `view`/`create:payments:branch`,
  `view`/`create:cash_closings:branch`; doctor = nothing new; clinic admin = the **five clinic-scope** keys
  (`view`/`create:payments:clinic`, `create:refunds:clinic`, `view`/`create:cash_closings:clinic`).
- Existing clinics (R2-4 applied again): only each locked clinic-admin role gains the five clinic-scope keys
  (§4.5, 0067). No other existing role changes; the admin grants keys in the role editor.
- Code that moves with the keys: `resourceSchema`, the `permissionSchema` regex, `resourceGrants`,
  `VIEWED_THROUGH`, the written-out `PERMISSION_KEYS`, `system-roles.ts`, the web role matrix group
  «المالية», the mock's seed roles. The catalogue keys land in the same PR as 0064 (a test pins
  `PERMISSION_KEYS` to the seeded table).

### 4.2 Data model

Every new table is a clinic table: `clinic_id uuid NOT NULL`, primary key `(clinic_id, id)`, RLS enabled and
forced with the standard policy `clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid` (USING
and WITH CHECK), an index on every foreign key, ids are application UUID v7, timestamps `timestamptz`. Money is
`bigint` minor units with the currency and its exponent stored beside it, exactly like `invoices` (§2, R1-2);
on the wire it is a decimal integer string (`minorAmountSchema`). The rows a person reads as a document
(`payments`, `refunds`, `cash_closings`) store `currency` and `currency_exponent`; `payment_allocations`,
`patient_credits` and `refund_sources` take them from their invoice or payment, which is safe because a clinic
has one currency and it is locked once an invoice exists (R1-6, R2-3); settlement, conservation and audit read
the currency from the invoice or the payment.

**Money rows are append-only.** `payments`, `payment_allocations`, `patient_credits`, `refunds`,
`refund_sources` and `cash_closings` get `SELECT, INSERT` only — no `UPDATE`, no `DELETE`, for any role.
Nothing is ever overwritten: a correction is a new movement (§4.3). Only the counters and the settings row
(`receipt_sequences`, `branch_cash_drawers`, `clinic_payment_methods`) are updatable. Every table, these three
included, has an `id` column and the primary key `(clinic_id, id)`; their natural keys are `UNIQUE` constraints.

| Table (new)              | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clinic_payment_methods` | `method` (`cash`/`knet`/`bank_transfer`/`other`), `enabled boolean`, `created_at`, `updated_at`; `UNIQUE (clinic_id, method)`. FIN-11: the list is fixed in code; a clinic with **no row for a method has it enabled**, so existing clinics need no backfill. At least one method stays enabled (use case + `payment_methods_empty`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `receipt_sequences`      | `branch_id`, `series` (`receipt` or `refund`; refunds are numbered, F2-Q13 (owner decision 2026-10-20)), `year smallint`, `next_number int ≥ 1`; `UNIQUE (clinic_id, branch_id, series, year)`. R1-8/R1-9 recipe: `INSERT … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE`, inside the writing transaction ⇒ gap-free. A new table, not a column on F1's applied `invoice_sequences`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `payments`               | Money in. `branch_id`, `patient_id`, `invoice_id` (the invoice the receipt names), `year`, `receipt_seq int`, `receipt_number text` (`PREFIX-R-YYYY-NNNNNN`, R1-9), `method`, `amount_minor bigint > 0` (bounded by `bigint` and by `owed`, not by the 10¹² line cap: an invoice total may exceed it; R3-7), `currency`, `currency_exponent` (it follows the currency, CHECK), `reference text NULL` (≤ 60: a KNET approval code or a transfer reference; never in audit), `received_at`, `business_date date` (clinic-timezone day of `received_at`), `cash_seq bigint NULL` (§4.4; `CHECK ((method = 'cash') = (cash_seq IS NOT NULL))`), `received_by` (membership id, no FK, like `invoices.created_by`), `created_at`. `UNIQUE (clinic_id, receipt_number)`, `UNIQUE (clinic_id, branch_id, year, receipt_seq)`, `UNIQUE (clinic_id, branch_id, cash_seq)`, `UNIQUE (clinic_id, id, invoice_id, patient_id)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `payment_allocations`    | Money placed on an invoice. `invoice_id`, `patient_id`, exactly one funding source: `payment_id NULL` or `credit_id NULL` (`CHECK (num_nonnulls(payment_id, credit_id) = 1)`), `amount_minor > 0`, `created_by`, `created_at`. `UNIQUE (clinic_id, id, patient_id)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `patient_credits`        | Money released from an allocation and owed back to the patient (FIN-13). `patient_id`, `origin_allocation_id` (the allocation it came out of), `amount_minor > 0`, `cause` (`invoice_edited`/`invoice_voided`/`refund`), `created_by`, `created_at`. `UNIQUE (clinic_id, id, patient_id)`. Clinic-wide per patient (F2-Q7 (owner decision 2026-10-20)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `refunds`                | Money out (FIN-14). `branch_id`, `patient_id`, `invoice_id` (the invoice whose page the refund was made from), `year`, `refund_seq int NOT NULL` / `refund_number text NOT NULL` (`PREFIX-RF-YYYY-NNNNNN`, F2-Q13 (owner decision 2026-10-20)), `method`, `amount_minor > 0`, `currency`, `currency_exponent` (it follows the currency, CHECK), `reason text` (1–300; stored, audited as its length only), `refunded_at`, `business_date`, `cash_seq bigint NULL` (same CHECK as payments), `refunded_by`, `created_at`. `UNIQUE (clinic_id, refund_number)`, `UNIQUE (clinic_id, branch_id, year, refund_seq)`, `UNIQUE (clinic_id, branch_id, cash_seq)`, `UNIQUE (clinic_id, id, patient_id)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `refund_sources`         | Which credits a refund spent. `refund_id`, `credit_id`, `patient_id`, `amount_minor > 0`; `UNIQUE (clinic_id, refund_id, credit_id)`. `Σ amount = refunds.amount_minor` (use case + the 0066 check).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `branch_cash_drawers`    | One row per branch: `branch_id` (`UNIQUE (clinic_id, branch_id)`), `last_cash_seq bigint ≥ 0`, `last_closed_seq bigint ≥ 0` (`≤ last_cash_seq`), `last_closing_id uuid NULL` (the branch's latest closing; `FOREIGN KEY (clinic_id, branch_id, last_closing_id) REFERENCES cash_closings (clinic_id, branch_id, id)`, so it names a closing of this branch), `updated_at`. Created on first use (`INSERT … ON CONFLICT DO NOTHING`, then `FOR UPDATE`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `cash_closings`          | FIN-15. `branch_id`, `business_date` (clinic-timezone day of `closed_at`), `from_cash_seq bigint` (exclusive), `to_cash_seq bigint` (inclusive, `≥ from_cash_seq`), `expected_minor bigint` (may be negative: more cash refunded than received), `counted_minor bigint ≥ 0`, `difference_minor bigint GENERATED ALWAYS AS (counted_minor − expected_minor) STORED`, `method_totals jsonb` (per method `{inMinor, outMinor}` of the closing's `business_date`, read after the drawer lock; information only — a non-cash movement committing at that moment may be missing, and F3 never reads it, R3-8), `note text NULL` (≤ 300; required when the difference is not 0: `CHECK (difference_minor = 0 OR note IS NOT NULL)`, F2-Q11 (owner decision 2026-10-20); a closing is never edited or reopened), `previous_closing_id uuid NULL` (the branch's closing before this one; `FOREIGN KEY (clinic_id, branch_id, previous_closing_id) REFERENCES cash_closings (clinic_id, branch_id, id)` over a `UNIQUE (clinic_id, branch_id, id)`, so it can only name a closing of the same branch), `currency`, `currency_exponent`, `closed_by`, `closed_at`, `created_at`. `UNIQUE NULLS NOT DISTINCT (clinic_id, branch_id, previous_closing_id)` chains a branch's closings one after another, so a period with no cash (`from = to`) is allowed as often as needed (R3-3); one closing a branch a day, `UNIQUE (clinic_id, branch_id, business_date)` (F2-Q9 (owner decision 2026-10-20)). |

- **Patient consistency in the database.** 0064 adds `UNIQUE (clinic_id, id, patient_id)` and
  `UNIQUE (clinic_id, id, branch_id, patient_id, currency)` on `invoices`, and every money row references
  its parents through composite foreign keys that carry `patient_id`:
  `payments (clinic_id, invoice_id, branch_id, patient_id, currency) → invoices` and the same for `refunds`
  (money stays in the invoice's branch and currency, F2-Q8, EY-5.2);
  `payment_allocations (clinic_id, invoice_id, patient_id) → invoices` and
  `(clinic_id, payment_id, invoice_id, patient_id) → payments` (a payment-funded allocation stays on its
  payment's invoice, EY-5.1 (b)), `(clinic_id, credit_id,
patient_id) → patient_credits`, `patient_credits (clinic_id, origin_allocation_id, patient_id) →
payment_allocations`, `refund_sources (clinic_id,
refund_id, patient_id) → refunds` and `(clinic_id, credit_id, patient_id) → patient_credits`. Money can
  never move between two patients, whatever the code does.
- `branch_id` columns reference `branches (clinic_id, id)`; every `patient_id` also references
  `patients (clinic_id, id)` directly, and each of the six money tables gets a `(clinic_id, patient_id)` index for
  that foreign key (`payment_allocations`, `refunds` and `refund_sources` included).
- Indexes (all start with `clinic_id`). `db/tests/fk-indexes.sql` requires an index whose leading columns are
  exactly the foreign key's, in order, with no predicate, so each composite foreign key gets its own:
  `payments (clinic_id, invoice_id, patient_id)`, `(clinic_id, patient_id)`, `(clinic_id, branch_id,
business_date)`; `payment_allocations (clinic_id, invoice_id, patient_id)`, `(clinic_id, payment_id,
patient_id)`, `(clinic_id, credit_id, patient_id)`; `patient_credits (clinic_id, origin_allocation_id,
patient_id)`, `(clinic_id, patient_id)`; `refunds (clinic_id, invoice_id, patient_id)`, `(clinic_id,
branch_id, business_date)`; `refund_sources (clinic_id, refund_id, patient_id)` (the `UNIQUE (clinic_id,
refund_id, credit_id)` does not lead with `patient_id`), `(clinic_id, credit_id, patient_id)`;
  `cash_closings (clinic_id, branch_id, closed_at)` (the chain's `UNIQUE (clinic_id, branch_id,
previous_closing_id)` indexes its foreign key); `branch_cash_drawers (clinic_id, branch_id, last_closing_id)`; every `branch_id`
  foreign key by `(clinic_id, branch_id)` unless one of these already leads with it.
- No retention: financial rows are never purged (none joins the 0040 retention functions).

### 4.3 The settlement model (pure functions, one shared module)

Money is a set of movements; every balance is **derived** (R1-4), never stored. The pure functions live in
`packages/contracts/src/settlement.ts`, beside `invoice-totals.ts`, and the API, the mock and the receipt use
the same ones; the table below is their shared test fixture. Definitions, per patient:

- `live(a) = a.amount − Σ credits whose origin is a` (an allocation shrinks only by releasing into a credit)
- `paid(i) = Σ live(a)` over the invoice's allocations
- `owed(i) = total(i) − paid(i)` for an issued invoice; a void invoice owes 0
- `remaining(c) = c.amount − Σ allocations funded by c − Σ refund_sources from c`
- `credit balance(patient) = Σ remaining(c)`

Invariants (checked by the use cases, asserted by tests, and re-checked at commit by 0066):

1. `live(a) ≥ 0` for every allocation; `remaining(c) ≥ 0` for every credit.
2. A payment is fully allocated when it is written: `Σ allocations funded by p = p.amount` (F2-Q1 keeps
   overpayment out).
3. Issued invoice: `0 ≤ paid(i) ≤ total(i)`. Void invoice: `paid(i) = 0`.
4. Conservation: `Σ payments = Σ paid(i) + Σ remaining(c) + Σ refunds`, per patient.
5. Every row of one chain names the same patient (the composite foreign keys of §4.2).

**Derived invoice state** (`settlement.state`), for issued invoices only: `unpaid` (`paid = 0` and
`owed > 0`), `partly_paid` (`0 < paid < total`), `paid` (`owed = 0`, including a zero-total invoice). A void
invoice has no settlement state. **R1-4's `credit` is a patient state, not an invoice state**: R1-5 moves the
excess off the invoice at the moment the total drops, so an invoice never holds more than its total; the UI
shows «رصيد للمراجع» from the patient's credit balance (R3-9, §8d).

**Operations** (each one transaction, under the locks of §4.4):

- **Record a payment** (money in): one payment, one method, one receipt, one invoice (F2-Q2,
  F2-Q3 (owner decision 2026-10-20)). `amount ≤ owed(i)` (`payment_exceeds_balance`, F2-Q1); `owed(i) > 0` (`invoice_settled`). It writes
  the payment and one allocation of the full amount.
- **Apply credit** (FIN-13 "used on a later invoice"): an explicit action (F2-Q6 (owner decision 2026-10-20)),
  `amount ≤ min(credit balance, owed(i))`. Credits are spent oldest first (`created_at`, then `id`); each
  writes an allocation funded by that credit. No receipt: no money came in.
- **Edit lowers the total** (F1 edit, R1-5): `excess = paid(i) − newTotal`; if `excess > 0`, release it from
  the invoice's live allocations **newest first** (`created_at` desc, then `id` desc), each release a
  `patient_credits` row (`cause = invoice_edited`, `origin_allocation_id`). Raising the total only raises
  `owed`; it never re-takes a credit (R1-5).
- **Void** (F1 void, R2-2): release every live allocation (`cause = invoice_voided`). Money already refunded
  left through a credit, so it is never released twice; a credit already spent on another invoice is not
  touched.
- **Refund from a payment** (FIN-14, "the original payment is never deleted"): `amount ≤ live` allocations of
  that payment on this invoice (`refund_exceeds_available`). In one transaction it releases that amount
  (`cause = refund`, newest allocation first) and refunds it from the new credit. The invoice owes that
  amount again — this is also how a mistaken entry is corrected (F2-Q12 (owner decision 2026-10-20)).
- **Refund from credit**: `amount ≤ credit balance`; credits spent oldest first through `refund_sources`.
- The refund's method may be any enabled method (F2-Q5 (owner decision 2026-10-20)); a cash refund is a cash movement.

Worked examples (KWD, amounts in fils), asserted by the shared test:

| #   | Start                        | Operation                       | Movements written                                                       | Invoice after                       | Patient credit |
| --- | ---------------------------- | ------------------------------- | ----------------------------------------------------------------------- | ----------------------------------- | -------------- |
| S1  | I1 total 10000, nothing paid | pay 4000 cash                   | P1 4000 (`R-…000001`), A1 P1→I1 4000                                    | paid 4000, owed 6000, `partly_paid` | 0              |
| S2  | after S1                     | pay 6000 KNET                   | P2 6000 (`R-…000002`), A2 P2→I1 6000                                    | paid 10000, owed 0, `paid`          | 0              |
| S3  | after S2                     | edit I1 to 7000                 | C1 3000 from A2 (`invoice_edited`); A2 live 3000                        | paid 7000, owed 0, `paid`           | 3000           |
| S4  | after S3                     | edit I1 to 9000                 | none                                                                    | paid 7000, owed 2000, `partly_paid` | 3000           |
| S5  | after S4; I2 total 5000      | apply credit 3000 to I2         | A3 C1→I2 3000                                                           | I2 paid 3000, owed 2000             | 0              |
| S6  | after S5                     | void I2                         | C2 3000 from A3 (`invoice_voided`)                                      | I2 void, paid 0                     | 3000           |
| S7  | after S6                     | refund 3000 from credit, bank   | F1 3000, F1←C2 3000                                                     | —                                   | 0              |
| S8  | after S7                     | refund 1000 from P1 on I1, cash | C3 1000 from A1 (`refund`), F2 1000, F2←C3 1000                         | I1 paid 6000, owed 3000             | 0              |
| S9  | I3 total 5000, owed 5000     | pay 6000                        | refused `payment_exceeds_balance` (F2-Q1)                               | unchanged                           | —              |
| S10 | after S8                     | refund 4000 from P1 on I1       | refused `refund_exceeds_available` (P1's live allocation on I1 is 3000) | unchanged                           | —              |
| S11 | I4 total 0 (100 % discount)  | pay 1                           | refused `invoice_settled`                                               | `paid`                              | —              |

Conservation after S8: payments 10000 = paid (I1 6000 + I2 0) + credit 0 + refunds (3000 + 1000) = 10000.

### 4.4 Concurrency and locks

- **One patient lock serialises a patient's money** (R1-5, R2-8): every payment, credit use, refund, edit and
  void locks the patient row `FOR NO KEY UPDATE` (`BillingPatientReader.lockForInvoice`, as F1 does), then the
  invoice row(s) `FOR UPDATE` by id ascending, and reads every balance **after** the locks. One payment names
  one patient, so this lock is enough for invoices, allocations and credits.
- **The cash drawer serialises a branch's cash.** Every cash payment and cash refund locks the branch's
  `branch_cash_drawers` row `FOR UPDATE`, takes `cash_seq = last_cash_seq + 1` and stores it on the movement.
  A closing locks the same row and covers exactly `(last_closed_seq, to_cash_seq]`, then sets
  `last_closed_seq`. A cash movement is therefore in exactly one closing, whatever the clocks say: nothing
  escapes, nothing counts twice, and money after a closing goes to the next day's closing (F2-Q9 (owner decision 2026-10-20)).
- **Positions in the ADR-0027 list** (proposed here; the SQL/API slice inserts them into ADR-0027 in the same
  PR, as ADR-0027 requires): after item 7 (patient row) comes **7a — invoice rows, by id ascending**; after
  item 9 (branch row) come **9a — the branch's `branch_cash_drawers` row**, **9b — the branch's
  `invoice_sequences` row** (F1) and **9c — the branch's `receipt_sequences` row**. Before item 1 comes
  **0 — the `clinic_idempotency_keys` claim**: F1 already takes it first, and it is a row of its own key that no
  other path locks. Paths:
  - payment: 0 → 7 → 7a → 9 (`FOR SHARE`, reads the prefix) → 9a (cash only) → 9c;
  - credit use: 0 → 7 → 7a; edit and void (with releases): 7 → 7a, as in F1;
  - refund: 0 → 7 → 7a → 9 (`FOR SHARE`) → 9a (cash only) → 9c (the refund series, F2-Q13);
  - cash closing: 0 → 9 (`FOR SHARE`) → 9a. It takes no patient lock, so it never waits on a payment that holds
    one while that payment waits on it in the other order.
  - F2's rows reference no membership (`received_by`, `refunded_by`, `closed_by` have no foreign key), so no
    implicit membership lock follows the branch row. F1's issue and edit do take one through their lines;
    slice 4 fixes that order (R3-4).
- **A payment does not bump `invoices.version`.** The invoice row is not changed (the money lives in other
  tables), so an open edit form is not invalidated by a payment; the edit re-reads `paid` after its locks and
  releases any excess (R1-5). `If-Match` stays on edit and void only.
- **The closing confirms what was counted.** The preview returns `previousClosingId` and `throughCashSeq`; the
  close request sends both back, and if either moved since (a cash movement arrived, or another closing
  committed), the close answers `cash_drawer_changed` (409) and the screen re-previews (R3-3). Counted money is never matched against a list the user did not see.
- **Time is read after the locks** (the injected `Clock`): `received_at`, `business_date` and the receipt
  year come from the moment the locks are held. `business_date` and the year are the clinic-timezone day and
  year (R1-8).
- **Idempotency** (`clinic_idempotency_keys`, the F1 recipe): `POST` payment, credit use, refund and closing
  require `Idempotency-Key`; scopes `payment:create:<userId>`, `credit:apply:<userId>`,
  `refund:create:<userId>`, `cash_closing:create:<userId>`. The request hash covers the operation, the target
  in the path (`invoiceId`) and the body, so the same key and body on another invoice is
  `idempotency_conflict`, never a replay of the first (R3-6). A replay returns the first result without taking a
  number, and only while its branch is still in the caller's reach.

### 4.5 SQL plan (approved by the owner 2026-10-20, 0066 kept: F2-Q17 = (أ))

| File                                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0064_finance_payments_core.sql`      | Extends `permissions_key_check` (resources `payments`, `refunds`, `cash_closings`) and inserts the 10 keys (ids `…c0041`–`…c004a`). Creates the nine tables of §4.2 with checks, composite foreign keys, indexes, RLS enabled + forced + the standard policy. Adds `UNIQUE (clinic_id, id, patient_id)` and `UNIQUE (clinic_id, id, branch_id, patient_id, currency)` on `invoices`. Grants: `eyadex_app` `SELECT, INSERT` on the six money tables, `SELECT, INSERT` and column-level `UPDATE` of the counters and the method switch on the three counters/settings (PR #92 review); `REVOKE ALL … FROM eyadex_platform` on all nine. Audit: `audit_log_patient_events_are_patient_access` gains `payment`, `refund`, `patient_credit`; `platform_clinic_admin_audit` and the policies `audit_log_platform_admin_rows` / `audit_log_platform_admin_insert` also exclude `payment`, `refund`, `patient_credit` and `cash_closing` (FIN-3: the platform sees finance only as totals). `payment_methods` stays visible: it is an administrative clinic setting about no patient (AGENTS.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `0065_finance_platform_totals_v2.sql` | FIN-3 + R1-17: `DROP FUNCTION finance_monthly_totals(uuid)` and `CREATE` it again returning `(month, invoiced_minor, currency, collected_minor, refunded_minor)` — the existing names stay, so the running API keeps working when SQL ships first. `collected` = Σ payments by the clinic-timezone month of `received_at`; `refunded` = Σ refunds by `refunded_at`. Credit uses are not collected money. Column grants to `eyadex_finance_totals_owner` (`payments`: `clinic_id, received_at, amount_minor, currency`; `refunds`: `clinic_id, refunded_at, amount_minor, currency`) and its `USING (true)` read policies (the 0061 pattern); `EXECUTE` to `eyadex_platform` only. No patient column is granted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `0066_finance_money_invariants.sql`   | Defence in depth for §4.3 (R3-1, R3-2): `DEFERRABLE INITIALLY DEFERRED` constraint triggers on `payments`, `payment_allocations`, `patient_credits`, `refunds`, `refund_sources` (insert) and `invoices` (update of `total_minor` or `status`) call `finance_check_patient(clinic_id, patient_id)` with the **row's** clinic and patient. The function is `SECURITY DEFINER`, owned by its own NOLOGIN, NOBYPASSRLS role with column grants and role-wide read policies on the money tables and on `invoices` (`clinic_id, id, status, total_minor` — not `patient_id`: it reaches the patient's invoices through their allocations) only (the 0059/0061 pattern; it reads `patient_id` only on the F2 movement tables, to group them, and no column of `patients`), because `withTenant` clears `app.clinic_id` before `COMMIT` and an invoker would see no rows. It re-computes invariants 1–4 for that patient, checks `Σ refund_sources = refunds.amount_minor` for each refund of the patient, proves each branch's cash numbers disjoint and contiguous and each receipt and refund number gap-free per branch, series and year, matching `receipt_sequences.next_number − 1` and built from the prefix, the year and the sequence (EY-5.2, PR #92 review), takes one clinic-wide advisory lock and requires READ COMMITTED, and raises `finance_invariant` on any breach; it returns nothing. After it is created and given to its owner, the migration runs `REVOKE ALL ON FUNCTION finance_check_patient(uuid, uuid) FROM PUBLIC` and grants `EXECUTE` to no role; the triggers are created by the migration (owner role), so no runtime role can call the function directly. A bug then fails the transaction instead of storing wrong money. (F2-Q17 (owner decision 2026-10-20): kept.) |
| `0067_finance_payments_release.sql`   | R2-4 again: the exact role statement of 0063 (`module = 'finance' AND scope = 'clinic'`, locked `clinic_admin` only, `ON CONFLICT DO NOTHING`), so each existing locked admin gains the five new clinic-scope keys and nothing else. No `finance` flag changes; the new-clinic default stays off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

- **Deploy order:** SQL first (0064–0067, after a backup), then the API, then the web. The new tables are
  unused until the API ships; 0065 keeps the old column names; 0066 holds trivially while no payment exists.
- **Catch-up for clinics created between the SQL and the API deploy:** `db/maintenance/finance-release-catch-up.sql`
  is already 0063's statement, which by its predicate also grants the F2 clinic-scope keys; it is reused as is.
  `db/tests/finance-release-catch-up.sh` gains a second `cmp` against 0067.
- **Negative tests (same PR as the SQL):**
  - `db/tests/rls-isolation.sql`: the nine tables join the per-clinic seed loop (two clinics, one row each:
    a payment with its allocation, a credit, a refund with its source, a drawer, a closing, a receipt
    sequence, a method row), the read-leak array, the write-leak `INSERT` blocks (one per table, expecting
    `insufficient_privilege` or `check_violation`), and the move-row `UPDATE clinic_id` array for the three
    updatable tables; a new block proves `UPDATE` and `DELETE` are refused on the six append-only tables.
  - `db/tests/finance.sql`: the exact finance key set grows from 13 to 23 (ids `0x34`–`0x4a`); new checks:
    a payment cannot name another patient's invoice (composite FK), an allocation with both or neither funding
    source is refused, `cash_seq` is required exactly for cash, a duplicate receipt or refund number is refused,
    `difference_minor` is computed, and 0066 rejects, at commit through the real `withTenant`, an over-allocation, a refund with no source and a refund whose sources do not sum to its amount, while a correct transaction commits.
  - `db/tests/finance-payments-platform.sql` (new): `eyadex_platform` has no privilege on any of the nine
    tables, reads the four patient-linked or money entity types (`payment`, `refund`, `patient_credit`, `cash_closing`)
    through neither the view nor the policy while `payment_methods` rows stay visible, and gets
    `collected`/`refunded` from `finance_monthly_totals` with no patient column reachable; the totals owner
    has only the granted columns; the 0066 check owner reads exactly its listed columns, no `invoices.patient_id`
    and nothing of `patients` (the 0061 rule `finance.sql` already asserts for the totals owner).
  - `db/tests/finance-release.sql`: its existing 0063 block replays 0063 on the full baseline, whose predicate
    now also matches the five F2 keys, so its "seven keys" and "13 rows added" assertions become "every
    clinic-scope finance key" (12) and the matching row count; after 0067 a locked admin holds all 12; a
    receptionist, doctor or custom role gains nothing.
  - `db/tests/fk-indexes.sql` passes with every new foreign key indexed.

### 4.6 API (REST under `/v1`, Zod contracts, error envelope, guards in CLAUDE.md §6 order)

Guards, in order, on every route: active user → clinic access (not suspended, not expired) → modules
`finance` and `patients` enabled → the role holds the key → branch scope (the invoice's branch, or the
closing's branch) → `not_found` outside the reach (ISO-02). Amounts are decimal strings of minor units.

| Route                                          | Permission                      | Notes                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /clinic/settings/finance`                 | any member, finance on          | Gains `paymentMethods: [{method, enabled}]` (all four, in the fixed order).                                                                                                                                                                |
| `PUT /clinic/settings/payment-methods`         | `update:clinic_settings:clinic` | The whole list; at least one enabled (`payment_methods_empty`). Audited (`payment_methods`, administrative).                                                                                                                               |
| `GET /invoices/:id`, `GET /invoices`           | `view:invoices:*`               | Each invoice gains `settlement: {state, paidMinor, owedMinor} \| null` (null when void). The list gains a `settlement` filter (`unpaid`/`partly_paid`/`paid`).                                                                             |
| `GET /invoices/:id/payments`                   | `view:payments:*`               | The invoice's receipts, allocations (payment or credit), releases and refunds, oldest first, plus the patient's credit balance.                                                                                                            |
| `POST /invoices/:id/payments`                  | `create:payments:*`             | `Idempotency-Key`. `{method, amountMinor, reference?}` → the payment with its receipt number. Refuses a disabled method, a void or settled invoice, an amount above `owed`.                                                                |
| `POST /invoices/:id/credit-applications`       | `create:payments:*`             | `Idempotency-Key`. `{amountMinor}` → the new allocations and the settlement.                                                                                                                                                               |
| `POST /invoices/:id/refunds`                   | `create:refunds:*`              | `Idempotency-Key`. `{source: "payment", paymentId, amountMinor, method, reason}` or `{source: "credit", amountMinor, method, reason}`. The refund's branch is the invoice's branch (works on a void invoice too, for its released credit). |
| `GET /payments`, `GET /payments/:id`           | `view:payments:*`               | Cursor list; filters: branch, method, business date range, patient, invoice, receipt number.                                                                                                                                               |
| `GET /payments/:id/pdf`                        | `view:payments:*`               | The bilingual receipt, rendered like the invoice PDF (`pdf_busy` applies). F2-Q14 (owner decision 2026-10-20).                                                                                                                             |
| `GET /refunds`, `GET /refunds/:id`             | `view:payments:*`               | Cursor list; filters: branch, method, business date range, patient, invoice.                                                                                                                                                               |
| `GET /cash-closings/preview?branchId=`         | `create:cash_closings:*`        | Nothing stored. `{previousClosingId, fromCashSeq, throughCashSeq, expectedMinor, cashInMinor, cashOutMinor, methodTotals, movements[]}`. `expectedMinor` is a signed amount (R3-5).                                                        |
| `POST /cash-closings`                          | `create:cash_closings:*`        | `Idempotency-Key`. `{branchId, previousClosingId, throughCashSeq, countedMinor, note?}`.                                                                                                                                                   |
| `GET /cash-closings`, `GET /cash-closings/:id` | `view:cash_closings:*`          | Cursor list by branch and date range; the detail lists the period's cash movements (receipt or refund numbers, amounts; no patient names).                                                                                                 |
| Platform: clinic finance totals                | platform                        | Gains `collectedMinor` and `refundedMinor` per month (0065; `platformFinanceTotalsSchema`).                                                                                                                                                |

- **Audit** (`writeFinanceAudit`, one row per operation, same transaction): `payment.recorded`,
  `credit.applied`, `credit.released` (one row per release, from the edit or void that caused it, besides the
  invoice's own row), `refund.recorded` (entities `payment`, `patient_credit`, `refund`, all `patient_access`);
  `cash_closing.closed` (`administrative`, excluded from the platform by 0064) and `payment_methods.changed`
  (`administrative`, visible to the platform like other clinic settings).
  `FinanceAuditEntity` and `finance-audit-snapshot.ts` gain snapshot schemas that whitelist ids, receipt and
  invoice numbers, method, amounts, currency, cash sequence numbers and the closing's expected/counted/
  difference — never a patient name, a `reference`, a refund `reason` or a closing `note` (their length only,
  as `reasonLength`/`noteLength`).
- **Reads name the patient as F1 does** (§8c item 4): receipt and refund lists show the patient's display
  name inside the caller's reach, read in one batch through `BillingPatientReader.displayNames`, with no
  `patient_access` audit row. Cash closing screens show no patient names.

Error codes (new; `apps/api/src/shared/errors.ts`, `packages/contracts/src/common.ts`, web `ar.ts`/`en.ts`):

| Code                       | HTTP | `message_ar`                                             | `message_en`                                              |
| -------------------------- | ---- | -------------------------------------------------------- | --------------------------------------------------------- |
| `payment_method_disabled`  | 409  | طريقة الدفع دي مقفولة في إعدادات العيادة.                | This payment method is turned off in the clinic settings. |
| `payment_exceeds_balance`  | 409  | المبلغ أكبر من المتبقي على الفاتورة.                     | The amount is more than the invoice still owes.           |
| `invoice_settled`          | 409  | الفاتورة مدفوعة بالكامل.                                 | The invoice is already fully paid.                        |
| `credit_insufficient`      | 409  | رصيد المراجع أقل من المبلغ المطلوب.                      | The patient's credit is less than the amount.             |
| `refund_exceeds_available` | 409  | المبلغ أكبر من المتاح للاسترداد.                         | The amount is more than can be refunded.                  |
| `payment_methods_empty`    | 400  | لازم طريقة دفع واحدة على الأقل تفضل شغالة.               | At least one payment method must stay on.                 |
| `cash_drawer_changed`      | 409  | فيه حركة نقدية جديدة من وقت المعاينة. راجع الإقفال تاني. | Cash moved since the preview. Review the closing again.   |
| `cash_closing_exists`      | 409  | الفرع ده اتقفل صندوقه النهارده.                          | This branch's cash is already closed for today.           |
| `closing_note_required`    | 400  | اكتب ملاحظة لما يكون فيه فرق.                            | Write a note when there is a difference.                  |

`invoice_void`, `invoice_prefix_missing`, `idempotency_conflict`, `validation` and `forbidden` are reused.
`cash_closing_exists` follows F2-Q9 and `closing_note_required` follows F2-Q11 (owner decisions 2026-10-20).

### 4.7 Web (Lovable, branch `lovable`; the mock mirrors every rule above, in the same order)

Arabic first, RTL, logical CSS, every string ar + en, «المراجع» never «المريض», «موظف الاستقبال» never
«كاشير». Amounts with the clinic currency («12.500 د.ك»), entered in major units through `parseMajorToMinor`,
shown through `formatMinor`; never a JS `number`. Each screen has loading, empty and error states, and works at
1440px and 390px.

- **Invoice page — «الدفع» panel** (needs `view:invoices`): the total, «المدفوع», «المتبقي», a state chip
  («غير مدفوعة» / «مدفوعة جزئيًا» / «مدفوعة»; none on a void invoice). With `view:payments`: the receipts
  list (number, date, method, amount, received by), the releases into credit and the refunds, and
  «رصيد المراجع» when the patient has credit.
  - «تسجيل دفعة» (`create:payments`, issued invoice with `owed > 0`): a dialog with the enabled methods, the
    amount prefilled with `owed`, an optional reference; after success, «طباعة الإيصال».
  - «استخدام الرصيد» (`create:payments`, credit > 0, `owed > 0`): the amount prefilled with the smaller of the
    two.
  - «استرداد» (`create:refunds`): on a receipt row (refund from that payment) and on the credit card (refund
    from credit). The dialog: amount, method, a required reason, and a warning when refunding a payment makes
    the invoice owe again.
  - A void or an edit that lowers a paid invoice warns first: «المبلغ الزيادة هيتحول رصيد للمراجع».
- **Invoices list:** a settlement column (chip) and filter.
- **Receipt** (`/receipts/:id`): the receipt view with print / PDF (F2-Q14).
- **«المدفوعات»** (new tab beside «الفواتير», `view:payments`): receipts and refunds lists with filters
  (branch, method, date, patient).
- **«إقفال الصندوق»** (new nav item, `view:cash_closings`): the branch picker (the caller's reach), the period
  since the last closing, cash in / cash out / expected, the totals of other methods for information, the
  counted amount, the difference shown live (green at 0, amber otherwise), the note, «إقفال الصندوق»
  (`create:cash_closings`). `cash_drawer_changed` reloads the preview with a message. A history list and a
  closing detail page.
- **Settings → Clinic → «طرق الدفع»** (`update:clinic_settings`): four switches (كاش، كي نت، تحويل بنكي،
  أخرى); the last one on cannot be switched off.
- **Role editor:** the «المالية» group gains «المدفوعات», «الاسترداد», «إقفال الصندوق».
- **Audit labels:** ar + en for the six new actions of §4.6.
- **Platform clinic page:** the monthly totals table gains «المحصّل» and «المسترد».

### 4.8 Tests that must exist

- **Shared settlement test** (`packages/contracts`): every row of the §4.3 table, the release order (newest
  allocation first), credit spending order (oldest first), conservation after every step, zero-total invoices,
  bigint bounds; the mock and the API import the same functions.
- **Receipt numbering** (DB): gap-free under two concurrent payments in one branch; per branch, series and
  clinic-timezone year; a rolled-back payment returns its number; a replayed `Idempotency-Key` takes none.
- **Concurrency** (DB): a payment and an edit on the same invoice at once (R2-8); two payments racing the last
  `owed` (one wins, one gets `payment_exceeds_balance`); a cash payment racing a closing (the payment lands in
  this closing or the next, never in none); a closing whose preview went stale gets `cash_drawer_changed`; two closings in a row with no cash between them both succeed; the same `Idempotency-Key` and body on another invoice is `idempotency_conflict`.
- **F1 changes:** lowering a paid invoice releases newest first into credit; raising it does not re-take
  credit; voiding releases everything, never money already refunded, never a credit spent elsewhere; the edit
  and void audit rows plus one `credit.released` row per credit.
- **Permissions:** each route without its key is `forbidden`; a branch-scoped receptionist gets `not_found`
  for another branch's invoice, receipt, refund and closing; a refund without `create:refunds` is refused even
  with `create:payments`; module off is `module_disabled`; a doctor with `view:invoices:own` sees `settlement`
  but not `GET /invoices/:id/payments`.
- **RLS and grants:** the SQL tests of §4.5; integration tests connect as `eyadex_app` (tenant paths) and
  `eyadex_platform` (totals), never as the owner.
- **Audit:** snapshots carry amounts and numbers whole and never a name, reference, reason or note; the
  platform sees none of the new rows.
- **Web (vitest on the mock):** every refusal of §4.6 in the same order; amounts round-trip in KWD (3) and SAR
  (2); the state chip from the shared function; the closing difference, including a shortage and a negative
  expected amount (`formatSignedMinor`).

### 4.9 Slices and delivery (each PR about 3,000 changed lines, one merge each, owner's yes before each)

| #   | Slice                                    | Who                      | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Contracts                                | Codex (gpt-6.1-sol high) | Zod schemas of §4.6, the error codes, `paymentMethodSchema`, settlement/refund/closing shapes, `signedMinorAmountSchema` and `formatSignedMinor` (R3-5), the platform totals addition. No keys yet (they move with the SQL).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | SQL + RLS + negative tests               | Codex                    | 0064–0067 (as approved), the permission keys in contracts and `system-roles.ts`, `db/tests` of §4.5, the catch-up `cmp`, ADR-0027's new positions 0, 7a, 9a, 9b, 9c. **Required, from the PR #89 review:** (1) bounds on `counted_minor` and `expected_minor` (contract and `CHECK`) so `difference_minor = counted − expected` always fits `bigint`, with a boundary test; (2) 0066 also proves that a branch's `cash_seq` values across `payments` and `refunds` are disjoint and contiguous up to `branch_cash_drawers.last_cash_seq`, with a test; (3) F2-Q19: `cash_closing` stays out of the platform's clinic audit view and policies, with a negative test. Applied to staging; production only after the owner's yes and a backup. |
| 3   | Domain                                   | Codex                    | `packages/contracts/src/settlement.ts` and its fixture test (§4.3), `billing/domain` rules (method enabled, receipt format, closing period), the F1 edit/void release.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4   | API — payments and credit                | Codex                    | Payment methods setting, settlement on invoice reads, record payment, credit use, receipts list/detail, audit snapshots, their db specs; F1's issue and edit lock the line doctors' memberships first (R3-4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | API — refunds, closings, receipt, totals | Codex                    | Refunds, cash closing preview/close/list, receipt PDF, platform totals v2, their db specs. `CLAUDE.architecture.md` §2.2 billing row updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 6   | Lovable web brief                        | Orchestrator → Lovable   | `.lovable/plan/p4-f2-web-<date>.md`, sent in Plan mode first; Lovable builds §4.7 and the mock on `lovable`, probably in two PRs (payments + refunds; closings + settings).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | Review loop, staging, production         | Orchestrator             | Codex bot + MergePilot on every PR, at most 3 fix rounds, blocking findings only; each slice tried on staging against the real API; SQL first in production, backup first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### 4.10 Owner decisions (2026-10-20) — the money rules the FIN decisions did not settle

المالك وافق يوم 2026-10-20 على الاختيار المقترح في كل سؤال (F2-Q1 لحد F2-Q19)، بكلامه: «موافق على خطة SQL
بتاعة F2 في PR 89، وكل الأسئلة F2-Q1 لحد F2-Q19 زي ترشيحك.» القرار مكتوب في آخر كل سؤال.

1. **F2-Q1 — المراجع دفع أكتر من المتبقي على الفاتورة عند الاستقبال:** (أ) نرفض، والموظف يسجّل المبلغ
   المتبقي بس والباقي يرجع فكة في إيده؛ (ب) نقبل والزيادة تبقى رصيد للمراجع. **القرار (المالك، 2026-10-20): (أ)** — الرصيد
   في FIN-13 جاي من تعديل الفاتورة بس، والعربون مؤجل لـ F4 (FIN-17).
2. **F2-Q2 — دفعة واحدة لأكتر من فاتورة:** (أ) كل دفعة لفاتورة واحدة؛ (ب) دفعة واحدة تتوزع على كذا فاتورة
   لنفس المراجع. **القرار (المالك، 2026-10-20): (أ) في F2**، والداتابيز بتفرض إن التخصيص الممول من دفعة يروح لفاتورة الدفعة
   نفسها (EY-5.1 (ب)، المالك 2026-10-20)؛ دفعة واحدة لأكتر من فاتورة بعدين = migration صغيرة.
3. **F2-Q3 — الدفع بأكتر من طريقة (جزء كاش وجزء كي نت):** (أ) دفعتين وإيصالين؛ (ب) إيصال واحد فيه سطرين.
   **القرار (المالك، 2026-10-20): (أ)** — أبسط، وكل إيصال بطريقة واحدة بيسهّل الإقفال.
4. **F2-Q4 — الاسترداد بييجي منين:** (أ) من رصيد المراجع، أو من دفعة على فاتورة (والفاتورة ترجع عليها
   فلوس)؛ (ب) من الرصيد بس (لازم تعدّل أو تلغي الفاتورة الأول). **القرار (المالك، 2026-10-20): (أ)**.
5. **F2-Q5 — طريقة الاسترداد:** (أ) أي طريقة شغالة في العيادة؛ (ب) لازم نفس طريقة الدفعة الأصلية.
   **القرار (المالك، 2026-10-20): (أ)** — ونوضّح إن الاسترداد الكاش بيطلع من صندوق الفرع ده.
6. **F2-Q6 — استخدام رصيد المراجع في فاتورة جديدة:** (أ) بزرار «استخدام الرصيد» يدوي؛ (ب) تلقائي أول ما
   الفاتورة تتعمل. **القرار (المالك، 2026-10-20): (أ)**.
7. **F2-Q7 — الرصيد على مستوى إيه:** (أ) رصيد واحد للمراجع في العيادة كلها (أي فرع)؛ (ب) لكل فرع لوحده.
   **القرار (المالك، 2026-10-20): (أ)**.
8. **F2-Q8 — الدفعة بتتسجل في أنهي فرع:** (أ) فرع الفاتورة دايمًا (وإيصالها بكود الفرع ده)؛ (ب) فرع
   الموظف اللي استلم. **القرار (المالك، 2026-10-20): (أ)**.
9. **F2-Q9 — إقفال الصندوق:** (أ) إقفال واحد في اليوم لكل فرع، وأي فلوس بعد الإقفال تدخل في إقفال اليوم
   اللي بعده؛ (ب) أكتر من إقفال في اليوم (ورديات)، كل إقفال بياخد اللي من آخر إقفال؛ (ج) بعد الإقفال نقفل
   اليوم ونرفض أي كاش لحد بكرة. **القرار (المالك، 2026-10-20): (أ)**.
10. **F2-Q10 — العهدة (فلوس الفكة اللي بتبدأ بيها الدُرج):** (أ) مش بنتابعها، المتوقع = كاش داخل − كاش
    خارج بس؛ (ب) الموظف يدخل مبلغ العهدة في كل إقفال. **القرار (المالك، 2026-10-20): (أ)**.
11. **F2-Q11 — لو فيه فرق في الإقفال:** (أ) لازم ملاحظة، والإقفال ما يتعدلش بعد كده؛ (ب) الملاحظة اختيارية؛
    (ج) نسمح بفتح الإقفال وتعديله. **القرار (المالك، 2026-10-20): (أ)**.
12. **F2-Q12 — دفعة اتسجلت غلط (مبلغ أو طريقة):** (أ) ما فيش مسح ولا إلغاء، التصحيح استرداد بسبب وبعدين
    دفعة صح (أرقام الإيصالات تفضل من غير فجوة)؛ (ب) زرار «إلغاء الدفعة» في نفس اليوم قبل الإقفال.
    **القرار (المالك، 2026-10-20): (أ)**.
13. **F2-Q13 — رقم للاسترداد:** (أ) سلسلة أرقام لوحدها لكل فرع وسنة `SLM-RF-2026-000001` (سند صرف)؛ (ب)
    من غير رقم. **القرار (المالك، 2026-10-20): (أ)**.
14. **F2-Q14 — طباعة الإيصال:** (أ) PDF من السيرفر زي الفاتورة، والإرسال بالواتساب/الإيميل بعدين؛ (ب)
    طباعة من المتصفح بس. **القرار (المالك، 2026-10-20): (أ)**.
15. **F2-Q15 — الصلاحيات الافتراضية:** للعيادات الجديدة: موظف الاستقبال يسجّل ويشوف الدفعات ويقفل صندوق
    فروعه، والاسترداد للأدمن بس. للعيادات الموجودة: الأدمن بس ياخد الصلاحيات الجديدة وهو يديها للباقي
    (زي FIN-4). **القرار (المالك، 2026-10-20): كده بالظبط** — ولا (ب) نزوّد موظف الاستقبال في العيادات الموجودة تلقائي.
16. **F2-Q16 — تاريخ الدفعة:** (أ) دايمًا وقت التسجيل؛ (ب) نسمح بتاريخ قديم (تحويل بنكي وصل امبارح).
    **القرار (المالك، 2026-10-20): (أ)**، والمرجع (رقم التحويل) يتكتب في خانة المرجع.
17. **F2-Q17 — حماية إضافية في الداتابيز (ملف 0066):** (أ) الداتابيز نفسها تراجع أرصدة المراجع عند كل حفظ
    وترفض أي غلط؛ (ب) نكتفي بالكود والاختبارات. **القرار (المالك، 2026-10-20): (أ)** — تكلفته صغيرة وبيمنع أي فلوس غلط تتخزن.
18. **F2-Q18 — ترتيب سحب الفلوس:** لما فاتورة مدفوعة تقل أو تتلغي، بنرجّع الزيادة رصيد من **آخر دفعة
    الأول**؛ ولما نستخدم الرصيد أو نسترده، بنصرف من **أقدم رصيد الأول**. الترتيب ده بيحدد كل إيصال فاضل
    منه كام قابل للاسترداد. (أ) كده؛ (ب) من أول دفعة الأول في الحالتين. **القرار (المالك، 2026-10-20): (أ)**.
19. **F2-Q19 — إقفالات الصندوق في سجل المنصة:** (أ) ما تبانش للمنصة، لأن FIN-3 بيقول المنصة تشوف المالية
    كإجماليات بس؛ (ب) تبان كحدث إداري من غير بيانات مراجعين (زي AGENTS.md). **القرار (المالك، 2026-10-20):
    (أ)** — `cash_closing` يفضل مستبعد من سجل المنصة (0064).

## 5. F3 — reports (outline)

Read-only report endpoints over F1/F2 tables in the clinic timezone, with CSV/Excel export, behind a
`view:finance_reports:clinic|branch|own` permission (R1-18). Totals follow R1-17.

## 6. F4 — online payment and insurance (outline)

A `PaymentGateway` port with three adapters (MyFatoorah, Tap, UPayments); each clinic stores its
chosen provider and sealed credentials (the WhatsApp token pattern). Payment links per invoice, a
signed webhook per provider that records a payment (F2 tables). Insurance: `insurers`,
`patient_policies`, invoice split, `insurance_claims` with a manual status. Deposits at booking
(FIN-17) land here.

## 7. Delivery

F1 is one release in reviewable slices: contracts → SQL (0060+) with RLS and negative tests →
domain (totals, numbering) → API → Lovable web brief (`.lovable/plan/p4-f1-web-*.md`) → review loop
(Codex + the four PR bots) → staging, then production (SQL first, backups first). F2–F4 follow, each
with its own detailed section added here before its plan.

## 8. Review R1 (Codex `gpt-6.1-sol`, 2026-10-15) — binding rules

These override anything looser above.

1. **Totals, step by step** (one pure function in `packages/contracts`, shared by API, mock and PDF):
   1. `quantity` is an integer 1–999; `unit_price_minor` an integer ≥ 0.
   2. `gross_line = unit_price_minor × quantity`.
   3. Line discount: a percentage is stored in basis points (0–10000) and applies to `gross_line`
      (`round_half_up(gross_line × bp / 10000)`); an amount applies to the whole line (not per unit) and
      may not exceed `gross_line`. `net_line = gross_line − line_discount`.
   4. Invoice discount: percentage (bp) or amount on `Σ net_line`, never above it. It is **allocated to
      lines** in proportion to `net_line`, each share rounded down, and the remaining minor units go one by
      one to the lines in `position` order. A line ends at `line_total = net_line − allocated_share` ≥ 0.
   5. Tax per line: `round_half_up(line_total × tax_rate_bp / 10000)`; `tax_minor = Σ` line taxes.
   6. Totals:
      - `subtotal_minor = Σ gross_line`
      - `discount_minor = Σ line_discount + invoice_discount`
      - `total_minor = Σ line_total + tax_minor` (tax is **added**, never subtracted)

      Every total is ≥ 0; a negative intermediate is a validation error, never clamped.

   7. The spec ships a table of worked examples (two equal lines with a 1-fils invoice discount, 100 %
      discount, 15 % tax with rounding) and the shared test asserts them.
2. **Amounts on the wire are decimal integer strings** (`"12500"` = 12.500 KWD), parsed to `bigint` for
   arithmetic, never `number`. Bounds: one line ≤ 10¹² minor units; every multiply/add is range-checked
   against PostgreSQL `bigint`. The web formats from the string with the exponent, no float conversion.
3. **Audit and the platform:** every finance audit row is classified `patient_access` (it names an
   invoice of a patient), so the platform's clinic audit view excludes it — the policy, the view and
   `db/tests` gain negative tests for invoices, payments and refunds. Snapshots hold ids, numbers and
   amounts only — never patient names or free-line descriptions. A **finance audit schema** whitelists
   the money fields and the invoice number so the generic scrub does not mask them (scrub stays on for
   every free-text field); tests keep amounts and numbers whole and still mask personal data.
4. **Life cycle vs settlement:** `status` is only `issued | void`. Payment progress (`unpaid`,
   `partly_paid`, `paid`, `credit`) is **derived** in F2 from allocations, never stored in `status`. The
   one-invoice-per-source index stays `WHERE status <> 'void'`.
5. **Paid invoices that change (FIN-A5 + FIN-13), F2 rule:** money is tracked as movements, never
   overwritten: `payments` (money in), `allocations` (payment or credit → invoice), `credits` (excess
   created when an invoice total drops below what is allocated to it), `credit_uses`, `refunds`. Lowering
   a paid invoice releases the excess allocation into a credit row; raising it leaves the new amount
   owed — it never re-consumes a credit already used elsewhere. All of it under one lock per patient.
6. **Currency:** chosen from a supported list (`KWD 3`, `SAR 2`, `AED 2`, `BHD 3`, `OMR 3`, `QAR 2`) —
   the exponent is derived, never typed. Changing it is allowed only while the clinic has **no price and
   no invoice**; the check runs in a `SECURITY DEFINER` function the platform calls, under the same
   per-clinic advisory lock the first issue takes. Each invoice stores `currency` and `currency_exponent`.
7. **Source integrity:** CHECK `(source = 'manual') = (source_id IS NULL)`. For `appointment`/`visit` the
   API loads the source through the owning module's port, inside the caller's reach, and **derives** the
   patient and branch from it (a mismatch is `validation`). For a source, the reach is the source's branch
   inside the caller's `create:invoices` scope, in the draft and the issue alike; the patient's file is not
   checked against `view:patients` (owner 2026-10-17, PR #78). Only a **manual** invoice, which names its
   patient, also needs that patient inside the caller's patients view reach. An appointment and the visit made from it
   are one encounter: a live invoice on either refuses the other (`invoice_already_exists`), in the
   draft and the issue, until it is voided (PR #78). `source`, `source_id`, `branch_id`,
   `patient_id`, `number` and `issued_at` never change after issue. A walk-in visit with no service gives
   a draft with no service line (the user adds lines).
8. **Numbering:** `invoice_sequences` has `UNIQUE (clinic_id, branch_id, year)`; the first issue of a
   year runs `INSERT … ON CONFLICT DO NOTHING` then `SELECT … FOR UPDATE`, all inside the issuing
   transaction with the invoice, its lines, the audit row and the idempotency record — a failure rolls
   the number back, so it stays gap-free, and a replayed `Idempotency-Key` returns the first invoice
   without taking a number. The year is the clinic-timezone year of `issued_at`. The number is stored
   twice: `number_seq int` and the formatted `number`; six digits is a minimum width, not a limit.
9. **Prefix life cycle:** a branch's `invoice_prefix` locks after its first invoice; a prefix ever used
   in the clinic can never be given to another branch (a `used_invoice_prefixes` table, unique per
   clinic). Receipts (F2) use `PREFIX-R-YYYY-NNNNNN`, also per branch and year.
10. **Optimistic concurrency:** `invoices.version int` starts at 1 and increments on every edit and on
    void; reads return it as `ETag`. `PATCH` and `void` **require** `If-Match` (missing ⇒ 428
    `precondition_required`, stale ⇒ 412 `version_conflict`); the check and the increment happen after
    `SELECT … FOR UPDATE` in the same transaction, and the status is re-checked after the lock.
11. **Existing clinics' roles:** when the platform switches `finance` on, nothing changes by itself.
    The clinic admin role is the locked full-catalogue role, so it gains the new keys through the
    catalogue (as `medical` did); granting them to other roles goes through the existing role editor
    and its stored-superset rule. A test proves an existing admin can grant `create:invoices:branch`.
12. **`own` reach:** `view:invoices:own` uses exactly the patients `own` reach of today (a live
    appointment **or a visit** with the caller, any branch) through the patients port, for the list,
    the detail, the PDF and send. It joins the `CLINIC_BOUND` granting rule like the other `own` keys.
13. **Reading prices:** `GET /prices` (finance on, `view:prices:clinic`) returns base and per-doctor
    prices; `GET /services` never carries a price. Finance requires `patients` only; with
    `appointments` off, services (and so prices and service lines) are unavailable and invoices are
    manual or from visits with free lines.
14. **Discount permission:** `create:discounts:*` is needed whenever a request **changes** a discount
    (adds, removes, or changes its value or reason, on a line or the invoice), on create or edit; the
    API compares old and new. Edits that leave discounts untouched need only `update:invoices:*`, so the
    front desk can fix a line on an invoice the admin discounted.
15. **Sending an invoice:** `patient_notifications` gains `subject_type = 'invoice'`, kind `invoice`,
    and a `send_request_id` (client-generated, unique) so a retry is idempotent and a new request
    resends. The row references the invoice id and version only. If the invoice is voided before the
    worker sends, the send is skipped as `invoice_void`; if it was edited, the latest version is sent.
16. **The patient's link:** the message carries a link `/i/<token>`: 32 random bytes, stored as a
    SHA-256 hash for lookup, plus a sealed copy used only by worker retries (§8c.1, owner 2026-10-15), with
    the clinic, invoice and expiry (14 days), never logged; it shows the latest
    version of the invoice as a PDF, stops working when voided, and one invoice can have several live
    links (each send makes one). Opening it is audited as a patient-side view.
17. **Monthly totals (FIN-3 and F3):** `invoiced` = Σ `total` of non-void invoices by the clinic-timezone
    month of `issued_at`, **as they stand now** (an edit or void restates its month); `collected` = Σ
    payments by payment date; `refunded` = Σ refunds by refund date. The platform function and the clinic
    reports use these same definitions; tests cover an edit, a void and a refund across two months.
18. **Doctor reports (F3):** `view:finance_reports:own` (the caller's own invoices as provider) joins
    the catalogue with the same `own` reach; exports obey the same scope.

## 8b. Review R2 (Codex, 2026-10-15) — binding rules, override R1 where they differ

1. **Invoice-discount allocation (fixes R1-1.4):** `invoice_lines` has `UNIQUE (clinic_id, invoice_id,
position)`, so the order is total. If `Σ net_line = 0` every share is 0 (and a non-zero invoice
   discount is a validation error). Otherwise each share is `floor(D × net_line / Σ net_line)`; the
   remainder goes one minor unit at a time to lines whose **remaining capacity** (`net_line − share`)
   is positive, in `position` order, cycling until it is spent. A line never goes below zero.
   Worked examples (KWD, exponent 3; amounts in fils), asserted by the shared test:

   | #   | Lines (`net_line`, after line discounts)    | Invoice discount | Tax  | Line totals                                       | Tax | Total |
   | --- | ------------------------------------------- | ---------------- | ---- | ------------------------------------------------- | --- | ----- |
   | E1  | 500, 500                                    | amount 1         | 0 %  | 499, 500                                          | 0   | 999   |
   | E2  | 0, 1, 1                                     | amount 1         | 0 %  | 0, 0, 1                                           | 0   | 1     |
   | E3  | gross 12500, line discount 100 % → net 0    | none             | 0 %  | 0                                                 | 0   | 0     |
   | E4  | 3, 4                                        | amount 1         | 15 % | 2, 4                                              | 0+1 | 7     |
   | E5  | gross 12345, line discount 10 % → net 11110 | none             | 0 %  | 11110 (1235 off, half-up)                         | 0   | 11110 |
   | E6  | 0, 0                                        | amount 1         | —    | rejected: `validation` (`discount_exceeds_total`) |     |       |

2. **Voiding a paid invoice (fixes R1-5, F2):** a void sets the invoice's amount owed to 0 and releases
   **every** allocation on it into credit rows that record their origin (payment or earlier credit).
   Money already refunded is never released again (a refund consumes allocation or credit first), and
   a credit already used elsewhere is not touched. The void and its releases are one transaction.
3. **Currency vs first price (fixes R1-6):** every write of a base price or a per-doctor price takes
   the same per-clinic advisory lock as the currency change and the first issue, then reads the
   currency after the lock. A race test covers "currency change vs first price".
4. **Existing clinics' admin role (fixes R1-11):** the finance migration grants the seven clinic-scope finance keys
   to each clinic's **locked clinic-admin role only**, using the SQL shape of `0050_medical_release.sql`
   (which, unlike this release, also granted doctor and receptionist keys) — the admin role holds every clinic-scope key of the catalogue (PRD §4.7; `system-roles.ts` `clinicScope`), never branch or `own` keys. No other existing
   role changes; the admin then grants keys to other roles in the role editor (stored-superset rule).
   This is what FIN-4 "existing roles are not changed" means: no role other than the locked admin.
5. **Resending (fixes R1-15):** the `patient_notifications_once` UNIQUE **constraint** is replaced by a
   partial unique **index** on the same columns, `NULLS NOT DISTINCT`, `WHERE subject_type <> 'invoice'`;
   every writer's `ON CONFLICT ON CONSTRAINT patient_notifications_once` becomes `ON CONFLICT (<those
columns>) WHERE subject_type <> 'invoice'`. Invoice notifications are unique on
   `(clinic_id, send_request_id)` instead. A repeated `send_request_id` with the same invoice and channel returns the first row; the
   same id with a different invoice or channel is `validation` (`send_request_conflict`).
6. **Doctor finance reports (fixes R1-18):** `view:finance_reports:own` uses **the same reach as
   `view:invoices:own`** (R1-12): the invoices of the caller's own patients, whole invoices. No
   per-provider line split in F3 (that is doctor commission, FIN-19, later).
7. **The patient link lookup (N2):** `/i/<token>` is a public route with its own rate limit (by IP and
   token prefix) listed in `public-rate-limits.ts`. The API resolves it through
   `invoice_link_lookup(token_hash) RETURNS (clinic_id, invoice_id)` — `SECURITY DEFINER`, owned by a
   NOLOGIN, NOBYPASSRLS role with `SELECT` on the hash, clinic, invoice, expiry and revoked columns only
   and its own policy (the 0059 pattern), `EXECUTE` to `eyadex_app` only — then reads the invoice
   inside `withTenant`. The audit row's actor is `patient_link` (no staff member), with the link id.
8. **Lock order (N3):** every money operation — issue, edit, void, payment, refund, credit use —
   takes, in this order: the per-clinic advisory lock only when it touches prices or currency, then
   the **patient** row lock, then the **invoice** row(s) by id ascending. `If-Match` is checked after
   the invoice lock. This order joins the repository's documented lock order (ADR-0033), and a test
   runs a payment and an edit on the same invoice concurrently.

## 8c. Changes from the F1 plan review (2026-10-15) — decided by the owner on the decisions page (batch 14)

1. **C1 — durable invoice-link retry — APPROVED (F1-C1-Q1…Q4).** R1-16 stored the link token only as a
   SHA-256 hash, which a retried send cannot rebuild. Now `invoice_links` also stores `token_sealed` (the
   existing `SecretSealer`, AES-256-GCM, with a **dedicated worker-only key `INVOICE_LINK_SEAL_KEY`** — Q2;
   context `invoice_link:<clinic>:<link>:<notification>`); lookup still uses only the hash; the lookup
   function's owner and the platform have no grant on the sealed column; a retry re-opens the sealed token and
   re-sends the same URL; a rotated key or expiry revokes the link and mints a new one. **The link transaction
   commits before any network send; the send then runs in the existing ledger transaction (`whileLocked`),
   like every other notification kind** (Q3). **A final failure that proves non-delivery (`evo_not_on_whatsapp`,
   `meta_not_on_whatsapp`) revokes its link; an ambiguous one (`evo_timeout`, `meta_timeout`) keeps it until
   expiry** (Q4). The key is rotated only after the invoice queue is drained.
2. **D-P1 — DECLINED by the owner (2026-10-15): the approved server-rendered PDF stays (§3.3); design note
   `finance-f1-pdf-design.md`.** Original proposal, kept for the record: **browser print view instead of a server PDF.** §3.3 and FIN-5 approved an API-rendered PDF; the API
   renders no PDF today. Proposal: `GET /invoices/:id/print` (data) and a web print view (Print / Save as PDF),
   and a print-ready public page for `/i/<token>`. Not equivalent: no PDF file on the server, messages carry a
   link and never a PDF attachment, and the saved PDF depends on the browser. If declined, F1 renders a PDF in
   the API.
3. Clarifications (no approval needed): the catalogue gains **13** finance keys (invoices 9, discounts 2,
   prices 2); one line is capped at 10¹² minor units while aggregates are bounded by PostgreSQL `bigint`; the
   platform loses direct `UPDATE` on `clinics.currency` / `currency_exponent` so every change goes through the
   locked function. A discount has no view of its own, so a role holding `create:discounts` must hold
   `view:invoices` (the write-needs-view rule reads `VIEWED_THROUGH`). The finance release grants the locked
   admin its **seven clinic-scope** finance keys, the same set a new clinic's admin gets.
4. **The invoice list names the patient (owner decision 2026-10-16, F1 follow-up).** A holder of
   `view:invoices` sees the patient's display name on every row of `GET /v1/invoices`, inside the reach
   rule 12 already gives (clinic, branch or `own`; nothing widens). The list reads the names in one batch
   through the patients port (`BillingPatientReader.displayNames`, like the invoice page's `displayName`),
   in the same transaction as the page. It is not a file open: **no `patient_access` audit row is written,
   neither per row nor per page.** `view:patients` is not required, and the platform still sees no invoice
   row and no name (FIN-3, §8 of `CLAUDE.md`). Tests: names across a page boundary, no audit row, a wrong
   branch and a foreign `own` patient leak no name anywhere in the body, the platform is refused.

## 8d. Review R3 (Codex `gpt-6.1-sol`, high, 2026-10-20) — binding rules for F2

The independent review of §4 before its PR. Each finding was checked against the code and folded into §4;
these rules override anything looser there.

1. **The commit-time money check runs with the row's clinic, not the session's (blocking).** `withTenant`
   clears `app.clinic_id` in `closeSession` before `COMMIT` (`packages/db/src/session-check.ts`), so a
   deferred `SECURITY INVOKER` check would see no rows. 0066's `finance_check_patient` is `SECURITY DEFINER`,
   owned by its own NOLOGIN, NOBYPASSRLS role with column grants and role-wide read policies on the money
   tables (the 0059/0061 pattern), takes the clinic and patient from the row, and is tested through the real
   `withTenant` up to `COMMIT`, with a correct and a broken transaction.
2. **Every refund is checked on its own.** 0066 also fires on `refunds`, and checks
   `Σ refund_sources.amount_minor = refunds.amount_minor` for each refund (two wrong refunds can keep the
   patient's conservation sum right). Tests: a refund with no source, a refund whose sources do not sum.
3. **Closings chain by id, not by sequence bounds.** A day with no cash is a closing with `from = to`; unique
   `from`/`to` bounds would refuse the second one. `cash_closings.previous_closing_id` with
   `UNIQUE NULLS NOT DISTINCT (clinic_id, branch_id, previous_closing_id)` orders them, and its composite foreign key
   `(clinic_id, branch_id, previous_closing_id)` keeps the chain inside one branch; the drawer keeps
   `last_closing_id` under the same composite foreign key; preview and close carry `previousClosingId` and `throughCashSeq`, and a mismatch is
   `cash_drawer_changed`. Test: two closings in a row with no cash between them.
4. **F1's issue and edit lock order (existing defect, fixed in slice 4).** Inserting invoice lines takes
   `KEY SHARE` on the line doctor's membership (ADR-0027 item 6) after the branch row (item 9): with a user's
   branch change and a branch deactivation running, three sessions can deadlock. The issue and the edit lock
   the line doctors' membership rows, sorted by id, through a port before the patient row; ADR-0027 gains this
   and the `finance:<clinic>` advisory lock's position, with a three-session test. F2's own rows reference no
   membership (`received_by`, `refunded_by`, `closed_by` carry no foreign key).
5. **Signed amounts have their own contract.** A closing's expected amount and difference can be negative.
   Contracts gain `signedMinorAmountSchema` (an optional leading `-`, `bigint` bounds) and `formatSignedMinor`
   (the sign outside the formatted absolute value; `formatMinor("-1", 3)` would print `0.0-1`). Tests cover a
   shortage and more cash refunded than received.
6. **The idempotency hash includes the target.** For invoice-scoped operations the request hash covers the
   operation, the `invoiceId` from the path and the body; the same key and body on another invoice is
   `idempotency_conflict`. A replay whose branch left the caller's reach is `not_found`. Both are tested.
7. **A payment is not capped at 10¹².** That bound is per invoice line (R1-2); an invoice total may be larger.
   `payments.amount_minor` is bounded by `bigint` and by `owed`.
8. **`method_totals` is information only.** Non-cash movements take no drawer lock, so the closing's per-method
   totals (of its business date, read after the drawer lock) may miss one committing at that moment. F3
   reports never read it; they use `business_date` on the movements.
9. **R1-4's `credit` is a patient state** (reconciling R1-4 with R1-5): an invoice never holds more than its
   total, so its settlement state is `unpaid | partly_paid | paid`, and «رصيد للمراجع» is the patient's credit
   balance.
10. **The release and spending orders are the owner's decision** (F2-Q18, decided 2026-10-20 as proposed):
    newest allocation first on release, oldest credit first on spending.

## 9. Out of this phase

Packages (FIN-10), doctor commission (FIN-19), government e-invoicing, a double-entry ledger,
inventory, the dental chart and the clinic website (FIN-23, later phases).
