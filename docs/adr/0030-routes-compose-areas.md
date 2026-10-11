# ADR-0030 — Routes compose business areas through slots

- Status: accepted (owner decision 2026-10-11, PR #68 review)
- Date: 2026-10-11

## Context

CLAUDE.architecture.md §1.1 forbids one business area of `apps/web/src` from importing another, and
allowed a route to import a "page component only". P2 broke the first rule: the patient file imported
the medical tabs, appointments imported the start-visit control, and two Settings pages imported the
Settings shell (those two predate P2). Fixing it means one place must put an area's piece inside
another area's page, and that place can only be the route — which the "page component only" wording
did not allow.

## Decision

1. No business area imports another, tests included. `src/shared/area-boundaries.test.ts` fails on any
   `@/<other-area>/` specifier; business areas are the top-level folders of `src` except `routes`,
   `shared`, `components`, `hooks`, `lib` and `test`.
2. A route may import page components **and the slots those pages take as props**: a tab list typed
   `SlotTab` (`shared/shell/slot-tab.ts`, e.g. `PATIENT_MEDICAL_TABS` from `visits` into the patient
   file) or a layout frame (`ClinicSettingsShell` into the Services, Schedules and Medicines pages).
   Nothing else of an area.
3. The web side of the API `medical` module is one area, `src/visits`; the start-visit control of the
   day and queue lives in `src/appointments`.

## Consequences

- A page that hosts another area's content takes it as a prop and stays ignorant of it; only the open
  slot tab renders, so an audited read still happens only when the user opens that tab.
- The §1.1 routes row now reads "page components + their slots", with a footnote.
- `shared/` test files still import two areas (`nav-items.test.ts`, `localized-page-head.test.tsx`);
  the guard does not scan `shared/`.
