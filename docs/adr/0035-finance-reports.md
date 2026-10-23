# ADR-0035 — Finance reports and exports (F3)

- Status: Accepted (owner decisions 2026-10-21: F3-Q1 … F3-Q13 as recorded in the spec's §11, plus
  EY-9.14, EY-9.15 and EY-9.16; and 2026-10-23: EY-10.1 … EY-10.6 as recorded in the spec's §12)
- Date: 2026-10-21 (amended 2026-10-23)

## Context

F1 issues invoices (ADR-0033) and F2 records the money — payments, refunds, patient credits and the daily
cash closing (ADR-0034). FIN-18 asks the clinic to see its revenue by day, period, branch, doctor, service
and method, its outstanding balances, its discounts, its cash closings and an Excel/CSV export. Nothing
exists for that: no report screen, no report endpoint, no export, and no permission that opens a report.

The design draft `docs/specs/finance-f3-reports-design.md` listed 13 open questions (F3-Q1 … F3-Q13) and
three points (EY-9.14, EY-9.15, EY-9.16). The owner answered all of them on 2026-10-21, and five answers
differ from the recommendation (F3-Q4, F3-Q5, F3-Q7, F3-Q8, F3-Q9). On 2026-10-23 the owner took six more
decisions (EY-10.1 … EY-10.6, GitHub issue #106): the report key split, the discount giver of R8, the big
amounts in an export, the refused `own` export, the business day of a credit application and the remaining
technical items. This record states the decided behaviour; the spec holds the detail. Nothing of F3 is
built yet: the SQL plan still needs the owner's yes.

## Decision

1. **F3 is read-only for money.** It adds report screens, report endpoints and exports over the tables F1
   and F2 already write. It writes no money row and stores no balance: every balance is derived (parent spec
   §4.3). It does add four nullable columns and re-create one function (item 6).
2. **Ten reports (R1–R10):** daily takings, period summary, revenue by service, revenue by doctor,
   outstanding balances, patient credit, refunds, discounts, cash closings and the doctor's own summary.
   Service and doctor revenue is `line_total_minor` plus one report-level tax line, so the rows and the
   tax line equal the invoices' total (F3-Q3 (a)). The aging buckets of the outstanding balances are 0–30,
   31–60, 61–90 and over 90 days (F3-Q2 (a)). The patient credit report is in F3, in the clinic scope
   (F3-Q12 (a)).
3. **Four report permission resources, seven keys** (EY-10.1): `report_takings` (R1, R2, R9; `clinic` and
   `branch`), `report_analytics` (R3, R4; `clinic` and `branch`), `report_patients` (R5–R8, the
   patient-named reports; `clinic` and `branch`, no `own`) and `report_own` (R10; `own` only). There is no
   separate export key: an export is a view. A report that shows invoices or payments also needs the
   covering `view:invoices` / `view:payments` key, and the closing report needs `view:cash_closings`; a
   report row never shows more than the caller could already reach through those lists, and an `own` report
   key is never covered by a `branch` key (EY-10.6).
4. **Default grants** (F3-Q9 (b), EY-9.14 (a), EY-10.1): the locked clinic admin gets the three clinic keys,
   the receptionist gets `view:report_takings:branch` (R1, R2 and R9 only) and the doctor gets
   `view:report_own:own` (R10 only). The new-clinic templates in `system-roles.ts` get the same keys in the
   same slice. In an existing clinic the release file grants the locked admin its three keys and changes no
   other role (FIN-4); the clinic's admin grants the receptionist and doctor keys.
5. **The doctor's own report (R10) is per line.** It shows the billed amount of the doctor's own lines per
   month — his own lines on invoices inside his own reach — and no paid or owed columns (F3-Q4 (c),
   EY-9.16 (a)). This amends R2-6 for R10 only; the drill-down stays the invoice list he already sees.
6. **Reports read live queries** (F3-Q11 (a)); no rollup table, no stored balance. F3 adds four nullable
   columns and re-creates one function: `invoices.business_date` and `payment_allocations.business_date`
   (the stored clinic business day), and `invoice_lines.discounted_by` and `invoices.discounted_by` (who set
   the discount). The invoice's business day is stored at issue (F3-Q1 (a), expand → backfill → contract),
   and the platform totals move to the same stored day in a new SQL file (F3-Q13 (a)). The report functions
   and the balance view read `issued_at` in the clinic timezone until the contract step; a later file in the
   same release re-creates them on the stored columns (EY-10.6).
7. **The discount giver of R8 is stored on the row** (EY-10.2): `invoice_lines.discounted_by` and
   `invoices.discounted_by` hold the membership id of the staff member who set the discount, written by the
   issue and edit paths; a discount set before the column existed shows «—». R8 reads no `audit_log`, so
   billing needs no audit port and no architecture row for it.
8. **Every export is a worker job** (F3-Q6 (a)), in CSV and XLSX (F3-Q5 (b)), kept for 24 hours
   (F3-Q10 (a)). A CSV export with any amount over 15 significant digits is refused; the XLSX export writes
   the amounts as text cells, so no digit is rounded away (EY-10.3). The file stays private; only the
   requester downloads it, after the worker and the download re-derive his access now — the `own` re-check
   goes through `BillingPatientReader.ownPatientFilter`. An `own` export whose download is refused because a
   patient left the reach is purged at once; its row stays for the audit and its stored patient ids are
   cleared when the row expires (EY-10.4). Every export of R5–R8 writes a patient-data access audit row
   (EY-9.15 (a)). Refund and discount reasons are exported (F3-Q8 (b)), length-capped as stored and
   formula-guarded.
9. **The platform sees nothing of F3** (FIN-3): no grant on a report table, function or view, no report
   screen, no export and no audit row.
10. **The SQL plan needs the owner's yes** before any SQL file is written (spec §8).

## Consequences

- The API gains a report module: the report functions and the one invoker view for balances (spec §5), the
  report endpoints and the export routes. Every read stays inside `withTenant`; RLS is the clinic wall.
- The web gains the reports area and its mock (slice 5); the mock keeps the same checks in the same order.
- A new XLSX dependency enters the workspace, so the 24-hour supply-chain guard applies (F3-Q5 (b)).
- `finance_monthly_totals` is re-created in a new forward-only SQL file with the same columns; applying it
  to production needs the owner's own yes when it is ready (F3-Q13 (a)). It ships with the contract file and
  the file that re-creates the report functions and the view, in one PR, after the writers are live and the
  backfills are verified.
- The export pipeline design (issue #105) must land before slice 2's SQL, because the export table's lease
  and fencing columns are part of that table (issue #105).
- The web role matrix, the seeded roles and the permission catalogue grow with the seven new keys in the
  same PR as the SQL that seeds them, and the new-clinic templates in `system-roles.ts` get the same keys.
- The receptionist's and the doctor's report keys are new-clinic defaults only; existing clinics' roles are
  not changed by the release (FIN-4, EY-10.1).

Full detail: `docs/specs/finance-f3-reports-design.md` §3–§9, with the owner's answers verbatim in §11 and
§12.
