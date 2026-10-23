# ADR-0035 — Finance reports and exports (F3)

- Status: Accepted (owner decisions 2026-10-21: F3-Q1 … F3-Q13 as recorded in the spec's §11, plus
  EY-9.14, EY-9.15 and EY-9.16)
- Date: 2026-10-21

## Context

F1 issues invoices (ADR-0033) and F2 records the money — payments, refunds, patient credits and the daily
cash closing (ADR-0034). FIN-18 asks the clinic to see its revenue by day, period, branch, doctor, service
and method, its outstanding balances, its discounts, its cash closings and an Excel/CSV export. Nothing
exists for that: no report screen, no report endpoint, no export, and no permission that opens a report.

The design draft `docs/specs/finance-f3-reports-design.md` listed 13 open questions (F3-Q1 … F3-Q13) and
three points (EY-9.14, EY-9.15, EY-9.16). The owner answered all of them on 2026-10-21, and five answers
differ from the recommendation (F3-Q4, F3-Q5, F3-Q7, F3-Q8, F3-Q9). This record states the decided
behaviour; the spec holds the detail. Nothing of F3 is built yet: the SQL plan still needs the owner's yes.

## Decision

1. **F3 is read-only.** It adds report screens, report endpoints and exports over the tables F1 and F2
   already write. It writes no money row, changes no F1/F2 rule and stores no balance: every balance is
   derived (parent spec §4.3).
2. **Ten reports (R1–R10):** daily takings, period summary, revenue by service, revenue by doctor,
   outstanding balances, patient credit, refunds, discounts, cash closings and the doctor's own summary.
   Service and doctor revenue is `line_total_minor` plus one report-level tax line, so the rows and the
   tax line equal the invoices' total (F3-Q3 (a)). The aging buckets of the outstanding balances are 0–30,
   31–60, 61–90 and over 90 days (F3-Q2 (a)). The patient credit report is in F3, in the clinic scope
   (F3-Q12 (a)).
3. **One new permission resource.** `finance_reports` with three view keys — `clinic`, `branch` and `own`.
   There is no separate export key: an export is a view. A report also needs the extra key of the list it
   replaces (`view:invoices` for R5 and R8, `view:payments` for R6 and R7, `view:cash_closings` for R9), and
   a report row never shows more than the caller could already reach through those lists.
4. **Default grants** (F3-Q9 (b), EY-9.14 (a)): a new clinic's admin gets `clinic`, its doctor gets `own`
   (R10 only), its receptionist gets `branch` covering R1, R2 and R9 only. R5–R8 hold patient data and need
   the admin's grant, so the key must be split before the receptionist's default can be granted; until the
   split lands, the release file grants the receptionist no report key at all. An existing clinic's locked
   admin gains `view:finance_reports:clinic` and nothing else (R2-4 again).
5. **The doctor's own report (R10) is per line.** It shows the billed amount of the doctor's own lines per
   month — his own lines on invoices inside his own reach — and no paid or owed columns (F3-Q4 (c),
   EY-9.16 (a)). This amends R2-6 for R10 only; the drill-down stays the invoice list he already sees.
6. **Reports read live queries** (F3-Q11 (a)); no rollup table, no stored balance. The invoice's business
   day is stored at issue in `invoices.business_date` (F3-Q1 (a), expand → backfill → contract), and the
   platform totals move to the same stored day in a new SQL file (F3-Q13 (a)).
7. **Every export is a worker job** (F3-Q6 (a)), in CSV and XLSX (F3-Q5 (b)), kept for 24 hours
   (F3-Q10 (a)). The file stays private; only the requester downloads it, after the worker and the
   download re-derive his access now. Every export of R5–R8 writes a patient-data access audit row
   (EY-9.15 (a)). Refund and discount reasons are exported (F3-Q8 (b)), length-capped as stored and
   formula-guarded.
8. **The platform sees nothing of F3** (FIN-3): no grant on a report table, function or view, no report
   screen, no export and no audit row.
9. **The SQL plan needs the owner's yes** before any SQL file is written (spec §8).

## Consequences

- The API gains a report module: the report functions and the one invoker view for balances (spec §5), the
  report endpoints and the export routes. Every read stays inside `withTenant`; RLS is the clinic wall.
- The web gains the reports area and its mock (slice 5); the mock keeps the same checks in the same order.
- A new XLSX dependency enters the workspace, so the 24-hour supply-chain guard applies (F3-Q5 (b)).
- `finance_monthly_totals` is re-created in a new forward-only SQL file with the same columns; applying it
  to production needs the owner's own yes when it is ready (F3-Q13 (a)).
- The export pipeline design (issue #105) must land before slice 2's SQL, because the export table's lease
  and fencing columns are part of that table (issue #106).
- The receptionist's default report grant waits for the permission-key split (issue #106).
- The web role matrix, the seeded roles and the permission catalogue grow with the three new keys in the
  same PR as the SQL that seeds them.

Full detail: `docs/specs/finance-f3-reports-design.md` §3–§9, with the owner's answers verbatim in §11.
