# Slice: patient names in the clinic invoice list (web only)

Spec: finance-design §8c item 4 (list names the patient inside the invoice reach, no `patient_access` row, `view:patients` not required) and §8 rule 12 (`own` reach). Contract: `invoiceListItemSchema` requires `patientName: string`.

## Files I will touch

| File | Change |
| --- | --- |
| `apps/web/src/invoices/use-invoice-columns.tsx` | New `patient` column right after `number`: header `t("finance.list.patient")`, cell = plain `<span className="block max-w-48 truncate text-start" title={name}>`. No link. Update the doc comment. |
| `apps/web/src/shared/api/mock/mock-finance.ts` | `listInvoices`: after the existing reach filter and page slice (unchanged), attach `patientName` from `db().patients` with `clinicId === a.clinic.id && id === i.patientId`. Missing record: throw the internal error (see open question). No audit writer is called. Small helper `patientNameOf(...)` shared with `getInvoice` if it keeps the file under 300 lines (now 245). |
| `apps/web/src/invoices/use-invoice-columns.test.tsx` | Fixture gets `patientName`; tests below. |
| `apps/web/src/invoices/invoice-patient-name-mock.test.ts` | The "list rows never carry it" test contradicts the new contract: replace it with "list rows carry the name" (the detail tests stay). |
| `apps/web/src/invoices/invoices-content.test.tsx` | Mocked `useInvoiceColumns` today returns `[]`; add a separate describe (or a new file `invoices-content-patient.test.tsx` if it would pass 300 lines) that uses the real columns with two list items. |
| `apps/web/src/invoices/invoice-list-names-mock.test.ts` (new) | Mock reach tests below. |
| Other fixtures building `InvoiceListItem` | Only those `typecheck` flags (candidates: `invoice-page.test.tsx`, `invoice-edit-discounts.test.tsx`). |

No i18n key added: `finance.list.patient` already exists in ar («المراجع») and en ("Patient"). Nothing under `apps/api`, `packages/`, `db/`, `docs/`, `components/ui`; no detail page, form, picker or permission change; no dependency or lockfile change.

## Tests (each proven to fail by reverting its source once)

Columns (ar and en, via `I18nProvider` language):
- header «المراجع» / "Patient" sits right after the number header; the cell shows the name and carries it in `title`.

`invoices-content`:
- each row shows its own patient name; no `link` role carries a name, and no `href` contains `/clinic/patients`.

Mock (`invoice-list-names-mock.test.ts`, obviously fake names like «مراجع تجريبي أ»):
- two pages via cursor (`limit: 1`): every item's name equals its patient's `fullName`.
- desk member scoped to branch A: issue a branch-B invoice for a patient who has invoices only in B; that name is absent from `JSON.stringify(page)`.
- doctor with `view:invoices:own`: names only for own patients' invoices (any branch); another doctor's patient name is absent from the serialized result.
- persona without `view:invoices` (custom role) is refused with the same code as today (asserted against the current code, read in the test, not guessed).
- listing writes zero `patient_access` audit rows (count before/after).
- an invoice whose patient record is missing makes the list throw, never return an empty name.

## Gates
`pnpm --filter @eyadex/web typecheck`, `lint` (0 errors), `test` with exact counts; `prettier --check` on touched files; Playwright check of the list as clinic admin in Arabic and English at 1440px and 390px (long name truncates, no overflow). Tick `.lovable/review-lessons.md` checklist.

## Risks
- The existing test asserting list rows have no `patientName` must flip; that is intended by the new contract.
- At 390px an extra column widens the table; the existing table scrolls horizontally, the name is capped and truncated.
- HTTP adapter needs no change: it already parses with `invoiceListResponseSchema`, which now requires the field.

## Open question
- "Throw the mock's internal error": the mock has no `internal` `ApiError` code today (codes in use: `not_found`, `validation`, `forbidden`, …). Proposal: throw a plain `Error("invoice patient missing")`, which the UI already shows as the generic error with retry, and adding no new error code. Confirm, or name the code you want.
