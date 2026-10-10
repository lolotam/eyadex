# Appointments slice A4 — web: provider week, month, today's queue

Branch: `lovable`. Spec: `docs/specs/appointments-design.md` §5 (screens) and §6 (A4). Rules: `CLAUDE.md`
(read it fully first) and `CLAUDE.architecture.md`.

The contracts and the API are already done by the orchestrator (commits `e8ab28d`, `262690e`):

- `packages/contracts/src/appointment-calendar.ts` — `appointmentWeekQuerySchema` / `appointmentWeekSchema`
  (`GET /v1/appointments/week?branchId&providerMembershipId&weekStart`) and `appointmentMonthQuerySchema` /
  `appointmentMonthSchema` (`GET /v1/appointments/month?branchId&month=YYYY-MM[&providerMembershipId]`).
  Read the JSDoc there: it is the behaviour the mock must copy.
- Today's queue needs **no new endpoint**: it is the existing branch day (`day()`, `GET /v1/appointments/day`)
  for the clinic's today, plus the existing status and cancel calls.
- Do not edit `packages/contracts`, `apps/api`, `db/`, `roadmap.md` or `docs/adr`. If a contract looks wrong,
  stop and say so instead of changing it.

## 1. Client interface and adapters

- `apps/web/src/shared/api/appointments-client.ts`: add `week(persona, query: AppointmentWeekQuery):
Promise<AppointmentWeek>` and `month(persona, query: AppointmentMonthQuery): Promise<AppointmentMonth>`.
- HTTP adapter (`apps/web/src/shared/api/http/http-appointments.ts`): two GETs with the query string, answers
  parsed with the contract schemas, same error handling as `day()`.
- Mock adapter: put both reads in a **new file** `apps/web/src/shared/api/mock/mock-calendar.ts` (keep
  `mock-appointments.ts` edits to wiring only). Same rules as the API:
  - `module_disabled` when the appointments module is off; the branch rule of the mock `day()` (an
    unreachable branch is `not_found`; under `own` the caller's membership branches).
  - Under `view:appointments:own` only (see `mock-own-scope.ts`): the week of another provider is
    `not_found`; the month always counts the caller's own and naming another provider is `not_found`. A
    wider view key held beside `own` wins.
  - Week: seven days from `weekStart`; each day = that weekday's schedule rows **of this branch** and the time
    off touching the day (clinic time zone, `clinicDayBounds` from `@eyadex/contracts/clinic-time`); the
    provider's live (not `cancelled`) appointments in this branch touching the week; `can` exactly like the
    mock day; `provider.bookable` exactly like a day column.
  - Month: every day of the month in order (zero included); live appointments of the branch counted on the
    clinic-calendar day they **start**; optional provider filter.

## 2. Screens (`apps/web/src/appointments/`)

The appointments page gets a view switcher (shadcn `Tabs`, kept in the URL search as `view=day|week|month|queue`,
default `day`): **Day** (existing), **Week**, **Month**, **Today**. Branch picker shared by all views.

- **Week**: provider picker (the providers of the branch day for that week's first day; under `own` only the
  caller, so no picker), previous/next week and "this week". Seven columns with the same real-minute axis as
  the day (`day-grid.ts`): shifts shaded, time off marked, appointments as blocks (reuse `appointment-block.tsx`).
  Clicking a block opens the same actions as the day; clicking an empty slot books (booking dialog) only when
  `can.create`. The week starts on **Sunday** (Kuwait); `weekStart` = the Sunday on or before the chosen date
  in the clinic's time zone.
- **Month**: Sunday-first calendar grid of the chosen month (previous/next, "this month"), each day showing its
  count; clicking a day opens the Day view on that date. Optional provider filter for callers above `own`.
- **Today** (queue): `day()` for the clinic's today (`todayInTimeZone`), one list sorted by start time: time,
  patient name + file number, provider, service, status badge (`appointment-status-look.ts`). Actions per
  `APPOINTMENT_TRANSITIONS`: booked → "Arrived", "No-show", "Cancel"; arrived → "Completed", "Cancel". Reuse
  `appointment-actions.tsx` and `cancel-dialog.tsx`. Actions appear only when `can.update`; the mock and the API
  reject anyway.
- The doctor holding `view:appointments:own` sees the same four views filtered to themself.
- Loading, empty and error states for each view, like the day.

## 3. Rules that must hold

- Every string through i18n keys in **both** `ar-appointments.ts` and `en-appointments.ts`; no text in JSX.
  Arabic UI says «المراجع / المراجعون», never «المريض».
- Logical CSS only (`ps-`, `pe-`, `ms-`, `me-`, `start`, `end`), RTL correct, works at 390px and 1440px.
- shadcn/ui + lucide only; TanStack Query through the `ApiClient` only; browser storage only in effects.
- Max 300 lines per file, one React component per file; no `utils/`, `helpers/`, `common/` folders.
- Comment the why only; no commented-out code, no `FIXME`/`HACK`. An open question = `TODO(spec)` + say it.
- **Never** enable Lovable Cloud or Supabase, never add a database call or server function to the frontend.
- No real phone numbers, civil IDs, tokens or passwords in seeds, tests or examples.

## 4. Tests (vitest, must pass with `pnpm typecheck`, `pnpm lint` 0 errors, `pnpm test`, the node-server build)

- Mock week/month: seven days, shifts of this branch only, cancelled excluded, month length and counts on the
  start day, provider filter, `own` sees only itself, another provider `not_found`, wider key wins,
  `module_disabled`.
- Screens: the view switcher keeps `view` in the URL; queue actions hidden without `can.update` and follow the
  transitions table; month day click opens that day; the own doctor sees no provider picker.
- Every new i18n key exists in ar and en.
