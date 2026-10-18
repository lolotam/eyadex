# Review lessons for Lovable — read before every task

These are the mistakes the review bots (Codex, MergePilot) found in Lovable's code on PRs #46–#78.
Each one cost a review round, often hours. Read the whole file before you write code, and tick the
checklist at the end before you say a task is done. The orchestrator adds new lessons after every
merged PR; never delete one.

## 1. Permissions and branch scope (the most common mistake)

1.1 **Gate an action by the record's branch, not by "the user has this verb somewhere".**
`can("update", "invoices")` is wrong when the user holds `update:invoices:branch` and the invoice is
in a branch outside their list. Check the action, the resource **and the record's branch** together.
(PR #78: edit, void and send buttons showed on invoices the user could view clinic-wide but not
change; the «فاتورة» button showed on appointments outside the create scope.)

1.2 **Take a form's branch options from the permission of the action the form performs.**
A manual-invoice form uses the branches of `create:invoices`, not those of `view:patients`. A
discount control uses `create:discounts` at the selected branch. (PR #78, three findings.)

1.3 **Think in custom roles, not in the seeded ones.** Admins combine permissions freely. Before you
finish, picture a role that has only the permission your screen needs (for example
`view:prices` + `update:prices` without `view:services`) and make sure that role can still reach
the screen, and a role without it cannot. (PR #78: the prices screen was reachable only through the
services permission.)

1.4 **`own` scope crosses branches.** A doctor with `view:invoices:own` sees their own patients'
invoices in any branch. Do not filter those rows by the doctor's branch list.

1.5 **Hiding is UX; the mock must reject too.** Every mock method checks, in order: active user →
clinic access → module enabled → permission → branch scope (and patient reach when the caller names
a patient). (PR #78: the mock issued a manual invoice for a patient outside the caller's reach.)

1.6 **When a write needs another resource's data, do not require that resource's view
permission.** A user editor that calls `GET /v1/roles` fails for a role with users permissions but
no roles permissions. Read what you need through the endpoint the action owns. (PR #46.)

1.7 **A lookup that only a view key may run must not block a create-only role.** If a page runs a
lookup under `view:invoices` before it shows the form, skip the lookup for a role that cannot view and
let the server decide. Likewise a dialog that lists doctors needs `view:schedules`: offer the action
only to a role that holds the key its helper read needs. (Follow-ups to #78.)

## 2. Mock adapter = API, rule for rule

2.1 The mock is a copy of the API's behavior, not a simplified one. Same validation, same error
codes, same order of checks, same audit rows.

2.2 **Validate everything before you change any state.** (PR #78: the mock inserted the clinic, then
rejected the finance fields, leaving half a clinic.)

2.3 **Idempotency replays:** the fingerprint covers every field of the request, and a replay still
re-checks the caller's current permission and branch reach. (PR #78, two findings.)

2.4 **Every administrative write records an audit row** in the mock, exactly as the API does.
(PR #78: the finance writes recorded none.)

2.5 **Dates in filters use the clinic's time zone**, as the API does: an invoice issued at 22:30 UTC
in a Kuwait clinic belongs to the next local day. (PR #78.)

## 3. Time, dates and clocks

3.1 Everything a user sees or picks as a date is a calendar day **in the clinic's time zone**: never
the browser's zone, never UTC with a `Z` appended. (PRs #46, #67, #78.)

3.2 **Never trust the device clock for a business decision.** Subscription expiry, trial start and
"is this still valid" come from the server. (PR #46, three findings.)

3.3 Days are not always 24 hours. In a zone with daylight saving, a week view computes each day's
own length and labels each column by its own wall clock. (PR #67.)

3.4 Polling always has an end: a maximum duration or attempt count, and it stops when the answer
arrives. Clock-skew tolerances are bounded both ways. (PR #76, five findings.)

## 4. Forms, dialogs and stale data

4.1 **A dialog captures the record (and its `version`) when it opens.** A background refetch must not
change what the user is confirming or editing. Edit, void and every confirm dialog. (PR #78.)

4.2 **A refetch never overwrites unsaved input.** Initialise form values once per open, not on every
query result. (PR #78: price dialog.)

4.6 **A failed background refetch never replaces a mounted form with an error panel.** Show the error
panel only while there is no successful answer yet; after that, keep the form and its typed values.
(Follow-ups to #78.)

4.3 When a filter's options change (another branch, another week), reset or re-validate the selected
value. When new data is loading, keep the user's current selection. (PR #67.)

4.4 A form that saves through two requests can half-apply. Prefer one request; if you must use two,
tell the user exactly which part was saved. (PR #46.)

4.5 Request ids for idempotent sends (`sendRequestId`, `Idempotency-Key`) are generated **per
attempt**: rotate them after a success so the next press is a new request. (PR #78.)

## 5. Loading, empty and error states

5.1 A failed request is an **error state with a retry button**, never an empty list, never "no
invoices", never a spinner that spins forever. (PRs #46, #78.)

5.2 If a page depends on several queries, check the error of **every** one before rendering the
form. (PR #78: the existing-invoice lookup error was ignored and the form opened anyway.)

5.3 Select boxes and pickers load **all pages** of their options, or search the server; never stop
silently at the first page. (PR #78: services after 100.)

5.4 Never show internal codes (`evo_connection_closed`, Meta error numbers) to users. Map every
error code to an i18n message in Arabic and English. (PR #73.)

## 6. Browser APIs

6.1 `window.open` runs **inside the click**, before any `await`. Open the tab first, then load the
content into it, or the popup blocker kills it. (PR #78, two findings.)

6.2 Every `URL.createObjectURL` has a matching `URL.revokeObjectURL`. (PR #78, two findings.)

## 7. Business rules come from the spec, not from guesses

7.1 Read the spec section for the slice (`docs/specs/*.md`) and follow its decisions exactly, for
example FIN-9: a no-show or cancelled appointment gets no linked invoice. (PR #78.)

7.2 If the spec does not settle a rule, stop and ask in your plan. Do not pick one quietly.

7.3 A label must match the data under it. A column titled «المراجع / Patient» must show the patient,
not the invoice source. (PR #78.)

7.4 Hide or gate a feature whose API is not built yet, and say so in the UI copy. Never show a form
that saves to an endpoint that answers `not_implemented`. (PR #46.)

## 8. Structure and boundaries

8.1 One React component per file. (PR #73.)

8.2 `shared/` holds code with **no business meaning**. A component that decides invoices belongs
in `invoices/`; another area reaches it through the route, as `area-boundaries.test.ts` enforces.
Do not move business code into `shared/` to get past that test. (PR #78.)

8.3 Max 300 lines per file; split by responsibility.

## 9. Tests and secrets

9.1 No string that looks like a secret in tests: no realistic API keys, tokens, passwords or phone
numbers, even fake ones. Build them at runtime (`"x".repeat(32)`) or use obviously fake values.
(PR #72, flagged as HIGH.)

9.2 Every rule you add gets a test that would fail without it.

9.3 **A test never ends with `if (!x) return`.** Create the data the test needs, or fail: a guard like
that turns a missing fixture into a green test. Every key a new audit snapshot carries needs an ar and
an en label in `ar-audit.ts` / `en-audit.ts`. (Follow-ups to #78.)

---

## Checklist — tick every line before you report "done"

- [ ] Every button, menu item and route checks action + resource + **the record's branch**.
- [ ] Every branch list in a form comes from the permission of that form's action.
- [ ] I pictured a custom role with only the needed permission, and one without it.
- [ ] The mock enforces the same checks, validation order, idempotency fingerprint and audit rows as the API.
- [ ] Dates use the clinic's time zone; no business decision uses the device clock.
- [ ] Dialogs capture the record and version on open; refetches do not overwrite input.
- [ ] Every query has an error state with retry (never over a mounted form); no endless spinner; option lists load all pages.
- [ ] No internal error code reaches the UI; every string is an i18n key in ar and en.
- [ ] `window.open` happens before any `await`; every object URL is revoked.
- [ ] Polling stops.
- [ ] Spec decisions followed; open rule questions asked, not guessed.
- [ ] Labels match their data; Arabic copy says «المراجع», never «المريض»; no «كاشير».
- [ ] One component per file, ≤ 300 lines, no business code in `shared/`.
- [ ] No secret-looking strings in tests; every new rule has a failing-without-it test.
- [ ] Checked the screen in Arabic and English at 1440px and 390px.
