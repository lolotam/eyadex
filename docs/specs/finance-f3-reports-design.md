# Finance F3 — reports (design draft)

- Status: **owner decisions taken 2026-10-21** (EY-9, §11). Nothing here is built. Five answers differ from
  the recommendation (F3-Q4, Q5, Q7, Q8, Q9), and the body of §3–§8 is updated to them in the next revision
  of this file before any slice starts; §11 wins where they disagree. The slices of §9 still wait for the
  owner's yes on the SQL plan, and the open items of issues #105 and #106.
- Parent spec: `docs/specs/finance-design.md` (§2 shared rules, §3 F1, §4 F2, §8–§8d binding review rules).
  This file replaces the §5 outline there.
- Decision record: none yet. When the owner approves, the decisions of this file go into **ADR-0035**
  (`docs/adr/0035-finance-reports.md`; the latest ADR is 0034).
- Vocabulary: «تقارير المالية» (finance reports), «المراجع» (never «المريض»), «موظف الاستقبال». Amounts show
  with the clinic currency code, e.g. «12.500 د.ك».

## 1. What F3 is, and what it is not

F3 is **read-only**. It adds report screens, report endpoints and a CSV export over the tables F1 and F2
already write. It writes no money row, changes no F1/F2 table or rule, and stores no balance (§4.3 of the
parent spec: every balance is derived).

Binding rules it inherits (not re-asked here):

- **FIN-18:** revenue by day/period, branch, doctor, service and method; outstanding balances; discounts;
  cash closings; Excel/CSV export.
- **R1-17 (monthly totals):** `invoiced` = Σ `total_minor` of non-void invoices by the clinic-timezone month
  of `issued_at`, **as they stand now** (an edit or void restates its month); `collected` = Σ payments by
  payment date; `refunded` = Σ refunds by refund date. The platform function (`finance_monthly_totals`,
  0061/0065) and the clinic reports use these same definitions. A credit application is not collected money.
- **R1-18 + R2-6 (doctor reports):** `view:finance_reports:own` uses **the same reach as
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
   platform function 0061 already computes it live. F3-Q1 decides whether F3 freezes it.
2. **Tax is not on the lines.** `computeInvoiceTotals` (`packages/contracts/src/invoice-totals.ts`) applies
   the line discount, then **allocates the invoice-level discount to the lines**, so the stored
   `line_total_minor` is already net of both discounts. Tax is computed per line but stored only on the
   invoice (`tax_minor`; `invoice_lines` has no tax column), and `total_minor = Σ line_total_minor + tax_minor`.
   So a per-service or per-doctor sum of `line_total_minor` must **not** subtract the invoice discount again;
   the only gap to the invoices' total is the tax (F3-Q3).

## 3. Permissions (new resource; module `finance`)

| Resource          | Actions and scopes           | Meaning                                                                                       |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------------------------- |
| `finance_reports` | view `clinic`/`branch`/`own` | Every report screen, report endpoint and export. No separate export key: an export is a view. |

- **3 new keys**: `view:finance_reports:clinic`, `view:finance_reports:branch`, `view:finance_reports:own`,
  catalogue ids `00000000-0000-7000-8000-0000000c004b` … `…c004d` (the last F2 id is `…c004a`, 0064), in
  `PERMISSION_CATALOG` order, module `finance`. `own` joins the `CLINIC_BOUND` granting rule like the other
  `own` keys (R1-12).
- **Scope meaning:** `clinic` = every branch; `branch` = the caller's branches (the movement's branch for
  payments and refunds, the invoice's branch for invoices and balances, the closing's branch for closings,
  F2-Q8); `own` = the invoices of the caller's own patients (R2-6), and only the reports of §4 marked `own`.
- **A report is not a back door.** A report row never shows more than the caller could reach through the
  existing list screens with the same scope; a report that lists receipts or refunds also needs
  `view:payments` at a scope that covers it, and the closing report also needs `view:cash_closings`
  (`viewScopeCovers`, issue #93). §4 lists the extra key per report.
- Code that moves with the keys (as in parent §4.1): `resourceSchema` (+ `finance_reports`), the
  `permissionSchema` regex, `resourceGrants`, the written-out `PERMISSION_KEYS`, `system-roles.ts`, the web
  role matrix group «المالية» («التقارير»), the mock's seed roles; the keys land in the same PR as the SQL
  that seeds them (a test pins `PERMISSION_KEYS` to the seeded table).
- Default grants for new and existing clinics: F3-Q9.

## 4. Reports

All amounts are minor units as decimal strings (`minorAmountSchema`), with the clinic `currency` and
`currency_exponent` on the response. All dates are clinic-timezone business days (§6). Every report takes a
`from`/`to` date range (inclusive, F3-Q6 bounds it) and an optional branch filter inside the caller's reach.

| #   | Report (screen)                                 | Rows / grouping                                                                                                                                                             | Source                                                                                                    | Key and scope                                                           | Patient data?                                                                             |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| R1  | Daily takings «الإيراد اليومي»                  | per business day × branch × method: `inMinor` (payments), `outMinor` (refunds), `netMinor`; totals row                                                                      | `payments`, `refunds` by `business_date`                                                                  | `finance_reports` `clinic`/`branch`                                     | no (aggregates only)                                                                      |
| R2  | Period summary «ملخص الفترة»                    | per month (or day) × branch: `invoicedMinor`, `discountMinor`, `taxMinor`, `collectedMinor`, `refundedMinor`, `creditAppliedMinor` (information, not collected), void count | `invoices` (R1-17, non-void, by issue day), `payments`, `refunds`, `payment_allocations` with `credit_id` | `clinic`/`branch`                                                       | no                                                                                        |
| R3  | Revenue by service «الإيراد حسب الخدمة»         | per service (and «بنود حرة» for free lines): line count, quantity, billed amount                                                                                            | live lines (`archived_at IS NULL`) of non-void invoices, by the invoice's issue day                       | `clinic`/`branch`                                                       | no                                                                                        |
| R4  | Revenue by doctor «الإيراد حسب الدكتور»         | per line provider (`provider_id`; lines with none are «بدون دكتور»): line count, billed amount                                                                              | same as R3, grouped by `provider_id`                                                                      | `clinic`/`branch` only (R2-6: no per-provider split for `own`)          | no; doctor names are staff names                                                          |
| R5  | Outstanding balances «المبالغ المستحقة» (aging) | per issued invoice with `owed > 0`: number, branch, issue day, total, paid, owed, age bucket; summary per bucket and branch                                                 | `invoices` + live allocations (§5.2)                                                                      | `clinic`/`branch`/`own` (+ `view:invoices` at a covering scope)         | **yes**: the patient's display name and invoice number per row                            |
| R6  | Patient credit «أرصدة المراجعين»                | per patient with credit balance > 0: balance, oldest credit day                                                                                                             | `patient_credits` − allocations funded by them − `refund_sources` (§4.3 `remaining`)                      | `clinic` only (credit is clinic-wide, F2-Q7) (+ `view:payments:clinic`) | **yes**: names                                                                            |
| R7  | Refunds «المستردات»                             | per refund: number, business day, branch, method, amount, source (payment or credit), refunded by; reason as text only on screen, never in CSV (F3-Q8)                      | `refunds`, `refund_sources`                                                                               | `clinic`/`branch` (+ `view:payments` covering)                          | **yes**: names                                                                            |
| R8  | Discounts «الخصومات»                            | per invoice with `discount_minor > 0`: number, issue day, branch, discount amount, kind (line/invoice), who set it (from `audit_log`, note below); reason only on screen    | `invoices`, `invoice_lines.line_discount`, `invoices.invoice_discount`                                    | `clinic`/`branch` (F3-Q7) (+ `view:invoices` covering, like R5)         | **yes**: names (or none, F3-Q7)                                                           |
| R9  | Cash closings «سجل إقفال الصندوق»               | per closing: business day, branch, expected, counted, difference, closed by, note present (yes/no); totals of differences                                                   | `cash_closings` only (never `method_totals`, R3-8)                                                        | `clinic`/`branch` (+ `view:cash_closings` covering)                     | no                                                                                        |
| R10 | Doctor's own summary «ملخص فواتيري»             | per month: invoiced, paid, owed of the invoices in the caller's `own` reach — whole invoices (R2-6)                                                                         | `invoices` + `finance_invoice_balances`, filtered by `ownPatientFilter` (§5.1)                            | `own` only                                                              | aggregates on screen; the drill-down is the invoices list the doctor already sees (F3-Q4) |

Notes:

- **R1 and R2 against the platform totals — open (F3-Q13).** R1 and R2 group payments and refunds by their
  stored `business_date`, but `finance_monthly_totals` (0065) converts `received_at`/`refunded_at` with the
  clinic's **current** timezone (and 0061 does the same for `issued_at`). While the timezone never changes the
  two agree; after a change, a movement near a month boundary can fall in a different month in each, so
  "clinic reports = platform totals" is not guaranteed today. Until the owner decides F3-Q13, F3 asserts
  it only for a clinic whose timezone has not changed. Within F3 itself, a month of R1 equals R2's
  `collectedMinor` of that month (both read `business_date`).
- **R3/R4 are billed revenue, not collected.** Payments name an invoice, not a line, so collected money
  cannot be split by service or doctor without a rule (F3-Q3 covers billed; collected per doctor is
  commission territory, FIN-19).
- **R4 and R2-6.** R4 groups the clinic's lines by `provider_id` for a clinic or branch reader; it is a
  management view of who billed what, not a commission statement. A doctor holding only `own` gets R10,
  which never splits an invoice by line (F3-Q4 asks whether R10 waits for FIN-19 instead).
- **R8 "who set the discount"** never comes from `invoices.created_by` (that is who issued it; a later edit
  can add or change the discount). It is the `actor_user_id` (0011) of the newest `audit_log` row with
  `entity_type = 'invoice'` for that invoice whose action is `invoice.issued` (snapshot `after.discounts`
  not empty) or `invoice.edited` (snapshot `before.discounts` ≠ `after.discounts`); the `discounts` array of
  `invoiceAuditSnapshot` (`packages/contracts/src/finance-audit-snapshot.ts`) carries each line and invoice
  discount. The staff name is resolved the way the clinic audit screen resolves `actor_user_id` (slice 10).
- **R5 age** is counted from the invoice's issue day to today (clinic timezone). The buckets are F3-Q2.
- Reports **R5–R8 show patient names** inside the caller's reach, read in one batch through
  `BillingPatientReader.displayNames`, with **no `patient_access` audit row** (parent §8c item 4, as the F1
  and F2 lists do). Export of those reports is audited (§7.4).

## 5. Where the data comes from (SQL under RLS)

### 5.1 Pattern

- **Report functions, not table reads in TypeScript.** Each aggregate report with a `clinic`/`branch` scope (R1–R4, R9) is one
  `LANGUAGE sql STABLE` function with **`SECURITY INVOKER`** (the default), taking `(p_from date, p_to date,
p_branch_ids uuid[])` and returning a fixed row type. Invoker rights mean the caller's RLS applies: under
  `withTenant` it sees only its clinic, and with no `app.clinic_id` it sees zero rows (CLAUDE.md §5). The
  branch reach is computed by the API (as `branch-condition.ts` does today) and passed as `p_branch_ids`;
  the function never widens it.
- **One invoker view for balances** (§5.2), `CREATE VIEW … WITH (security_invoker = true, security_barrier
= true)`. The repo has no `security_invoker` view yet (its views are definer views for the platform); this
  is the first, so the SQL slice adds a test that the view honours RLS (§8).
- **Grants:** `EXECUTE` on each function and `SELECT` on the view to `eyadex_app` only;
  `REVOKE ALL … FROM PUBLIC, eyadex_platform, eyadex_auth, eyadex_dispatcher`. No function is
  `SECURITY DEFINER` and none needs a new owner role (unlike 0061/0066, which must see across RLS).
- **Patient rows (R5–R8) stay plain queries** in `apps/api/src/modules/billing/queries/` with cursor
  pagination, like `invoice-list.ts` and `payment-list.ts`, joined to the balance view for R5.
- **Every `own` read (R10, and R5 for an `own` reader) is a plain query, never a function.** The `own` reach
  is not a date and a branch list: it is the caller's membership and its appointment or visit links (R1-12).
  The query applies exactly the predicate the invoice list applies today —
  `BillingPatientReader.ownPatientFilter(membershipId, sql\`i.patient_id\`)`(port`apps/api/src/modules/billing/ports/billing-patients.ts`, implementation
`apps/api/src/modules/patients/persistence/pg-billing-patients.ts`), chosen the way
`use-cases/reads/reads.ts` `condition(reach)`chooses it — and sums over`finance_invoice_balances`. Why a
query and not a function taking `membershipId`: the predicate belongs to the patients module (billing never
names the appointments or visits relations), so a SQL copy of it would be a second definition of `own`that could drift from the invoice list's. RLS stays the clinic wall under`withTenant`; the predicate only
narrows inside the clinic. A test asserts that R10's invoice set equals `GET /v1/invoices` for the same
  doctor.

### 5.2 Derived balances

`finance_invoice_balances` (view, invoker): one row per invoice — `clinic_id`, `id`, `branch_id`,
`patient_id`, `status`, `issued_at`, `total_minor`, `paid_minor`, `owed_minor` — where, as in
`packages/contracts/src/settlement.ts`:

- `live(a) = a.amount_minor − Σ patient_credits.amount_minor WHERE origin_allocation_id = a.id`
- `paid_minor = Σ live(a)` over the invoice's allocations; `owed_minor = total_minor − paid_minor` for an
  issued invoice, `0` for a void one.

A test asserts that the view and the shared `settlement.ts` functions agree on every row of the parent §4.3
table (S1–S11). The API keeps using `settlement.ts` for single invoices; the view exists for lists and
sums only.

## 6. Time and business days

- **The clinic timezone** (`clinics.timezone`) defines every day, month and "today", exactly as F2 does
  (`instantToWall`, `payment-rules.ts`). The API never uses the server's or the browser's timezone.
- **Movements** (payments, refunds, closings) group by their stored `business_date`. A movement never
  changes day.
- **Invoices** group by their issue day: by default `(issued_at AT TIME ZONE clinics.timezone)::date`,
  computed in the function; with F3-Q1 = (a), by a stored `invoices.business_date` instead. R1-17 already
  fixes that an edit or void restates the invoice's **issue** month; it never moves it to the edit's day.
- **Date filters** are `date` values (`dateSchema`), inclusive both ends, never client timestamps — the rule
  of `GET /v1/payments` today.
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
  **Precision:** Excel keeps 15 significant digits, and a `bigint` minor amount can have more. An amount is
  written as a number only while its digits (major and minor parts, without sign) fit in 15; beyond that it
  is written as quoted text with all its decimals (`"1234567890123.456"`), so no digit is ever rounded
  away. Counts are always numbers (they never reach 15 digits).
- **XLSX**: F3-Q5.
- **PDF**: waits for slice 8g (the F1 PDF renderer, parked to the project end; parent §3.3 and
  `finance-f1-pdf-design.md`). F3 adds no PDF route; the screen offers the browser's print.

### 7.2 Sync or worker job

CLAUDE.md §6: anything expected to exceed 200 ms is a worker job.

- **On screen:** reports return JSON, aggregates in one call, patient lists cursor-paginated (page ≤ 100).
  These stay under 200 ms with the indexes of §8 for the bounded range of F3-Q6.
- **Every export is a worker job** — simplest rule, no size guess. `POST /v1/finance-reports/exports`
  stores a request row and returns `202` with its id; the worker builds the file; the screen polls
  `GET /v1/finance-reports/exports/:id` and downloads when `done`. (F3-Q6 offers a sync path for small
  aggregates instead.)
- **The worker has no job queue library.** `apps/worker` has two mechanisms only: the `OutboxPoller`
  (`apps/worker/src/shared/outbox-poller.ts`) over `outbox_events` (0025/0029), claimed through
  `DispatcherOutbox.claimNext` (`packages/db/src/dispatcher.ts`) as `eyadex_dispatcher`, and `PeriodicJob`
  timers. `claimNext` runs its handler inside the claim transaction (30 s `statement_timeout` and
  `idle_in_transaction_session_timeout`), so no file is ever built inside a claim. The request writes the
  export row and an `outbox_events` row (the clinic's `clinic_id`, the export id only) in one `withTenant`
  transaction; the worker reads only inside `withTenant(event.clinicId)`.

#### Export pipeline — design open, decided before the export slice's SQL

The runner's internals are tracked in issue #105 ("F3: design the finance export pipeline") and are
agreed there before slice 4's SQL is written. Whatever design wins must meet these binding requirements:

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
ids, language; no patient field), `scope` (`clinic`/`branch`/`own`, the scope the request was granted),
`status` (`queued`/`running`/`done`/`failed`/`expired`), `storage_key text NULL` (under
`clinic/<clinic_id>/finance-exports/`, the 0049 pattern; the attempt and lease columns follow issue #105), `byte_size int NULL`, `row_count int
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
  every **additional key** the report needs (§3: `view:invoices` for R5/R8, `view:payments` for R6/R7,
  `view:cash_closings` for R9), each with `viewScopeCovers` against the export's scope; the download repeats it.
- **Only the requester downloads, and only within today's reach.** `GET …/exports/:id` and the file link
  answer `not_found` to anyone else (ISO-02). For the requester, every download re-derives the current reach
  from the membership and role **now** — the key's scope, the branch list, or the `own` membership — and
  compares it with the export's stored `scope` and `params`: if the key is gone the answer is `forbidden`; if
  the reach got narrower (a branch in `params` is no longer reachable, or the scope dropped from `clinic` to
  `branch` or `own`) the answer is `not_found` and the file is not served. A wider reach changes nothing. An
  `own` export also stores the ids of the patients it holds; the download re-runs the `own` predicate
  (`own-patients.ts`: non-cancelled appointments or visits) on them, and if any one has left the caller's
  reach the file is not served (`not_found`) and the caller must request a new export. The file is served through the API (the blob store stays private), sealed
  like medical attachments if it holds patient names (R5–R8; ADR-0028 pattern).
- **Retention:** the file is deleted from the blob store at `expires_at` and the row becomes `expired`
  (F3-Q10). The row itself is never deleted (CLAUDE.md §5).
- **Audit:** `finance_report.exported` (entity `finance_report_export`, one row, written when the winning attempt publishes the file, §7.2)
  records the report, date range, branch ids, row count — never a name or a reason. For R5–R8 it is
  `patient_access` (the file holds names); for the others `administrative`. 0068 adds the entity to
  `audit_log_patient_events_are_patient_access` where it applies and excludes it from
  `platform_clinic_admin_audit` and the policies `audit_log_platform_admin_rows` /
  `audit_log_platform_admin_insert`, as 0064 did for `payment`, `refund`, `patient_credit` and
  `cash_closing` (FIN-3).
- **Limits:** one running export per member; at most N queued per clinic (`export_busy`, 429).

## 8. SQL plan (proposed; needs the owner's yes before any SQL is written)

| File (proposed)                    | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0068_finance_reports_core.sql`    | Extends `permissions_key_check` (resource `finance_reports`) and inserts the 3 keys (`…c004b`–`…c004d`). Creates `finance_report_exports` (§7.3) with RLS + policy + indexes + grants, and the audit-entity changes of §7.4. Creates the view `finance_invoice_balances` (§5.2) and the report functions `finance_report_daily_takings`, `finance_report_period_summary`, `finance_report_by_service`, `finance_report_by_doctor`, `finance_report_cash_closings` (invoker, §5.1). If F3-Q1 = (a): adds `invoices.business_date date` **nullable** only (expand step, see below).                                                                                                            |
| `0069_finance_reports_indexes.sql` | Only the indexes the plans need, each justified by an `EXPLAIN` in the PR: a partial `invoices (clinic_id, branch_id, issued_at) WHERE status = 'issued'` for R5 (or `(clinic_id, branch_id, business_date)` with F3-Q1 = (a)); none for `invoice_lines` (the 0060 partial unique index `(clinic_id, invoice_id, position) WHERE archived_at IS NULL` already serves R3/R4); `payment_allocations (clinic_id, invoice_id) INCLUDE (amount_minor)` if the balance view needs it. Plain `CREATE INDEX` inside the migration (the runner applies each file in one transaction with its ledger row, so `CONCURRENTLY` is not used); kept as its own file so the index cost is visible in review. |
| `0070_finance_reports_release.sql` | R2-4 again: the 0063/0067 role statement (`module = 'finance' AND scope = 'clinic'`, locked `clinic_admin` only, `ON CONFLICT DO NOTHING`), so each existing locked admin gains `view:finance_reports:clinic` and nothing else (F3-Q9). `db/maintenance/finance-release-catch-up.sql` already matches by predicate; `db/tests/finance-release-catch-up.sh` gains a `cmp` against 0070.                                                                                                                                                                                                                                                                                                       |

If F3-Q1 = (a), `invoices.business_date` follows **expand → backfill → contract**, so a rolling deploy never
meets a `NOT NULL` column that the running API does not write:

1. **Expand** (0068): add the column nullable; nothing reads it yet.
2. **Writer**: deploy the API whose issue path sets `business_date` (the clinic-timezone day of `issued_at`,
   read after the locks, like `payments.business_date`).
3. **Backfill and verify** (`db/maintenance/invoice-business-date-backfill.sql`, run by the orchestrator
   after step 2 is live): fill the rows still `NULL` from `issued_at` in the clinic timezone, in batches; then
   a check query proves no row is `NULL`.
4. **Contract**: a later forward-only file (the next free number at that time) adds `NOT NULL` and the
   `(clinic_id, branch_id, business_date)` index; reports switch to the column only after it.

Negative tests (same PR as the SQL):

- `db/tests/rls-isolation.sql`: `finance_report_exports` joins the seed loop, the read-leak array, the
  write-leak `INSERT` block and the move-row `UPDATE clinic_id` array. **New blocks:** with clinic A's
  context, `finance_invoice_balances` and every report function return no row of clinic B; with no
  `app.clinic_id` they return zero rows and no error.
- `db/tests/finance.sql`: the finance key set grows from 23 to 26; the view equals `settlement.ts` on the
  S1–S11 fixture; R2's month sums equal `finance_monthly_totals` for the same clinic and month with an
  unchanged timezone, including an edit, a void and a refund across two months (R1-17) — after a timezone
  change the test follows F3-Q13; lines with `archived_at` are not counted; on invoices with a line discount, an invoice discount and tax, Σ R3 (and Σ R4) + the tax row = Σ `total_minor` (the discount is subtracted once).
- `db/tests/finance-reports-platform.sql` (new): `eyadex_platform` has no privilege on the table, the view or
  any report function, and sees no `finance_report_export` audit row through the view or the policies;
  `eyadex_auth` and `eyadex_dispatcher` have none either.
- `db/tests/finance-release.sql`: after 0070 a locked admin holds every clinic-scope finance key (13); a
  receptionist, doctor or custom role gains nothing.
- `db/tests/fk-indexes.sql` passes (the export table has no FK beyond `clinic_id`).

## 9. Slices and delivery (each PR about 3,000 changed lines, one merge each, owner's yes before each)

| #   | Slice                            | Who                    | Contents                                                                                                                                                                                                                                                        | Rough size |
| --- | -------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Contracts                        | implementer (per run)  | `packages/contracts/src/finance-reports.ts`: report query and row schemas (R1–R10), export request/status schemas, error codes (`export_busy`, `report_range_too_long`), CSV column definitions shared with the mock. No keys yet.                              | ~1,500     |
| 2   | SQL + RLS + negative tests       | implementer            | 0068–0070 as approved, the keys in contracts and `system-roles.ts`, the `db/tests` of §8. Staging first; production after the owner's yes and a backup.                                                                                                         | ~2,500     |
| 3   | Domain + API — on-screen reports | implementer            | `billing/domain/report-scope.ts` (scope → branch ids, the extra-key rule of §3), the controllers and queries for R1–R10, cursor lists for R5–R8, db specs per report and per scope.                                                                             | ~3,000     |
| 4   | Exports (API + worker)           | implementer            | Export routes and their outbox events, `apps/worker/src/finance-exports/` (the pipeline agreed in issue #105: re-check access, build CSV, store, expire), audit, db specs incl. the revoked-access and expiry cases. `CLAUDE.architecture.md` §2.2 billing row. | ~3,000     |
| 5   | Lovable web brief                | Orchestrator → Lovable | `.lovable/plan/p4-f3-web-<date>.md`, Plan mode first: «التقارير» nav item, one screen per report, filters, export button and status, the mock mirroring every rule.                                                                                             | ~3,000     |
| 6   | Review loop, staging, production | Orchestrator           | Codex + MergePilot on every PR, at most 3 fix rounds, blocking findings only; staging against the real API; SQL first in production, backup first.                                                                                                              | —          |

Web rules (slice 5): Arabic first, RTL, logical CSS, every string ar + en, «المراجع» never «المريض»,
amounts through `formatMinor`, loading / empty / error states, 1440px and 390px, a totals row that matches
the sum of the rows, and the date range picker in the clinic timezone.

## 10. Questions for the owner (F3-Q1 … F3-Q13)

Each question has options and a recommendation. Waleed decides; nothing below is decided.

1. **F3-Q1 — The invoice's day in reports.** Payments and refunds store their business day; invoices store
   only `issued_at`. (a) Add `invoices.business_date`, set at issue and backfilled for existing invoices, so
   an invoice never changes day if the clinic timezone is edited — and then the platform function must
   move to the stored day too (F3-Q13 (a)), or clinic reports and platform totals differ after a change; (b) compute it at read time from
   `issued_at` and the current clinic timezone, as the platform function does today. **Recommendation:
   (a)** — the F2 rule, and a small change to the issue path.
2. **F3-Q2 — Aging buckets for outstanding balances (R5).** (a) 0–30, 31–60, 61–90, over 90 days from the
   issue day; (b) 0–7, 8–30, 31–90, over 90; (c) set by each clinic. **Recommendation: (a)** — the usual
   finance buckets.
3. **F3-Q3 — Tax in the service and doctor reports (R3, R4).** Line amounts are already net of the line
   and invoice discounts (§2). (a) Show `line_total_minor` per service or doctor (net of discounts, before
   tax), with one «الضريبة» row at report level, so Σ rows + tax = Σ invoice totals; (b) recompute each line's
   tax with the shared `computeInvoiceTotals` from the stored lines and show amounts including tax; (c) show
   gross amounts (`quantity × unit_price_minor`) with a separate discount column. **Recommendation: (a)** —
   stored numbers only, nothing recomputed, and the total still matches the invoices.
4. **F3-Q4 — The doctor's own report (`own`, R10).** (a) A monthly summary of the invoices of the doctor's
   own patients, whole invoices, no line split (R2-6), in F3; (b) no doctor report in F3, it waits for doctor
   commission (FIN-19); (c) the doctor sees revenue of his own lines only — this **changes R2-6**.
   **Recommendation: (a)**.
5. **F3-Q5 — Export format.** (a) CSV only (Excel opens it, Arabic included); (b) CSV and XLSX.
   **Recommendation: (a)** in F3, XLSX later if asked for.
6. **F3-Q6 — Maximum range and sync vs job.** (a) Screens up to 366 days, exports up to 3 years, every export
   a worker job; (b) the same limits, but small aggregate exports download at once and only large ones are
   jobs; (c) no limit. **Recommendation: (a)** — one simple rule that respects the 200 ms rule.
7. **F3-Q7 — Discounts report (R8).** (a) Per discounted invoice: number, amount, kind, who gave it and the
   patient's name; (b) the same without the patient's name; (c) totals only, per branch and staff member.
   **Recommendation: (b)** — enough to follow discounts, with less patient data.
8. **F3-Q8 — Refund and discount reasons in exports.** (a) Shown on screen only, never exported; (b)
   exported. **Recommendation: (a)** — a reason is free text that may hold patient details, and it never
   enters the audit log either (its length only).
9. **F3-Q9 — Default permissions.** New clinics: clinic admin `view:finance_reports:clinic`; receptionist
   nothing; doctor `view:finance_reports:own` if F3-Q4 = (a). Existing clinics: only the locked clinic admin
   gains the clinic-scope key (R2-4 again). (a) Exactly this; (b) the receptionist also gets `branch` (for
   daily takings). **Recommendation: (a)** — the admin grants more in the role editor.
10. **F3-Q10 — How long an export file is kept.** (a) 24 hours, then the file is deleted and the request row
    stays in the history; (b) 7 days; (c) never deleted. **Recommendation: (a)** — the file may hold patient
    names.
11. **F3-Q11 — Daily rollup table or live queries.** (a) Live queries over the tables with the indexes of §8;
    add a rollup later only if a measured report is slow; (b) a daily rollup table updated by every payment
    and invoice. **Recommendation: (a)** — no stored balance (parent §4.3), so a rollup can never disagree
    with the movements.
12. **F3-Q12 — Patient credit report (R6).** (a) In F3, for the clinic scope with `view:payments:clinic`;
    (b) later. **Recommendation: (a)** — credit is money the clinic owes its patients and should be visible.
13. **F3-Q13 — Clinic reports vs the platform totals after a timezone change.** Movements keep the business
    day they were written with; `finance_monthly_totals` (0065) re-reads `received_at`/`refunded_at` in the
    clinic's current timezone, so after a change the two can disagree near a month boundary. (a) Move the
    platform totals to `business_date` (and to `invoices.business_date` if F3-Q1 = (a)) in a new SQL file
    that re-creates the function with the same columns; (b) accept the difference and drop the
    "reports = platform" invariant; (c) block timezone changes once the clinic has an invoice or a payment.
    **Recommendation: (a)** — one definition of a day everywhere, a small SQL change, and clinics keep the
    right to correct a wrong timezone.

## 11. Owner decisions (EY-9, 2026-10-21)

Waleed's answers, verbatim from his cards (relayed by the super admin session). Where an answer is not the
recommendation it says so, with what changes.

| Question | Answer (verbatim)                                                                                       | Decision                                                                                               | What changes                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F3-Q1    | «نحفظ يومها وقت إصدارها (المقترح)»                                                                      | (a) store `invoices.business_date` at issue                                                            | expand → backfill → contract (§8); the platform function moves with it (F3-Q13)                                                                                                 |
| F3-Q2    | «30/60/90/أكتر (المقترح)»                                                                               | (a) 0–30 / 31–60 / 61–90 / over 90                                                                     | —                                                                                                                                                                               |
| F3-Q3    | «سطر ضريبة واحد (المقترح)» (asked again on the tax-only wording; replaces the first answer «سطر لوحده») | (a) `line_total_minor` per service/doctor plus one report-level tax line; rows + tax = Σ `total_minor` | —                                                                                                                                                                               |
| F3-Q4    | «إيراد خدماته هو بس»                                                                                    | **(c), not the recommendation**: R10 shows the revenue of the doctor's own lines only                  | R10 is per line, not per whole invoice: own lines = `provider_id` = caller AND the invoice is in the caller's `own` reach (amended R2-6 in §1)                                  |
| F3-Q5    | «CSV وExcel»                                                                                            | **(b), not the recommendation**: CSV and XLSX                                                          | an XLSX writer is a new dependency (the 24 h supply-chain guard applies); typed text cells keep big amounts exact (issue #106) and the formula guard applies to every text cell |
| F3-Q6    | «سنة شاشة، 3 سنين تصدير (المقترح)»                                                                      | (a) 366 days on screen, 3 years in export, every export a background job                               | —                                                                                                                                                                               |
| F3-Q7    | «باسم المريض»                                                                                           | **(a), not the recommendation**: R8 lists the patient's name                                           | R8 holds patient data: its export follows the R5–R7 rules (audited, 24 h)                                                                                                       |
| F3-Q8    | «يطلع في الملف كمان»                                                                                    | **(b), not the recommendation**: refund and discount reasons are exported                              | reasons are free text in a file that leaves the system; length-capped as stored, formula-guarded                                                                                |
| F3-Q9    | «والريسبشن كمان»                                                                                        | **(b), not the recommendation**: the receptionist also gets `view:finance_reports:branch`              | defaults: admin `clinic`, doctor `own` (R10 only, per F3-Q4); the receptionist's default **waits for privacy point 1 (EY-9.14)** and 0070 does not grant it until then          |
| F3-Q10   | «24 ساعة (المقترح)»                                                                                     | (a) 24 hours                                                                                           | —                                                                                                                                                                               |
| F3-Q11   | «مباشرة من الجداول (المقترح)»                                                                           | (a) live queries                                                                                       | —                                                                                                                                                                               |
| F3-Q12   | «أيوه، للعيادة كلها (المقترح)»                                                                          | (a) R6 in F3, clinic scope                                                                             | —                                                                                                                                                                               |
| F3-Q13   | «نوحّد الحساب (المقترح)»                                                                                | (a) the platform totals move to `business_date` in a new SQL file                                      | applying that file to production needs the owner's own yes when it is ready                                                                                                     |

Points raised back to the owner with these answers (privacy; not yet decided):

1. With F3-Q7 (a), F3-Q8 (b) and F3-Q9 (b), a receptionist with `branch` scope could export files that hold
   patient names and free-text reasons for a whole branch. Proposed guard: the receptionist's default covers
   R1, R2 and R9 only, and the patient-named reports (R5–R8) and their exports need the admin's grant.
2. Free-text reasons in an exported file may carry clinical detail typed by staff. Proposed guard: every
   export of R5–R8 writes a patient-data access audit row (who, which report, which range).
3. **R10's paid and owed columns after F3-Q4 = (c).** Payments name an invoice, not a line, so paid and owed
   cannot be split to the doctor's own lines without a rule the owner has not given (that is FIN-19
   commission). Proposed: (a) R10 shows only the billed amount of the doctor's own lines per month, with no
   paid or owed columns (recommended); (b) R10 also shows, beside it, the whole-invoice paid and owed of the
   invoices that carry those lines, labelled as whole-invoice amounts. Until answered, R10 has no paid or
   owed column.

ADR-0035 (`docs/adr/0035-finance-reports.md`) is written with the first F3 slice, from §11 and the answers
to the three points above; nothing is built before it. The discount-giver rule of R8 stays open in issue
#106 (attribution per discount, not per invoice edit).
