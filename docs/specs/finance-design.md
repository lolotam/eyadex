# Finance — design (post-MVP phase 4)

- Status: owner decisions taken 2026-10-14 (decisions page batches 10–13). Not implemented yet.
- PRD: §8.3 item 4 ("finance"), §4.7 (permissions), §4.8 (module flags), §4.11 (audit), §5 (database
  rules), §8 (security: the platform never sees patient data).
- Decision records to write with the work: ADR-0033 (money, numbering and the invoice life cycle),
  ADR-0034 (payments, refunds and the cash closing, with F2).
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
`view:invoices:own`; clinic admin = everything above (it already holds the whole catalogue). Existing
roles change only by the clinic admin's hand.

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

| Route                                         | Permission                                                         | Notes                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `PATCH /services/:id/price`                   | `update:prices:clinic`                                             | Base price; `{priceMinor}` or null.                                              |
| `PUT /services/:id/provider-prices`           | `update:prices:clinic`                                             | The whole per-doctor list for one service.                                       |
| `GET /invoices/draft?source=appointment&id=…` | `create:invoices:*`                                                | Pre-filled lines (service, doctor price, patient) — nothing is stored.           |
| `POST /invoices`                              | `create:invoices:*` (+ `create:discounts:*` if a discount is sent) | `Idempotency-Key`; issues with the next branch number.                           |
| `GET /invoices` / `GET /invoices/:id`         | `view:invoices:*`                                                  | Cursor list with filters: branch, patient, status, date range, number.           |
| `PATCH /invoices/:id`                         | `update:invoices:*` (+ discounts)                                  | FIN-A5 edit; `If-Match` version so two desks cannot overwrite each other.        |
| `POST /invoices/:id/void`                     | `deactivate:invoices:*`                                            | `{reason}` required.                                                             |
| `GET /invoices/:id/pdf`                       | `view:invoices:*`                                                  | Bilingual PDF rendered by the API from the stored invoice.                       |
| `POST /invoices/:id/send`                     | `view:invoices:*`                                                  | `{channel: email                                                                 | whatsapp}`; queues a `patient_notifications`row of a new kind`invoice` (the N1/N2 pipeline sends it with the PDF link). |
| `PATCH /clinic/settings/finance`              | `update:clinic_settings:clinic`                                    | Commercial registration number and logo upload (BlobStore, image ≤ 1 MB).        |
| Platform: clinic create/edit                  | platform                                                           | Currency, exponent and tax rate fields (currency locked once an invoice exists). |

Error codes (new): `price_missing` (a service line without a price), `invoice_prefix_missing`,
`invoice_already_exists` (source already billed), `invoice_void` (edit a void invoice),
`currency_locked`, `discount_reason_required`.

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

## 4. F2 — manual payments (outline; detailed plan when F1 merges)

`payments` (invoice, method, amount, received_at, receipt number per branch, received_by),
`refunds` (payment or credit, method, amount, reason), `patient_credits` (balance per patient from
FIN-13), `cash_closings` (branch, day, expected, counted, difference, closed_by). Payment progress is
derived from allocations (R1-4, R1-5), never stored in `status`. Permissions: `payments` view/create, `refunds` create,
`cash_closings` view/create. Methods list per clinic (FIN-11) in clinic settings.

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
   patient and branch from it (a mismatch is `validation`). `source`, `source_id`, `branch_id`,
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
    SHA-256 hash with the clinic, invoice and expiry (14 days), never logged; it shows the latest
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
4. **Existing clinics' admin role (fixes R1-11):** the finance migration grants the new finance keys
   to each clinic's **locked clinic-admin role only**, exactly as `0050_medical_release.sql` did for
   the medical keys — the admin role is defined as the whole catalogue (PRD §4.7). No other existing
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

## 9. Out of this phase

Packages (FIN-10), doctor commission (FIN-19), government e-invoicing, a double-entry ledger,
inventory, the dental chart and the clinic website (FIN-23, later phases).
