# ADR-0016: Platform clinic list, usage reads and server-side trial

Status: accepted (slice W2, 2026-10-08)

## Context

W1 wired the web app to the API but left gaps: the platform clinic list, the clinic-side usage
counters, the clinic's time zone on the platform read, and a trial expiry computed on the device
clock (so a retry after midnight could change the body under the same `Idempotency-Key`).

## Decision

1. **`GET /v1/platform/clinics`** — `@PlatformStaff` only (a clinic host or session is refused by
   the existing guard). Cursor pagination, default 50, max 100, ordered `created_at DESC, id DESC`
   with an opaque cursor over both, so ties never repeat or skip. Filters: `search` (trimmed,
   1–100 chars, matched on `name_ar`, `name_en`, `slug`), `status`, `specialty`. Answer
   `{ items, nextCursor, total }`; `total` is a separate count with the same filters. Each item has
   the platform detail shape and is built by the existing detail reader per clinic (bounded by the
   page size), so the list can never carry a field the detail does not: no patient field or count.
   It runs on the `eyadex_platform` pool, which has no grant on `patients`. SQL `0031` adds the
   `(created_at, id)` index for the order.
2. **Platform detail** gains `timezone`, `defaultLanguage`, `createdAt`, read through `ClinicReader`
   (the authorization cache stores access context, not the snapshot, so no cache change).
3. **Usage reads** — `GET /v1/branches/usage` (`view:branches:clinic`, `{ active, limit }`) and
   `GET /v1/users/usage` (`view:users:clinic`, `{ used, limit }`: active memberships plus unexpired
   pending invitations). Both run under `withTenant` and reuse the `limits.ts` functions; they are
   read-only displays — writes still decide limits under their advisory lock (ADR-0011).
4. **Server-side trial** — the create request takes exactly one of `expiresAt` or `trialDays`
   (1–365). `trialEndsAt` (pure, tenancy domain) returns 23:59:59 local time on the date N days
   after the clinic-local today, from the injected `Clock`. The web sends `trialDays` only, so the
   body holds no clock-derived value and a retry always matches its first attempt.
5. **Subscription saves** from the web use the clinic's real time zone: both the date and the
   duration mode end at 23:59:59 local time; durations count calendar months in that zone.

## Consequences

- The platform overview (slice 11), the details write and the members read stay "coming soon".
- Platform defaults for new clinics (limits, trial days) still mirror the mock (`TODO(spec)`).
- Option pickers keep using `view:*` permissions until slice 8 decides otherwise.
