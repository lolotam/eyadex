# Finance F3 — reports (design draft)

- Status: **decided** (owner decisions taken 2026-10-21, EY-9, §11, and 2026-10-23, EY-10, §12). Nothing
  here is built. Five answers differ from the recommendation (F3-Q4, Q5, Q7, Q8, Q9); §3–§9 state them, and
  §11 and §12 win where they disagree. The slices of §9 still wait for the owner's yes on the SQL plan, and
  for the open item of issue #105.
- Parent spec: `docs/specs/finance-design.md` (§2 shared rules, §3 F1, §4 F2, §8–§8d binding review rules).
  This file replaces the §5 outline there.
- Decision record: **ADR-0035** (`docs/adr/0035-finance-reports.md`), accepted 2026-10-21.
- Vocabulary: «تقارير المالية» (finance reports), «المراجع» (never «المريض»), «موظف الاستقبال». Amounts show
  with the clinic currency code, e.g. «12.500 د.ك».

## 1. What F3 is, and what it is not

F3 is **read-only for money**. It adds report screens, report endpoints and CSV and XLSX exports over the
tables F1 and F2 already write. It writes no money row, stores no balance (§4.3 of the parent spec: every
balance is derived) and changes no F1/F2 rule.

It does add four columns and re-create one function (§8): `invoices.business_date` and
`payment_allocations.business_date` (the stored clinic business day, F3-Q1 a and EY-10.5), and
`invoice_lines.discounted_by` and `invoices.discounted_by` (who set the discount, EY-10.2). All four start
nullable in the expand step; the writers follow, then the backfills, then the contract step. F3 also
re-creates `finance_monthly_totals` on the stored days (0071) and amends R2-6 for R10.

Binding rules it inherits (not re-asked here):

- **FIN-18:** revenue by day/period, branch, doctor, service and method; outstanding balances; discounts;
  cash closings; Excel/CSV export.
- **R1-17 (monthly totals):** `invoiced` = Σ `total_minor` of non-void invoices by the clinic-timezone month
  of `issued_at`, **as they stand now** (an edit or void restates its month); `collected` = Σ payments by
  payment date; `refunded` = Σ refunds by refund date. The platform function (`finance_monthly_totals`,
  0061/0065) and the clinic reports use these same definitions. A credit application is not collected money.
- **R1-18 + R2-6 (doctor reports):** the doctor's own report uses **the same reach as
  `view:invoices:own`** (R1-12: the invoices of the caller's own patients, whole invoices). **No per-provider
  line split in F3** — that is doctor commission (FIN-19, later). Exports obey the same scope.
  **Amended by the owner (F3-Q4 = (c), 2026-10-21) for R10 only:** R10 shows the revenue of the doctor's own
  lines — lines whose `provider_id` is the caller's membership **on invoices inside the caller's
  `view:invoices:own` reach** (`ownPatientFilter`). Both conditions apply, so R10 never shows an amount from an
  invoice the doctor's invoice list hides (§3: a report is never a back door). R4 is unchanged (clinic/branch).
- **R3-8:** reports never read `cash_closings.method_totals`; they use `business_date` on the movements.
- **FIN-3:** the platform sees finance only as the totals function. No report, view, export or audit row of
  F3 reaches `eyadex_platform`.
- **F2-Q9, F2-Q11:** one closing a branch a day, never edited; the closing report only lists them.

Out of F3: doctor commission (FIN-19), insurance and online payment (F4), packages (FIN-10), government
e-invoicing (FIN-A3), any accounting ledger (FIN-1), scheduled or e-mailed reports.

## 2. The data that exists today (checked against `origin/main` fc75e9af)

| Table (file)                       | Columns a report needs                                                                                                                                                                                                           | Per patient?                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `invoices` (0060)                  | `branch_id`, `patient_id`, `number`, `status` (`issued`/`void`), `source`, `issued_at`, `year`, `currency`, `currency_exponent`, `subtotal_minor`, `discount_minor`, `tax_minor`, `total_minor`, `invoice_discount`, `voided_at` | yes (`patient_id`)                                   |
| `invoice_lines` (0060)             | `invoice_id`, `kind` (`service`/`free`), `service_id NULL`, `provider_id NULL` (membership), `quantity`, `unit_price_minor`, `line_discount`, `line_total_minor`, `archived_at` (an edit archives lines, never deletes them)     | through the invoice                                  |
| `service_provider_prices` (0060)   | `service_id`, `member_id`, `price_minor` — today's price list, **not** what was billed; reports read billed lines, never this table                                                                                              | no                                                   |
| `payments` (0064)                  | `branch_id`, `patient_id`, `invoice_id`, `receipt_number`, `method`, `amount_minor`, `received_at`, `business_date`, `received_by`                                                                                               | yes                                                  |
| `payment_allocations` (0064)       | `invoice_id`, `patient_id`, `payment_id NULL` / `credit_id NULL`, `amount_minor`, `created_at`                                                                                                                                   | yes                                                  |
| `patient_credits` (0064)           | `patient_id`, `origin_allocation_id`, `amount_minor`, `cause` (`invoice_edited`/`invoice_voided`/`refund`), `created_at`                                                                                                         | yes                                                  |
| `refunds`, `refund_sources` (0064) | `branch_id`, `patient_id`, `invoice_id`, `refund_number`, `method`, `amount_minor`, `reason`, `refunded_at`, `business_date`; sources: `refund_id`, `credit_id`, `amount_minor`                                                  | yes                                                  |
| `cash_closings` (0064)             | `branch_id`, `business_date`, `expected_minor`, `counted_minor`, `difference_minor`, `note`, `closed_by`, `closed_at`, `previous_closing_id`                                                                                     | **no** (no patient column; F2 screens show no names) |
| `clinics` (0001, 0060)             | `timezone`, `currency`, `currency_exponent`                                                                                                                                                                                      | no                                                   |

Indexes that already serve reports: `invoices (clinic_id, branch_id, issued_at)`,
`payments (clinic_id, branch_id, business_date)`, `refunds (clinic_id, branch_id, business_date)`,
`cash_closings (clinic_id, branch_id, closed_at)`, `invoice_lines (clinic_id, service_id)` and
`(clinic_id, provider_id)`.

Two facts shape the design:

1. **Invoices have no stored business day.** Payments, refunds and closings freeze `business_date` (the
   clinic-timezone day, R1-8) when written. Invoices store `issued_at` and the frozen `year` only. Grouping
   invoices by `issued_at AT TIME ZONE clinics.timezone` at read time moves an invoice to another day if the
   clinic's timezone is later edited (0036 grants `UPDATE (timezone)` on `clinics` to `eyadex_app`). The
   platform function 0061 already computes it live. F3 freezes it: the invoice's day is stored at issue
   (F3-Q1 a), and a credit application freezes its own day the same way (EY-10.5).
2. **Tax is not on the lines.** `computeInvoiceTotals` (`packages/contracts/src/invoice-totals.ts`) applies
   the line discount, then **allocates the invoice-level discount to the lines**, so the stored
   `line_total_minor` is already net of both discounts. Tax is computed per line but stored only on the
   invoice (`tax_minor`; `invoice_lines` has no tax column), and `total_minor = Σ line_total_minor + tax_minor`.
   So a per-service or per-doctor sum of `line_total_minor` must **not** subtract the invoice discount again;
   the only gap to the invoices' total is the tax (F3-Q3 a).

## 3. Permissions (4 new report resources; module `finance`)

| Resource           | Actions and scopes     | Meaning                                                    |
| ------------------ | ---------------------- | ---------------------------------------------------------- |
| `report_takings`   | view `clinic`/`branch` | R1 (daily takings), R2 (period summary) and R9 (closings). |
| `report_analytics` | view `clinic`/`branch` | R3 (revenue by service) and R4 (revenue by doctor).        |
| `report_patients`  | view `clinic`/`branch` | R5–R8, the patient-named reports. No `own` scope.          |
| `report_own`       | view `own`             | R10, the doctor's own summary.                             |

- **7 new keys** (EY-10.1): `view:report_takings:clinic`, `view:report_takings:branch`,
  `view:report_analytics:clinic`, `view:report_analytics:branch`, `view:report_patients:clinic`,
  `view:report_patients:branch`, `view:report_own:own`; catalogue ids
  `00000000-0000-7000-8000-0000000c004b` … `…c0051` (the last F2 id is `…c004a`, 0064), in
  `PERMISSION_CATALOG` order, module `finance`. `view:report_own:own` joins the `CLINIC_BOUND` granting rule
  like the other `own` keys (R1-12).
- **One key per report group.** A key opens the reports of its group and nothing else: `report_takings` opens
  R1, R2 and R9; `report_analytics` opens R3 and R4; `report_patients` opens R5–R8; `report_own` opens R10.
  There is no separate export key: an export is a view.
- **Scope meaning:** `clinic` = every branch; `branch` = the caller's branches (the movement's branch for
  payments and refunds, the invoice's branch for invoices and balances, the closing's branch for closings,
  F2-Q8); `own` = R10 only — the caller's own lines on the invoices of his own patients (R2-6, F3-Q4 c).
- **A report is not a back door.** A report row never shows more than the caller could reach through the
  existing list screens with the same scope. Every report that shows invoices or payments also needs the
  covering `view:invoices` / `view:payments` key, and the closing report also needs `view:cash_closings`
  (`viewScopeCovers`, issue #93). §4 names the extra key per report, and the worker re-checks it at run time
  and at download (§7.4).
- **An `own` report key is never covered by a `branch` key** (EY-10.6). R10 needs `view:report_own:own`
  itself; no other group's key opens it, and a `branch` scope never stands in for `own`.
- Code that moves with the keys (as in parent §4.1): `resourceSchema` (+ the four report resources), the
  `permissionSchema` regex, `resourceGrants`, the written-out `PERMISSION_KEYS`, `system-roles.ts`, the web
  role matrix group «المالية» («التقارير»), the mock's seed roles; the keys land in the same PR as the SQL
  that seeds them (a test pins `PERMISSION_KEYS` to the seeded table).
- **Default grants (F3-Q9 b, EY-9.14 a, EY-10.1).** New clinics: locked clinic admin the three clinic keys
  `view:report_takings:clinic`, `view:report_analytics:clinic` and `view:report_patients:clinic`;
  receptionist `view:report_takings:branch` only, covering R1, R2 and R9 (EY-9.14 a); doctor
  `view:report_own:own` only, covering R10 (F3-Q4 c, F3-Q9). The new-clinic templates in `system-roles.ts`
  get the same keys in the same slice (§9 slice 2). R9's extra key `view:cash_closings:branch` is already in
  the receptionist template since F2. Existing clinics: 0070 grants the locked admin the three clinic keys
  (R2-4 again) and changes no other existing role (FIN-4); their admin grants the receptionist and doctor
  keys to their own roles (§8).

## 4. Reports

All amounts are minor units as decimal strings (`minorAmountSchema`), with the clinic `currency` and
`currency_exponent` on the response. All dates are clinic-timezone business days (§6). Every report takes a
`from`/`to` date range (inclusive) and an optional branch filter inside the caller's reach. The range is up
to 366 days on screen and up to 3 years in an export (F3-Q6 a); a longer range is `report_range_too_long`.

| #   | Report (screen)                                 | Rows / grouping                                                                                                                                                                                                                   | Source                                                                                                                                             | Key and scope                                                                             | Patient data?                                                                               |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| R1  | Daily takings «الإيراد اليومي»                  | per business day × branch × method: `inMinor` (payments), `outMinor` (refunds), `netMinor`; totals row                                                                                                                            | `payments`, `refunds` by `business_date`                                                                                                           | `report_takings` `clinic`/`branch` (+ `view:payments` covering)                           | no (aggregates only)                                                                        |
| R2  | Period summary «ملخص الفترة»                    | per month (or day) × branch: `invoicedMinor`, `discountMinor`, `taxMinor`, `collectedMinor`, `refundedMinor`, `creditAppliedMinor` (information, not collected), void count                                                       | `invoices` (R1-17, non-void, by issue day), `payments`, `refunds`, `payment_allocations` with `credit_id` (by its stored `business_date`, EY-10.5) | `report_takings` `clinic`/`branch` (+ `view:invoices` and `view:payments` covering)       | no                                                                                          |
| R3  | Revenue by service «الإيراد حسب الخدمة»         | per service (and «بنود حرة» for free lines): line count, quantity, billed amount (`line_total_minor`, net of both discounts), plus one report-level tax line «الضريبة» (F3-Q3 a)                                                  | live lines (`archived_at IS NULL`) of non-void invoices, by the invoice's issue day                                                                | `report_analytics` `clinic`/`branch`                                                      | no                                                                                          |
| R4  | Revenue by doctor «الإيراد حسب الدكتور»         | per line provider (`provider_id`; lines with none are «بدون دكتور»): line count, billed amount (`line_total_minor`), plus one report-level tax line «الضريبة» (F3-Q3 a)                                                           | same as R3, grouped by `provider_id`                                                                                                               | `report_analytics` `clinic`/`branch` only (R2-6: no per-provider split for `own`)         | no; doctor names are staff names                                                            |
| R5  | Outstanding balances «المبالغ المستحقة» (aging) | per issued invoice with `owed > 0`: number, branch, issue day, total, paid, owed, age bucket (0–30, 31–60, 61–90, over 90 days, F3-Q2 a); summary per bucket and branch                                                           | `invoices` + live allocations (§5.2)                                                                                                               | `report_patients` `clinic`/`branch` (+ `view:invoices` at a covering scope)               | **yes**: the patient's display name and invoice number per row                              |
| R6  | Patient credit «أرصدة المراجعين»                | per patient with credit balance > 0: balance, oldest credit day                                                                                                                                                                   | `patient_credits` − allocations funded by them − `refund_sources` (§4.3 `remaining`)                                                               | `report_patients` `clinic` only (credit is clinic-wide, F2-Q7) (+ `view:payments:clinic`) | **yes**: names                                                                              |
| R7  | Refunds «المستردات»                             | per refund: number, business day, branch, method, amount, source (payment or credit), refunded by; reason as text, exported too (F3-Q8 b), length-capped as stored and formula-guarded                                            | `refunds`, `refund_sources`                                                                                                                        | `report_patients` `clinic`/`branch` (+ `view:payments` covering)                          | **yes**: names                                                                              |
| R8  | Discounts «الخصومات»                            | per invoice with `discount_minor > 0`: number, issue day, branch, discount amount, kind (line/invoice), who set it (the stored `discounted_by`, note below), the patient's name (F3-Q7 a); reason as text, exported too (F3-Q8 b) | `invoices`, `invoice_lines.line_discount`, `invoices.invoice_discount`, `discounted_by` (EY-10.2)                                                  | `report_patients` `clinic`/`branch` (F3-Q7 a) (+ `view:invoices` covering, like R5)       | **yes**: names (F3-Q7 a)                                                                    |
| R9  | Cash closings «سجل إقفال الصندوق»               | per closing: business day, branch, expected, counted, difference, closed by, note present (yes/no); totals of differences                                                                                                         | `cash_closings` only (never `method_totals`, R3-8)                                                                                                 | `report_takings` `clinic`/`branch` (+ `view:cash_closings` covering)                      | no                                                                                          |
| R10 | Doctor's own summary «ملخص فواتيري»             | per month: the billed amount of the doctor's own lines — his own lines on invoices inside his `own` reach (F3-Q4 c); no paid or owed columns (EY-9.16 a)                                                                          | live lines of non-void invoices in the caller's `own` reach, filtered by `ownPatientFilter` and `provider_id` (§5.1)                               | `report_own` `own` only (+ `view:invoices` at the `own` scope)                            | aggregates on screen; the drill-down is the invoices list the doctor already sees (F3-Q4 c) |

Notes:

- **R1 and R2 against the platform totals (F3-Q13 a).** R1 and R2 group payments and refunds by their
  stored `business_date`, while `finance_monthly_totals` (0065) still converts `received_at`/`refunded_at`
  with the clinic's **current** timezone (and 0061 does the same for `issued_at`). The platform function
  moves to the stored business day in a new forward-only SQL file that re-creates it with the same columns
  (§8); applying that file to production needs the owner's own yes when it is ready. Until it is applied,
  the two agree only for a clinic whose timezone has not changed. Within F3 itself, a month of R1 equals
  R2's `collectedMinor` of that month (both read `business_date`). The invoice day follows the same rule: the
  reports read `issued_at` in the clinic's current timezone until the contract step, and the stored
  `invoices.business_date` after it (EY-10.6, §8).
- **R3/R4 are billed revenue, not collected.** Payments name an invoice, not a line, so collected money
  cannot be split by service or doctor without a rule (F3-Q3 a covers billed; collected per doctor is
  commission territory, FIN-19).
- **R4 and R2-6.** R4 groups the clinic's lines by `provider_id` for a clinic or branch reader; it is a
  management view of who billed what, not a commission statement. A doctor holding only `own` gets R10,
  which counts his own lines only (F3-Q4 c) — the amendment of R2-6 applies to R10 alone.
- **R8 "who set the discount" is stored, not derived** (EY-10.2). It never comes from `invoices.created_by`
  (that is who issued it; a later edit can add or change the discount), and it never comes from
  `audit_log`: billing reads no audit table, so no audit port and no §2.2 row are needed. The issue and edit
  paths write the membership id of the staff member who set the discount into `invoice_lines.discounted_by`
  (a line discount) and `invoices.discounted_by` (an invoice discount); both columns are nullable. A
  discount set before the column existed shows «—». The staff name is resolved the way the clinic audit
  screen resolves a membership id (slice 10).
- **R5 age** is counted from the invoice's issue day to today (clinic timezone). The buckets are 0–30,
  31–60, 61–90 and over 90 days (F3-Q2 a).
- Reports **R5–R8 show patient names** inside the caller's reach, read in one batch through
  `BillingPatientReader.displayNames`, with **no `patient_access` audit row** on screen (parent §8c item 4,
  as the F1 and F2 lists do). Every **export** of R5–R8 writes a patient-data access audit row — who, which
  report, which range — the same as opening a patient file (EY-9.15 a, §7.4).

## 5. Where the data comes from (SQL under RLS)

### 5.1 Pattern

- **Live queries, no rollup table (F3-Q11 a).** Every report reads the tables of §2 as they are. There is no
  daily rollup and no stored balance: a rollup is added later only if a measured report is slow, and it
  would be derived and rebuildable, never the source (parent §4.3).
- **Report functions, not table reads in TypeScript.** Each aggregate report with a `clinic`/`branch` scope (R1–R4, R9) is one
  `LANGUAGE sql STABLE` function with **`SECURITY INVOKER`** (the default), taking `(p_from date, p_to date,
p_branch_ids uuid[])` and returning a fixed row type. Invoker rights mean the caller's RLS applies: under
  `withTenant` it sees only its clinic, and with no `app.clinic_id` it sees zero rows (CLAUDE.md §5). The
  branch reach is computed by the API (as `branch-condition.ts` does today) and passed as `p_branch_ids`;
  the function never widens it.
- **The invoice day until the contract step.** The report functions and the balance view read the invoice day
  from `issued_at` in the clinic's **current** timezone while `invoices.business_date` is still nullable. A
  later file in the same release re-creates them on the stored column (§8, EY-10.6).
- **One invoker view for balances** (§5.2), `CREATE VIEW … WITH (security_invoker = true, security_barrier
= true)`. The repo has no `security_invoker` view yet (its views are definer views for the platform); this
  is the first, so the SQL slice adds a test that the view honours RLS (§8).
- **Grants:** `EXECUTE` on each function and `SELECT` on the view to `eyadex_app` only;
  `REVOKE ALL … FROM PUBLIC, eyadex_platform, eyadex_auth, eyadex_dispatcher`. No function is
  `SECURITY DEFINER` and none needs a new owner role (unlike 0061/0066, which must see across RLS).
- **Patient rows (R5–R8) stay plain queries** in `apps/api/src/modules/billing/queries/` with cursor
  pagination, like `invoice-list.ts` and `payment-list.ts`, joined to the balance view for R5.
- **Every `own` read (R10 only) is a plain query, never a function.** `report_patients` has no `own` scope
  (EY-10.1), so R10 is the only `own` report. The `own` reach
  is not a date and a branch list: it is the caller's membership and its appointment or visit links (R1-12).
  The query applies exactly the predicate the invoice list applies today —
  `BillingPatientReader.ownPatientFilter(membershipId, sql\`i.patient_id\`)`(port`apps/api/src/modules/billing/ports/billing-patients.ts`, implementation
`apps/api/src/modules/patients/persistence/pg-billing-patients.ts`), chosen the way
`use-cases/reads/reads.ts` `condition(reach)`chooses it — and R10 adds the doctor's own lines:`invoice_lines.provider_id`= the caller's membership, on the live lines of the non-void invoices inside
that reach (F3-Q4 c). Why a query and not a function taking`membershipId`: the predicate belongs to the
patients module (billing never names the appointments or visits relations), so a SQL copy of it would be a
second definition of `own`that could drift from the invoice list's. RLS stays the clinic wall under`withTenant`; the predicate only narrows inside the clinic. A test asserts that the invoices behind R10
are exactly the ones `GET /v1/invoices` returns for the same doctor, and that every line counted is the
  doctor's own.

### 5.2 Derived balances

`finance_invoice_balances` (view, invoker): one row per invoice — `clinic_id`, `id`, `branch_id`,
`patient_id`, `status`, `issued_at`, `business_date` (the invoice's issue day: `issued_at` in the clinic's
current timezone until the contract step, the stored `invoices.business_date` after it — F3-Q1 a, EY-10.6),
`total_minor`, `paid_minor`, `owed_minor` — where, as in
`packages/contracts/src/settlement.ts`:

- `live(a) = a.amount_minor − Σ patient_credits.amount_minor WHERE origin_allocation_id = a.id`
- `paid_minor = Σ live(a)` over the invoice's allocations; `owed_minor = total_minor − paid_minor` for an
  issued invoice, `0` for a void one.

A test asserts that the view and the shared `settlement.ts` functions agree on every row of the parent §4.3
table (S1–S11). The API keeps using `settlement.ts` for single invoices; the view exists for lists and
sums only. The issue day and the age bucket of R5 read the same `business_date` as the view: the stored
column after the contract step, and `issued_at` in the clinic's current timezone before it (F3-Q1 a,
EY-10.6).

## 6. Time and business days

- **The clinic timezone** (`clinics.timezone`) defines every day, month and "today", exactly as F2 does
  (`instantToWall`, `payment-rules.ts`). The API never uses the server's or the browser's timezone.
- **Movements** (payments, refunds, closings) group by their stored `business_date`. A movement never
  changes day.
- **Invoices** group by their stored `invoices.business_date`, set at issue from the clinic-timezone day of
  `issued_at` (F3-Q1 a). Existing invoices are backfilled the same way (§8), and the day never changes if
  the clinic timezone is edited later. Until the contract step the reports read `issued_at` in the clinic's
  current timezone; after it they read the stored day (EY-10.6). R1-17 already fixes that an edit or void
  restates the invoice's **issue** month; it never moves it to the edit's day.
- **Credit applications** (a `payment_allocations` row funded by a patient credit) freeze their own
  `business_date` when they are written (EY-10.5); R2's credit-applied column reads it, and the column is
  backfilled and contracted like the invoice's (§8).
- **The platform totals read the same day (F3-Q13 a).** `finance_monthly_totals` moves to the stored
  `business_date` of the movements and to `invoices.business_date` for the invoiced month, so one definition
  of a day holds everywhere (§8).
- **Date filters** are `date` values (`dateSchema`), inclusive both ends, never client timestamps — the rule
  of `GET /v1/payments` today. The range is up to 366 days on screen and up to 3 years in an export
  (F3-Q6 a); a longer range is `report_range_too_long`.
- **"Today"** for aging (R5) is the clinic-timezone day of the injected `Clock` at request time (or at
  export start, §7).

## 7. Exports

### 7.1 Formats

- **CSV** (FIN-18), UTF-8 with a BOM so Excel opens Arabic correctly, comma-separated, RFC 4180 quoting,
  headers in the caller's language (ar or en), amounts in **major units with the currency exponent's
  decimals** (`12.500`) plus a `currency` column, dates `YYYY-MM-DD`. Formula injection is guarded on
  **every text cell** — patient and staff names, document numbers, descriptions, notes, and also the
  service, branch, method and status labels: a cell whose first character is `=`, `+`, `-`, `@`, a tab
  (`\t`) or a carriage return (`\r`) is prefixed with `'`. The **only** exemption is the exporter's own
  numeric amount and count columns, written as plain numbers from `bigint` values (`-3.000` stays a number,
  so a negative expected cash or difference still sums in Excel); no text ever reaches those columns.
  Counts are always numbers (they never reach 15 digits).
  **Precision:** Excel keeps 15 significant digits, and a `bigint` minor amount can have more. A **CSV**
  export with any amount over 15 significant digits is **refused** (`export_amount_too_large`, EY-10.3): the
  export fails and no file is written, because a quoted number can still be rounded by Excel when it opens
  the file.
- **XLSX** (F3-Q5 b): the same columns as the CSV, in one sheet (one export is one report), written by an
  XLSX writer — a new dependency, so the 24-hour supply-chain guard of the workspace applies. An amount is
  always written as a typed text cell, so no digit is rounded away — the XLSX export is the exact one
  (EY-10.3). The formula guard of every free-text cell applies here as well, and the exported reasons of R7 and
  R8 are guarded like any other text (F3-Q8 b); amount cells are written by the writer from the canonical
  decimal string (digits, one dot, an optional leading minus), never from user text, so they are not
  prefixed by the guard.
- **PDF**: waits for slice 8g (the F1 PDF renderer, parked to the project end; parent §3.3 and
  `finance-f1-pdf-design.md`). F3 adds no PDF route; the screen offers the browser's print.

### 7.2 Every export is a worker job

CLAUDE.md §6: anything expected to exceed 200 ms is a worker job.

- **On screen:** reports return JSON, aggregates in one call, patient lists cursor-paginated (page ≤ 100).
  These stay under 200 ms with the indexes of §8 for the 366-day range of F3-Q6 a.
- **Every export is a worker job** (F3-Q6 a) — simplest rule, no size guess. `POST /v1/finance-reports/exports`
  stores a request row and returns `202` with its id; the worker builds the file; the screen polls
  `GET /v1/finance-reports/exports/:id` and downloads when `done`. There is no sync path for a small
  aggregate: every export is a job, and the export range goes up to 3 years (F3-Q6 a).
- **The worker has no job queue library.** `apps/worker` has two mechanisms only: the `OutboxPoller`
  (`apps/worker/src/shared/outbox-poller.ts`) over `outbox_events` (0025/0029), claimed through
  `DispatcherOutbox.claimNext` (`packages/db/src/dispatcher.ts`) as `eyadex_dispatcher`, and `PeriodicJob`
  timers. `claimNext` runs its handler inside the claim transaction (30 s `statement_timeout` and
  `idle_in_transaction_session_timeout`), so no file is ever built inside a claim. The request writes the
  export row and an `outbox_events` row (the clinic's `clinic_id`, the export id only) in one `withTenant`
  transaction; the worker reads only inside `withTenant(event.clinicId)`.

#### Export pipeline — design open, decided before slice 2's SQL

The runner's internals are tracked in issue #105 ("F3: design the finance export pipeline") and are
agreed there before slice 2's SQL is written, because the export table's lease and fencing columns are
part of that table (tracked in #105). Whatever design wins must meet these binding requirements:

1. **A post-commit hand-off point outside `claimNext`**: the claim only records the hand-off.
2. **Lease renewal (heartbeat)** while an export is queued or running, so load never looks like a dead worker
   and a live build is never taken over.
3. **Attempt-specific blob keys**: each attempt uploads to its own key; only the fenced winner is published;
   losing or stale uploads are deleted.
4. **A cleanup path for every key ever allocated**, failed and partial uploads included.
5. **The 24-hour retention** of the published file (F3-Q10), then the blob is deleted and the row is `expired`.
6. The constraints already fixed above: the outbox stays the only durable queue, no new role, no `BYPASSRLS`,
   access re-checked at run time (§7.4), a bounded retry count, idempotent by export id.

### 7.3 The export table (new clinic table)

`finance_report_exports`: `clinic_id`, `id` (UUID v7), `requested_by` (membership id, no FK, like
`payments.received_by`), `report` (`daily_takings`/`period_summary`/`by_service`/`by_doctor`/`outstanding`/
`patient_credit`/`refunds`/`discounts`/`cash_closings`/`own_summary`), `params jsonb` (date range, branch
ids, language; no patient field), `format` (`csv`/`xlsx`, F3-Q5 b, its own column — EY-10.6), `scope`
(`clinic`/`branch`/`own`, the scope the request was granted), `patient_ids uuid[] NULL` (the patients of an
`own` export, so the download can re-check them — EY-10.6), `status` (`queued`/`running`/`done`/`failed`/
`expired`/`purged`), `storage_key text NULL` (under
`clinic/<clinic_id>/finance-exports/`, the 0049 pattern; the attempt and lease columns follow issue #105 and are designed before slice 2's SQL), `byte_size int NULL`, `row_count int
NULL`, `error_code text NULL`, `created_at`, `started_at NULL`, `finished_at NULL`, `expires_at NULL`.
Primary key `(clinic_id, id)`, RLS enabled and forced with the standard policy, index
`(clinic_id, requested_by, created_at)` for the requester's export list (no queue index: the worker reaches a
job by id through its outbox event, §7.2). Not append-only: the worker updates `status` and the file fields (column-level `UPDATE` grant).
`REVOKE ALL … FROM eyadex_platform`.

### 7.4 Rules

- **The worker re-checks access at run time.** Inside `withTenant(clinicId)` it loads the requester's
  membership and role and re-derives the scope and branch reach **now**; a requester who lost the key, the
  branch or the clinic gets `failed` (`forbidden`), and the module-off and clinic-suspended checks of
  CLAUDE.md §6 apply again. The stored `scope` is an upper bound, never a grant. The same re-check covers
  the report's own key (§3: `report_takings` for R1/R2/R9, `report_analytics` for R3/R4, `report_patients`
  for R5–R8, `report_own` for R10) and every **additional key** the report needs (§4: `view:payments` for
  R1/R2/R6/R7, `view:invoices` for R2/R5/R8/R10, `view:cash_closings` for R9), each with `viewScopeCovers`
  against the export's scope; the download repeats it (EY-10.6). An `own` report key is never covered by a
  `branch` key: R10 needs `view:report_own:own` itself.
- **Only the requester downloads, and only within today's reach.** `GET …/exports/:id` and the file link
  answer `not_found` to anyone else (ISO-02). For the requester, every download re-derives the current reach
  from the membership and role **now** — the key's scope, the branch list, or the `own` membership — and
  compares it with the export's stored `scope` and `params`: if the key is gone the answer is `forbidden`; if
  the reach got narrower (a branch in `params` is no longer reachable, or the scope dropped from `clinic` to
  `branch` or `own`) the answer is `not_found` and the file is not served. A wider reach changes nothing. An
  `own` export also stores the ids of the patients it holds; the download re-runs the `own` predicate
  through `BillingPatientReader.ownPatientFilter` — the same predicate the invoice list uses (§5.1,
  EY-10.6) — on them, and if any one has left the caller's reach the file is not served (`not_found`) and
  is **purged at once**: the blob is deleted, the row becomes `purged` with `storage_key` set to `NULL`, the row stays for the audit trail, and the caller must
  request a new export (EY-10.4). The file is served through the API (the blob store stays private),
  sealed like medical attachments if it holds patient names (R5–R8; ADR-0028 pattern).
- **Retention:** the file is deleted from the blob store at `expires_at` and the row becomes `expired`
  (F3-Q10 a). The row itself is never deleted (CLAUDE.md §5), and the stored `patient_ids` of an `own`
  export are cleared when the row expires, so no patient id outlives the file (EY-10.4).
- **Audit:** `finance_report.exported` (entity `finance_report_export`, one row, written when the winning attempt publishes the file, §7.2)
  records the report, date range, branch ids, row count — never a name or a reason. The exported reason of
  R7 and R8 stays in the file and never enters the audit row, not even its text (F3-Q8 b). For R5–R8 it is
  `patient_access` (the file holds names, EY-9.15 a); for the others `administrative`. 0068 adds the entity to
  `audit_log_patient_events_are_patient_access` where it applies and excludes it from
  `platform_clinic_admin_audit` and the policies `audit_log_platform_admin_rows` /
  `audit_log_platform_admin_insert`, as 0064 did for `payment`, `refund`, `patient_credit` and
  `cash_closing` (FIN-3).
- **Limits:** one running export per member; at most N queued per clinic (`export_busy`, 429).

## 8. SQL plan (needs the owner's yes before any SQL is written)

| File                                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0068_finance_reports_core.sql`            | Extends `permissions_key_check` with the 4 report resources (`report_takings`, `report_analytics`, `report_patients`, `report_own`) and inserts the 7 keys (`…c004b`–`…c0051`, EY-10.1). Creates `finance_report_exports` (§7.3) with RLS + policy + indexes + grants, with its `format` and `patient_ids` columns (EY-10.6), and the audit-entity changes of §7.4. Creates the view `finance_invoice_balances` (§5.2) and the report functions `finance_report_daily_takings`, `finance_report_period_summary`, `finance_report_by_service`, `finance_report_by_doctor`, `finance_report_cash_closings` (invoker, §5.1); both read the invoice day from `issued_at` in the clinic timezone until the contract step (EY-10.6). Adds the expand columns, all **nullable**: `invoices.business_date`, `payment_allocations.business_date`, `invoice_lines.discounted_by`, `invoices.discounted_by` (F3-Q1 a, EY-10.2, EY-10.5, see below).                                                 |
| `0069_finance_reports_indexes.sql`         | Only the indexes the plans need, each justified by an `EXPLAIN` in the PR: a partial `invoices (clinic_id, branch_id, issued_at) WHERE status = 'issued'` for R5 (the `business_date` indexes come with the contract step below, once the columns are filled); none for `invoice_lines` (the 0060 partial unique index `(clinic_id, invoice_id, position) WHERE archived_at IS NULL` already serves R3/R4); `payment_allocations (clinic_id, invoice_id) INCLUDE (amount_minor)` if the balance view needs it. Plain `CREATE INDEX` inside the migration (the runner applies each file in one transaction with its ledger row, so `CONCURRENTLY` is not used); kept as its own file so the index cost is visible in review.                                                                                                                                                                                                                                                              |
| `0070_finance_reports_release.sql`         | The release grants of EY-10.1 for existing clinics. The locked `clinic_admin` gains the three clinic keys `view:report_takings:clinic`, `view:report_analytics:clinic` and `view:report_patients:clinic` and nothing else (R2-4 again, F3-Q9 b): the 0063/0067 role statement (`module = 'finance' AND scope = 'clinic'`, locked `clinic_admin` only, `ON CONFLICT DO NOTHING`) now matches the three. No other existing role changes (FIN-4, R2-4: existing editable roles are never changed by a release): the receptionist's `view:report_takings:branch` and the doctor's `view:report_own:own` are the new-clinic defaults in `system-roles.ts` (EY-10.1, EY-9.14 a), and an existing clinic's admin grants them to its own roles. `db/maintenance/finance-release-catch-up.sql` already matches by predicate; `db/tests/finance-release-catch-up.sh` gains a `cmp` against 0070.                                                                                                   |
| `0071_finance_reports_platform_totals.sql` | Re-creates `finance_monthly_totals` with the same columns, now reading the stored `business_date` of the movements and `invoices.business_date` for the invoiced month (F3-Q13 a), so one definition of a day holds everywhere. It keeps the `eyadex_finance_totals_owner` of 0065 and its grant to `eyadex_platform`, and grants that owner `SELECT (business_date)` on `invoices`, `payments` and `refunds` (the 0061/0065 column grants do not cover it, so the function would fail with `permission denied` without it). It does **not** ship with 0068–0070: `db/migrate.sh` applies every pending file at once, so it would run before the backfills of step 3 and drop the invoices still `NULL` from the platform totals. It ships in the later release, in the same PR as the contract file (0072) and the stored-days file (0073), after the writers are live and the backfills are verified. Applying it to production needs the owner's own yes when it is ready (F3-Q13 a). |
| `0072_finance_reports_contract.sql`        | The contract step: `NOT NULL` on `invoices.business_date` and on `payment_allocations.business_date`, with the indexes `invoices (clinic_id, branch_id, business_date)` and `payment_allocations (clinic_id, business_date)` (the allocation row has no branch; R2 reaches the branch through its invoice) (F3-Q1 a, EY-10.5). It ships only after both backfills are verified (step 3), in the same PR as 0071 and 0073, and the three are applied together.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `0073_finance_reports_stored_days.sql`     | Re-creates the report functions and the view `finance_invoice_balances` on the stored days: the invoice day becomes the stored `invoices.business_date` instead of `issued_at` in the clinic timezone, and R2's credit-applied column reads `payment_allocations.business_date` (EY-10.6). It ships with the contract file (0072) and 0071, in one PR, applied together.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

`invoices.business_date` and `payment_allocations.business_date` follow **expand → backfill → contract**
(F3-Q1 a, EY-10.5), so a rolling deploy never meets a `NOT NULL` column that the running API does not write:

1. **Expand** (0068): add both columns nullable; nothing reads them yet.
2. **Writer**: deploy the API whose issue path sets `invoices.business_date` and whose every allocation writer
   sets `payment_allocations.business_date`: a payment's own allocations take that payment's `business_date`,
   a credit application's take its own clinic-timezone day, and every other path that inserts an allocation
   (the credit spends of a refund or a release) takes the business day of the movement that writes it, read
   after the locks like `payments.business_date`.
3. **Backfill and verify** (`db/maintenance/invoice-business-date-backfill.sql` and the new
   `db/maintenance/allocation-business-date-backfill.sql`, run by the orchestrator after step 2 is live): fill
   the rows still `NULL` (invoices from `issued_at`, allocations from `created_at`) in the clinic timezone, in batches; then a check query proves no
   row is `NULL`.
4. **Contract** (0072): adds `NOT NULL` on both columns and their indexes (`invoices (clinic_id, branch_id, business_date)`,
   `payment_allocations (clinic_id, business_date)`). It is released together with 0071 (the platform totals) and 0073 (the report functions and the
   view re-created on the stored days) — one PR, applied together, after the writers are live and the
   backfills are verified. Until 0073 is applied, the report functions and the view read `issued_at` in the
   clinic timezone (EY-10.6).

Negative tests (same PR as the SQL):

- `db/tests/rls-isolation.sql`: `finance_report_exports` joins the seed loop, the read-leak array, the
  write-leak `INSERT` block and the move-row `UPDATE clinic_id` array. **New blocks:** with clinic A's
  context, `finance_invoice_balances` and every report function return no row of clinic B; with no
  `app.clinic_id` they return zero rows and no error.
- `db/tests/finance.sql`: the finance key set grows from 23 to 30 (the 7 report keys of EY-10.1), with ids
  `…c0034`–`…c0051`; the view equals `settlement.ts` on the S1–S11 fixture; R2's month sums equal
  `finance_monthly_totals` for the same clinic and month — also after a timezone change, once 0071 is
  applied (F3-Q13 a) — including an edit, a void and a refund across two months (R1-17); lines with
  `archived_at` are not counted; on invoices with a line discount, an invoice discount and tax, Σ R3 (and Σ R4) + the tax row = Σ `total_minor` (the discount is subtracted once).
- `db/tests/finance-reports-platform.sql` (new): `eyadex_platform` has no privilege on the table, the view or
  any report function, and sees no `finance_report_export` audit row through the view or the policies;
  `eyadex_auth` and `eyadex_dispatcher` have none either.
- `db/tests/finance-release.sql`: after 0070 a locked admin holds every clinic-scope finance key (15: the
  twelve F1/F2 keys and the three clinic report keys); the receptionist, the doctor and every custom role of an
  existing clinic gain nothing (FIN-4); a new clinic's receptionist and doctor templates hold exactly one
  report key each (`view:report_takings:branch` and `view:report_own:own`).
- **The report key split (EY-10.1)** — in the release test and in the API db specs of slice 3: a
  receptionist reaches R1, R2 and R9 only; a role with `view:report_patients:branch` and no `view:invoices`
  gets nothing from R5; `report_own` never opens R5.
- `db/tests/fk-indexes.sql` passes (the export table has no FK beyond `clinic_id`).

## 9. Slices and delivery (each PR about 3,000 changed lines, one merge each, owner's yes before each)

| #   | Slice                            | Who                    | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Rough size |
| --- | -------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | Contracts                        | implementer (per run)  | `packages/contracts/src/finance-reports.ts`: report query and row schemas (R1–R10), export request/status schemas, error codes (`export_busy`, `report_range_too_long`, `export_amount_too_large`), CSV and XLSX column definitions shared with the mock. No keys yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ~1,500     |
| 2   | SQL + RLS + negative tests       | implementer            | 0068–0070 as approved (0071–0073 ship later with the contract step, §8), the 7 keys in contracts and `system-roles.ts` (the new-clinic templates of EY-10.1 in the same slice), the `db/tests` of §8. The pipeline of issue #105 lands before this slice's SQL, because the export table's lease and fencing columns are part of it (#106). Staging first; production after the owner's yes and a backup.                                                                                                                                                                                                                                                                                                                            | ~2,500     |
| 2b  | Writers + backfills              | implementer            | The F1/F2 billing paths that fill the expand columns of 0068: the issue path sets `invoices.business_date`, every path that inserts a `payment_allocations` row (payment, credit application, and any other writer found in billing) sets its `business_date`; the issue and edit paths set `invoices.discounted_by` and `invoice_lines.discounted_by`, and an edit that keeps a line's discount unchanged carries its `discounted_by` over to the new line row instead of the editor (EY-10.2, EY-10.5); the web mock mirrors them. Plus `db/maintenance/invoice-business-date-backfill.sql` and `allocation-business-date-backfill.sql` with their check queries. Lands after slice 2 and before the contract release (0071–0073). |
| 3   | Domain + API — on-screen reports | implementer            | `billing/domain/report-scope.ts` (scope → branch ids, the extra-key rule of §3), the controllers and queries for R1–R10 (R10 per the doctor's own lines, F3-Q4 c), cursor lists for R5–R8, db specs per report and per scope, including the three key-split cases of §8 (a receptionist reaches R1/R2/R9 only, `report_patients` without `view:invoices` gets nothing from R5, `report_own` never opens R5).                                                                                                                                                                                                                                                                                                                         | ~3,000     |
| 4   | Exports (API + worker)           | implementer            | Export routes and their outbox events, `apps/worker/src/finance-exports/` (the pipeline agreed in issue #105: re-check access, build the CSV or the XLSX, store, expire), the CSV refusal over 15 significant digits and the XLSX text cells (EY-10.3), the purge of a refused `own` export (EY-10.4), audit, db specs incl. the revoked-access and expiry cases. `CLAUDE.architecture.md` §2.2 billing row.                                                                                                                                                                                                                                                                                                                         | ~3,000     |
| 5   | Lovable web brief                | Orchestrator → Lovable | `.lovable/plan/p4-f3-web-<date>.md`, Plan mode first: «التقارير» nav item, one screen per report, filters, export button and status, the mock mirroring every rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ~3,000     |
| 6   | Review loop, staging, production | Orchestrator           | Codex + MergePilot on every PR, at most 3 fix rounds, blocking findings only; staging against the real API; SQL first in production, backup first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —          |

Web rules (slice 5): Arabic first, RTL, logical CSS, every string ar + en, «المراجع» never «المريض»,
amounts through `formatMinor`, loading / empty / error states, 1440px and 390px, a totals row that matches
the sum of the rows, and the date range picker in the clinic timezone.

## Open review items

- The export table's lease and fencing columns must be designed before slice 2's SQL, so the #105 gate moves earlier (tracked in #105).

Everything else that was open here is settled by EY-10 (§12): the discount giver of R8 is stored on the row,
a big amount is refused in CSV and written as a text cell in XLSX, and the report key split is defined.

## 10. Questions for the owner (F3-Q1 … F3-Q13)

All questions were answered on 2026-10-21; the answers are recorded in §11.

## 11. Owner decisions (EY-9, 2026-10-21)

Waleed's answers, verbatim from his cards (relayed by the super admin session). Where an answer is not the
recommendation it says so, with what changes.

| Question | Answer (verbatim)                                                                                       | Decision                                                                                               | What changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F3-Q1    | «نحفظ يومها وقت إصدارها (المقترح)»                                                                      | (a) store `invoices.business_date` at issue                                                            | expand → backfill → contract (§8); the platform function moves with it (F3-Q13)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F3-Q2    | «30/60/90/أكتر (المقترح)»                                                                               | (a) 0–30 / 31–60 / 61–90 / over 90                                                                     | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F3-Q3    | «سطر ضريبة واحد (المقترح)» (asked again on the tax-only wording; replaces the first answer «سطر لوحده») | (a) `line_total_minor` per service/doctor plus one report-level tax line; rows + tax = Σ `total_minor` | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F3-Q4    | «إيراد خدماته هو بس»                                                                                    | **(c), not the recommendation**: R10 shows the revenue of the doctor's own lines only                  | R10 is per line, not per whole invoice: own lines = `provider_id` = caller AND the invoice is in the caller's `own` reach (amended R2-6 in §1)                                                                                                                                                                                                                                                                                                                                                                                          |
| F3-Q5    | «CSV وExcel»                                                                                            | **(b), not the recommendation**: CSV and XLSX                                                          | an XLSX writer is a new dependency (the 24 h supply-chain guard applies); typed text cells keep big amounts exact (issue #106) and the formula guard applies to every text cell                                                                                                                                                                                                                                                                                                                                                         |
| F3-Q6    | «سنة شاشة، 3 سنين تصدير (المقترح)»                                                                      | (a) 366 days on screen, 3 years in export, every export a background job                               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F3-Q7    | «باسم المريض»                                                                                           | **(a), not the recommendation**: R8 lists the patient's name                                           | R8 holds patient data: its export follows the R5–R7 rules (audited, 24 h)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F3-Q8    | «يطلع في الملف كمان»                                                                                    | **(b), not the recommendation**: refund and discount reasons are exported                              | reasons are free text in a file that leaves the system; length-capped as stored, formula-guarded                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F3-Q9    | «والريسبشن كمان»                                                                                        | **(b), not the recommendation**: the receptionist also gets `view:finance_reports:branch`              | defaults: admin `clinic`, doctor `own` (R10 only, per F3-Q4); receptionist R1, R2 and R9 only (EY-9.14 (a)); R5–R8 need the admin's grant. One `view:finance_reports` key cannot express that, because the receptionist template already holds the extra keys of R5, R7 and R8: the SQL plan must split the key (a separate key for the patient-named R5–R8, issue #106), and until that split exists 0070 grants the receptionist no report key at all. R9's extra key `view:cash_closings:branch` is already in the template since F2 |
| F3-Q10   | «24 ساعة (المقترح)»                                                                                     | (a) 24 hours                                                                                           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F3-Q11   | «مباشرة من الجداول (المقترح)»                                                                           | (a) live queries                                                                                       | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F3-Q12   | «أيوه، للعيادة كلها (المقترح)»                                                                          | (a) R6 in F3, clinic scope                                                                             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F3-Q13   | «نوحّد الحساب (المقترح)»                                                                                | (a) the platform totals move to `business_date` in a new SQL file                                      | applying that file to production needs the owner's own yes when it is ready                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Points raised back to the owner with these answers (all three decided 2026-10-21):

1. **Decided (EY-9.14, «التحصيل والكاش بس (المقترح)», option (a)):** the receptionist's default `branch`
   grant covers R1, R2 and R9 only; the patient-named reports R5–R8 and their exports need the admin's grant.
2. **Decided (EY-9.15, «سجل زي فتح ملف مريض (المقترح)», option (a)):** every export of R5–R8 writes a
   patient-data access audit row (who, which report, which range), the same as opening a patient file.
3. **Decided (EY-9.16, «المبلغ المطلوب بس (المقترح)», option (a)):** R10 shows only the billed amount of
   the doctor's own lines per month, with no paid or owed columns (payments name an invoice, not a line).

ADR-0035 (`docs/adr/0035-finance-reports.md`) is written with the first F3 slice, from §11 and the answers
to the three points above; nothing is built before it. The discount-giver rule of R8 stays open in issue
#106 (attribution per discount, not per invoice edit).

## 12. Owner decisions (EY-10, 2026-10-23)

The owner's decisions of 2026-10-23, recorded in GitHub issue #106. They settle what §11 and the open items
left open — among them the discount giver of R8, which EY-10.2 stores on the row instead of reading
`audit_log`. Where §11 still names `view:finance_reports:branch` (F3-Q9) or leaves the R8 discount giver
open, EY-10.1 and EY-10.2 supersede it. §3–§9 and ADR-0035 are updated to match.

| #       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EY-10.1 | Report permission split into 4 report groups, one resource each: `report_takings` (R1, R2, R9; scopes clinic, branch), `report_analytics` (R3, R4; clinic, branch), `report_patients` (R5–R8, the patient-named reports; clinic, branch — no `own`), `report_own` (R10; own only). So 7 keys: `view:report_takings:clinic`, `view:report_takings:branch`, `view:report_analytics:clinic`, `view:report_analytics:branch`, `view:report_patients:clinic`, `view:report_patients:branch`, `view:report_own:own`. Defaults: locked clinic admin = the three clinic keys; receptionist = `view:report_takings:branch` only (EY-9.14); doctor = `view:report_own:own` (F3-Q9). New clinics' templates in `system-roles.ts` get the same, in the same slice.                                                                                                                                                    |
| EY-10.2 | "Who gave the discount" (R8) is stored on the line: `invoice_lines.discounted_by uuid NULL` and `invoices.discounted_by uuid NULL` (membership id), written by the issue and edit paths when a discount is set; older discounts show «—». R8 does not read `audit_log`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| EY-10.3 | CSV refuses an export with any amount over 15 significant digits; XLSX writes amounts as text cells.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| EY-10.4 | An `own` export whose download is refused because a patient left the reach is purged at once; its row stays for audit and its stored patient ids are cleared when the row expires.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| EY-10.5 | Credit applications store their clinic business day: `payment_allocations.business_date date NULL`, written by the credit-application path, backfilled, then `NOT NULL` in the contract step; R2's credit-applied column reads it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| EY-10.6 | Technical items settled the safest way: every report that shows invoices or payments also needs a covering `view:invoices` / `view:payments` key (R1, R2, R5–R10 named in the §4 rows, re-checked at run and at download); an `own` report key is never covered by a `branch` key; the report functions and `finance_invoice_balances` read `issued_at` in the clinic timezone until the contract step, and a later file in that same release re-creates them on the stored `business_date` columns together with 0071; the export row records `format` (`csv`/`xlsx`) and, for an `own` export, its patient ids in a `patient_ids uuid[]` column; the `own` re-check goes through `BillingPatientReader.ownPatientFilter`; §1 says F3 adds `invoices.business_date`, `payment_allocations.business_date`, the two `discounted_by` columns, re-creates `finance_monthly_totals`, and amends R2-6 for R10. |
