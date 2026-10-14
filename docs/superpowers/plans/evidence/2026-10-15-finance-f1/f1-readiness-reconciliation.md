# F1 readiness reconciliation (2026-10-15)

Cross-check of spec `docs/specs/finance-design.md`, plan `docs/superpowers/plans/2026-10-15-finance-f1.md`
and code on `feat/f1-finance-api` at `829bfe9` (Tasks 1, 2a, 2b). Every claim below cites its source.
Nothing here approves C1 or D-P1; both stay proposals (spec §8c). Production SQL and deploy stay owner-gated.

## 1. The 13 finance permission keys

| #   | Key                          | Spec §3.1 | Plan Task 2 test | `PERMISSION_KEYS` | Catalogue test | 0060 seed id | Locked admin (0063) | New-clinic defaults (`system-roles.ts`) |
| --- | ---------------------------- | --------- | ---------------- | ----------------- | -------------- | ------------ | ------------------- | --------------------------------------- |
| 1   | `view:invoices:clinic`       | yes       | yes              | yes               | yes            | `…0c0034`    | yes                 | admin                                   |
| 2   | `view:invoices:branch`       | yes       | yes              | yes               | yes            | `…0c0035`    | no                  | receptionist                            |
| 3   | `view:invoices:own`          | yes       | yes              | yes               | yes            | `…0c0036`    | no                  | doctor                                  |
| 4   | `create:invoices:clinic`     | yes       | yes              | yes               | yes            | `…0c0037`    | yes                 | admin                                   |
| 5   | `create:invoices:branch`     | yes       | yes              | yes               | yes            | `…0c0038`    | no                  | receptionist                            |
| 6   | `update:invoices:clinic`     | yes       | yes              | yes               | yes            | `…0c0039`    | yes                 | admin                                   |
| 7   | `update:invoices:branch`     | yes       | yes              | yes               | yes            | `…0c003a`    | no                  | receptionist                            |
| 8   | `deactivate:invoices:clinic` | yes       | yes              | yes               | yes            | `…0c003b`    | yes                 | admin                                   |
| 9   | `deactivate:invoices:branch` | yes       | yes              | yes               | yes            | `…0c003c`    | no                  | —                                       |
| 10  | `create:discounts:clinic`    | yes       | yes              | yes               | yes            | `…0c003d`    | yes                 | admin                                   |
| 11  | `create:discounts:branch`    | yes       | yes              | yes               | yes            | `…0c003e`    | no                  | —                                       |
| 12  | `view:prices:clinic`         | yes       | yes              | yes               | yes            | `…0c003f`    | yes                 | admin, receptionist                     |
| 13  | `update:prices:clinic`       | yes       | yes              | yes               | yes            | `…0c0040`    | yes                 | admin                                   |

- Order: `finance-catalogue.spec.ts` pins the 13 in `buildCatalog()` order and as the **last** 13 catalogue
  rows, so existing seed ids keep their order; 0060 inserts ids 0x34–0x40 in that same order and
  `permission-catalogue.db.spec.ts` compares DB rows with `PERMISSION_CATALOG` (runs once 0060 exists).
- Locked admin: exactly the **7 clinic-scope** keys (plan Task 6, `p.module = 'finance' AND p.scope = 'clinic'`),
  equal to what `SYSTEM_ROLES` gives a new clinic's admin (`clinicScope`). No other role changes (R2-4).
- `own`: only `view:invoices:own`; `CLINIC_BOUND` makes granting it need `view:invoices:clinic`
  (`grant-rules.ts`, test `finance-grant-rules.spec.ts`).
- Write-needs-view: `VIEWED_THROUGH = { discounts: "invoices" }` in `permissions.ts`; `roles.ts` reads it, so a
  role with `create:discounts:*` must hold `view:invoices:*` (test in `finance-catalogue.spec.ts`).
- **Fixed now:** plan Task 2 said "the 11 new literals"; corrected to 13 (the test list below it already had 13).

## 2. Money bounds

| Quantity                       | Contract (`money.ts`, `finance.ts`) | Totals function (`invoice-totals.ts`)                                | Database (plan Task 3)                                                                     |
| ------------------------------ | ----------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Service base price             | `minorLineAmountSchema` ≤ 10¹²      | —                                                                    | `clinic_services.price_minor BETWEEN 0 AND 10¹²`                                           |
| Doctor price                   | `minorLineAmountSchema` ≤ 10¹²      | —                                                                    | **was missing** → `service_provider_prices.price_minor BETWEEN 0 AND 10¹²` (added to plan) |
| Unit price on a line           | `minorLineAmountSchema` ≤ 10¹²      | gross = qty × unit; `gross > MAX_LINE_MINOR` ⇒ `amount_out_of_range` | **was** "≥ 0" only → `unit_price_minor BETWEEN 0 AND 10¹²` (added)                         |
| Line discount (amount)         | `minorLineAmountSchema` ≤ 10¹²      | capped by the line's gross (`discount_exceeds_total`)                | jsonb, checked through `line_total_minor`                                                  |
| Line total                     | response `minorAmountSchema`        | ≤ gross ≤ 10¹²                                                       | **was** "≥ 0" only → `line_total_minor BETWEEN 0 AND 10¹²` (added)                         |
| Invoice discount (amount)      | `minorAmountSchema` ≤ 2⁶³−1         | ≤ Σ net lines, else `discount_exceeds_total`                         | jsonb; reflected in `discount_minor`                                                       |
| Subtotal, discount, tax, total | response `minorAmountSchema`        | each through `bounded()` against `MAX_MINOR`                         | `bigint`, CHECK `>= 0` (the type is the ceiling)                                           |
| Quantity                       | 1–999                               | `invalid_line` outside 1–999                                         | CHECK `quantity BETWEEN 1 AND 999`                                                         |
| Tax rate / pct discount        | 0–10000 bp                          | `checkBp`                                                            | `tax_rate_bp BETWEEN 0 AND 10000`                                                          |

Evidence: `invoice-totals.spec.ts` (E1–E6, an aggregate above the line cap passes, one above 2⁶³−1 fails),
`money.spec.ts`, `finance-contracts.spec.ts` (an invoice discount of `"1500000000000"` passes, a line discount of
`"1000000000001"` fails).

## 3. SECURITY DEFINER and platform access

| Object                                 | Migration | Owner (NOLOGIN, NOBYPASSRLS)    | Caller            | Status                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | --------- | ------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance_monthly_totals(p_clinic)`     | 0061      | `eyadex_finance_totals_owner`   | `eyadex_platform` | Proven locally (`definer-and-resend-proof.sql`, `output.txt`): monthly totals per clinic (A 2026-10=2500, 2026-11=1000; B 2026-10=777); direct `invoices` and `service_provider_prices` reads refused; `eyadex_app` has no EXECUTE; owner has no `patient_id` grant. Void exclusion and the timezone edge are Task 4 CI tests, not yet proven |
| `finance_set_currency(p_clinic, code)` | 0061      | `eyadex_finance_currency_owner` | `eyadex_platform` | Proven: `currency_locked` (clinic with invoices), `currency_unsupported`, a clean clinic set to SAR/2 (exponent from the code)                                                                                                                                                                                                                |
| Platform `UPDATE` on `clinics`         | 0061      | —                               | —                 | Proven (`currency-bypass-proof.sql`): table-level UPDATE revoked, 12 named columns granted back; direct `SET currency`, `SET currency_exponent` and a mixed update refused; `tax_rate_bp`, `status`, SELECT, INSERT still work. The column-check `DO` block is a plan step (Task 4), not yet proven                                           |
| `invoice_link_lookup(p_hash)`          | 0062      | `eyadex_invoice_link_owner`     | `eyadex_app`      | **Held with C1.** The link table's columns (`token_sealed`) and the owner's grants depend on the C1 decision                                                                                                                                                                                                                                  |

All definer functions: `SET search_path = pg_catalog, public`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE` to
their one caller (plan Task 4). `eyadex_platform` has no grant on any finance table (plan Task 3 step 10).

## 4. Error codes (committed in `829bfe9`)

| Code                       | HTTP | Source rule                   |
| -------------------------- | ---- | ----------------------------- |
| `price_missing`            | 422  | §3.3                          |
| `invoice_prefix_missing`   | 409  | §3.3, R1-9                    |
| `invoice_prefix_locked`    | 409  | R1-9                          |
| `invoice_prefix_taken`     | 409  | R1-9                          |
| `invoice_already_exists`   | 409  | §3.2 (one invoice per source) |
| `invoice_void`             | 409  | §3.3                          |
| `currency_locked`          | 409  | R1-6                          |
| `currency_unsupported`     | 400  | R2-3                          |
| `discount_exceeds_total`   | 422  | R2-1                          |
| `discount_reason_required` | 422  | §3.3, FIN-A7                  |
| `precondition_required`    | 428  | R1-10                         |
| `version_conflict`         | 412  | R1-10                         |
| `send_request_conflict`    | 400  | R2-5 ("is `validation`")      |

Each has ar/en text in `api-error-messages.ts` and is `RULE_ONLY` (never derived from a framework status).

## 5. Held, with the reason

| Item                                                        | Held by                | Where it lands               |
| ----------------------------------------------------------- | ---------------------- | ---------------------------- |
| `invoice_link_expired`, `publicInvoiceSchema`, `/i/<token>` | C1                     | Task 9                       |
| `invoice_links` table and `invoice_link_lookup` owner       | C1                     | 0062 part 2 / Task 9         |
| Notification kind `invoice` in contracts + worker           | C1 (what is sent)      | Task 5 SQL + Task 9 worker   |
| `invoicePrintSchema` (a JSON print payload)                 | D-P1 (only if adopted) | none under the server PDF    |
| Server PDF renderer (Task 8g)                               | D-P1 decision          | Task 8g                      |
| `invoicePrefix` on `PATCH /branches/:id`                    | API wiring             | Task 8h (same commit as API) |
| `currency` / `taxRateBp` on `POST /platform/clinics`        | API wiring             | Task 8i (same commit as API) |

The last two wait so that a strict request schema never accepts a field the API silently drops.

**Split suggestion for 0062 (not applied, needs the supervisor's nod):** the partial-index swap, kind `invoice`,
`subject_type 'invoice'` and `send_request_id` do not depend on C1; only `invoice_links` does. Splitting 0062
into "sends" and "links" would let the C1-independent half ship first.
