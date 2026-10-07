# ADR-0006 — Clinic onboarding, the outbox, and sealed invitation links

Status: accepted (Phase B slice 3a)

## Context

PRD stories 6–7 and ONB-01: the platform creates a clinic with its first admin, and every piece
(clinic, roles, invitation, email hold, platform audit, the "send the invitation" side effect) is
written together or not at all. The invitation email is a worker job (CLAUDE.md §6), and the
invitation token may only be stored as a hash (CLAUDE.md §8). The worker still has to build a
sendable link.

## Decisions

1. **One transaction.** `CreateClinicWithAdmin` (tenancy) runs inside `withNewTenant` on the
   `eyadex_platform` pool. Identity's `PgFirstAdminProvisioner` implements tenancy's
   `FirstAdminProvisioner` port and writes the four system roles + their catalogue permissions,
   `reserve_invitation_email` (0015/0017) and the invitation (token hash only) with the same `tx`.
   The platform module only mounts HTTP. Any throw rolls everything back, including the
   idempotency key.
2. **Permission catalogue as data (0026).** Role permissions reference `permissions.id`; the 23
   keys are seeded with fixed ids so every environment agrees.
3. **Outbox (0025).** `outbox_events(id, clinic_id NULL, event_type, payload, created_at,
   dispatched_at)`. Not a clinic-owned table (platform events have no clinic), so the key is `id`;
   RLS is still enabled and forced. Writers (`eyadex_app`, `eyadex_platform`) have INSERT only and
   a WITH CHECK that pins `clinic_id` to the transaction's clinic context. `eyadex_dispatcher` has
   SELECT and UPDATE(`dispatched_at`, `payload`) on this table only.
4. **Sealed link, not a clear token.** The raw token lives only in memory during the request. The
   event carries `sealedToken` = AES-256-GCM(`OUTBOX_SEAL_KEY`, token) with the event id as
   additional data, so a ciphertext copied elsewhere never opens. The key is in the API and worker
   env only, never in the database. After sending, the dispatcher scrubs `sealedToken`. A database
   dump alone therefore never yields a usable invitation link. Rejected: storing the token
   (violates §8); having the worker mint a new token (then the API cannot hash it in the same
   transaction without a second write path).
5. **Idempotency (0025 `idempotency_keys`).** `Idempotency-Key` is required. Scope = operation +
   actor; the body is canonicalised and SHA-256 hashed. Same key + same body → stored response;
   different body → `idempotency_conflict` (409). The response holds identifiers only.
6. **Errors.** `reserved_slug` 400, `slug_taken` / `email_taken` / `idempotency_conflict` 409.
   The clinic host gets 404 (`PlatformAreaGuard` before `SessionGuard`); a platform session
   without verified TOTP gets 403 `two_factor_required`.

## Consequences

- `OUTBOX_SEAL_KEY` rotation needs a drain of pending events first. TODO(spec): key rotation.
- TODO(spec): retention of `idempotency_keys`; default limits/expiry/modules for a new clinic are
  required inputs until the PRD fixes them; the `@Require` platform permission lands in slice 4.
- The worker slice implements the dispatcher (read pending, open, send, scrub, mark) — done in ADR-0013.
