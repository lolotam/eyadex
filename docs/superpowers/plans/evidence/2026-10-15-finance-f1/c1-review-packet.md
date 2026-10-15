# C1 review packet — durable invoice-link retry (F1, pending focused approval)

- Inputs: plan + spec at `28212e90d32a6038a0d82f24965ea1d26548316a`; evidence at `5da03a465fbbc5e8ff8afbd65691ae9f08eef18e`;
  current code read on `feat/f1-finance-api` (`daa8ae8`, which does not touch the notification send path).
- Status: nothing of C1 is implemented. Tasks 5 (`invoice_links` shape), 8g and 9 stay on hold. `GET
/invoices/:id/pdf` (server PDF) remains the approved contract; D-P1 is unapproved and out of this packet.
- Legend: **[D]** demonstrated (a test or a proof run exists), **[C]** read in current code (file:line), **[A]**
  assumption or design intent not yet exercised.

## 1. Exact spec excerpts (at 28212e9)

**R1-16 (approved):**

> 16. **The patient's link:** the message carries a link `/i/<token>`: 32 random bytes, stored as a SHA-256 hash
>     with the clinic, invoice and expiry (14 days), never logged; it shows the latest version of the invoice as a
>     PDF, stops working when voided, and one invoice can have several live links (each send makes one). Opening it
>     is audited as a patient-side view.

**R2-7 (approved):**

> 7. **The patient link lookup (N2):** `/i/<token>` is a public route with its own rate limit (by IP and token
>    prefix) listed in `public-rate-limits.ts`. The API resolves it through `invoice_link_lookup(token_hash) RETURNS
(clinic_id, invoice_id)` — `SECURITY DEFINER`, owned by a NOLOGIN, NOBYPASSRLS role with `SELECT` on the hash,
>    clinic, invoice, expiry and revoked columns only and its own policy (the 0059 pattern), `EXECUTE` to
>    `eyadex_app` only — then reads the invoice inside `withTenant`. The audit row's actor is `patient_link` (no
>    staff member), with the link id.

**R2-5 (approved, resend):**

> 5. **Resending (fixes R1-15):** the `patient_notifications_once` UNIQUE **constraint** is replaced by a partial
>    unique **index** on the same columns, `NULLS NOT DISTINCT`, `WHERE subject_type <> 'invoice'`; every writer's
>    `ON CONFLICT ON CONSTRAINT patient_notifications_once` becomes `ON CONFLICT (<those columns>) WHERE subject_type
<> 'invoice'`. Invoice notifications are unique on `(clinic_id, send_request_id)` instead. A repeated
>    `send_request_id` with the same invoice and channel returns the first row; the same id with a different invoice
>    or channel is `validation` (`send_request_conflict`).

**§8c.1 (C1, proposed):**

> 1. **C1 — durable invoice-link retry.** R1-16 stores the link token only as a SHA-256 hash, which a retried send
>    cannot rebuild. Proposal: `invoice_links` also stores `token_sealed` (the existing `SecretSealer`, AES-256-GCM,
>    key `OUTBOX_SEAL_KEY`, context `invoice_link:<clinic>:<link>:<notification>`); lookup still uses only the hash;
>    the lookup function's owner and the platform have no grant on the sealed column; a retry re-opens the sealed
>    token and re-sends the same URL; a rotated key or expiry revokes the link and mints a new one. Network sends run
>    after the link transaction commits, never inside it.

## 2. Corrections to statements made earlier in this session

1. **The WhatsApp access token is not sealed with `OUTBOX_SEAL_KEY`.** [C] The worker builds
   `providerSealer = new SecretSealer(config.MAIL_PROVIDER_SEAL_KEY)` (`apps/worker/src/main.ts:89`) and passes it
   as `whatsappSealer` (`:138`); only invitations use `OUTBOX_SEAL_KEY` (`:97`, `:124`). The class is shared; the
   keys are not.
2. **Today every patient-notification send runs inside the ledger transaction and its row lock.** [C]
   `PgNotificationStore.whileLocked` opens `withTenant` and `SELECT … FOR UPDATE` on the ledger row
   (`persistence/pg-notification-store.ts:53-70`); `sendWhatsapp` calls `sender.sendText` / `meta.sendTemplate` and
   then `state.record(...)` inside that callback (`send-whatsapp.ts:100-145`); `sendEmail` likewise. So §8c.1's
   "network sends run after the link transaction commits, never inside it" is a **new pattern for the invoice
   kind**, not a continuation of the current one (see §5, option choice).

## 3. Current system facts the trace relies on

| #   | Fact                                                                                                                                                                                                                                                        | Source                                                                                                                       | Kind                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| F1  | Outbox events for notifications carry `{ notificationId }` only.                                                                                                                                                                                            | API `pg-notification-queue.ts:52` → outbox insert; worker `pg-reminder-queue.ts:167-171`                                     | [C]                                                                           |
| F2  | The dispatcher claims one event per transaction on the `eyadex_dispatcher` pool with `FOR UPDATE SKIP LOCKED` and keeps the claim until the handler returns; a crash rolls the claim back and the event is claimable again.                                 | `packages/db/src/dispatcher.ts:177-200`                                                                                      | [C]                                                                           |
| F3  | The handler re-reads and locks the ledger row in its own `withTenant` transaction (`eyadex_app`); a row not `queued` is skipped as `settled`.                                                                                                               | `send-notification.ts:50-55`, `pg-notification-store.ts:58-69`                                                               | [C]                                                                           |
| F4  | A DB error inside the handler rolls the ledger transaction back and the event is retried by `afterFailure` (5 failures max).                                                                                                                                | `send-notification.ts:60-66`, `retry-schedule.ts:11,24-29`                                                                   | [C]                                                                           |
| F5  | Network outcome → `record(sent                                                                                                                                                                                                                              | failure{final?})`; `evo_timeout`is final (Evolution has no idempotency key); Meta errors are final unless in its`RETRY` set. | `send-whatsapp.ts:118-149`, `evolution-failure.ts:4-14`, `meta-failure.ts:58` | [C] |
| F6  | A crash after the provider accepted a message but before the ledger transaction commits rolls the `sent` record back; the event is reprocessed and the message can go out twice. This is the existing at-least-once behaviour for every kind.               | F2 + F3 + F5                                                                                                                 | [C] (by reading; no existing test found that kills the process mid-send)      |
| F7  | `SecretSealer`: AES-256-GCM, 32-byte key, 12-byte IV, 16-byte tag, format `v1.iv.body.tag`, context as AAD; `open` throws `SealOpenError` on wrong key, wrong context, tampering, truncated tag or bad format; no key versioning (one `v1`).                | `packages/secrets/src/secret-sealer.ts`; tests `secret-sealer.spec.ts:11-62`                                                 | [D]                                                                           |
| F8  | `OUTBOX_SEAL_KEY` rotation is an open item: "rotation needs a drain of pending events first. TODO(spec): key rotation."                                                                                                                                     | `docs/adr/0006-onboarding-outbox-and-sealed-links.md:44`                                                                     | [C]                                                                           |
| F9  | Partial-index swap semantics: reminders and the NULL-`subject_at` prescription stay single; two invoice sends with distinct `send_request_id` give two rows; a reused id is a unique violation; `ON CONFLICT ON CONSTRAINT` stops resolving after the swap. | evidence `definer-and-resend-proof.sql` (mirror table)                                                                       | [D] on a mirror table; [A] on the real table                                  |

## 4. Compatibility trace — hash-only (approved R1-16) vs C1

Notation: Tx-L = the link transaction; Tx-S = the existing `whileLocked` send transaction; "send" = the provider call.

| Scenario                                                           | Hash-only (R1-16 as approved)                                                                                                                                                                                                                                               | C1 (sealed copy)                                                                                                                                                                                                                                                                    | Evidence                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **S1 Current SQL and writers**                                     | Unaffected by C1 or by hash-only: both need the R2-5 index swap and both writers rewritten (`pg-patient-notifications.ts:42-48`, `pg-reminder-queue.ts:146-162`).                                                                                                           | Same. C1 adds only `invoice_links.token_sealed` and a partial unique `(clinic_id, notification_id) WHERE revoked_at IS NULL`.                                                                                                                                                       | [D] swap semantics F9; [A] real writers not yet changed       |
| **S2 Token creation**                                              | Worker draws 32 bytes, stores the hash. If minted inside Tx-S (today's pattern), the link row and the `sent` record commit together.                                                                                                                                        | Same draw; also stores `seal(token, context)`. Minted in Tx-L, committed **before** the send.                                                                                                                                                                                       | [A]                                                           |
| **S3 Committed outbox storage**                                    | Outbox stays `{notificationId}` (F1); no token anywhere but the message and the hash.                                                                                                                                                                                       | Same outbox. The DB additionally holds the sealed token (as invitations hold a sealed token in the outbox today, ADR-0006). Lookup function and platform: no grant on `token_sealed`.                                                                                               | [C] F1; [A] grants                                            |
| **S4 Crash before the send** (after minting)                       | If minted in Tx-S: rollback removes the link; retry mints a new one — patient got nothing yet, so harmless.                                                                                                                                                                 | Tx-L committed: retry finds the live link, opens it, sends the same URL.                                                                                                                                                                                                            | [A]                                                           |
| **S5 Crash after the provider accepted, before Tx-S commits** (F6) | Link was in Tx-S → rolled back → **the delivered URL is dead**; retry mints and sends a second, working link (patient gets two messages, the first one broken).                                                                                                             | Link committed in Tx-L → the delivered URL **works**; retry re-sends the **same** URL (patient gets two identical messages, both working).                                                                                                                                          | [A] — this is the case C1 exists for                          |
| **S6 Provider timeout** (`evo_timeout` final, F5)                  | Recorded final failure; no automatic retry; link (if minted in Tx-S) commits with the failure → a working link that may or may not have been delivered.                                                                                                                     | Same outcome; link already committed in Tx-L.                                                                                                                                                                                                                                       | [C] F5; [A]                                                   |
| **S7 Retryable failure** (Meta `RETRY` set, 5 failures max)        | Each attempt in Tx-S: link row from the earlier attempt committed with the `failure` record → next attempt must find it by `notification_id` and **cannot rebuild the token** → mints another link (a second live link for one notification unless the old one is revoked). | Next attempt opens the sealed token and re-sends the same URL; one live link per notification.                                                                                                                                                                                      | [A]                                                           |
| **S8 Explicit resend** (new `sendRequestId`)                       | New ledger row → new link (R1-16 "each send makes one"); earlier links stay live until expiry/void.                                                                                                                                                                         | Same; C1 changes nothing here. A reused `sendRequestId` returns the first row (no new link); with another invoice/channel → `send_request_conflict`.                                                                                                                                | [D] index semantics F9; [A] API flow                          |
| **S9 Key loss** (`OUTBOX_SEAL_KEY` gone or replaced)               | Not applicable (no sealed copy).                                                                                                                                                                                                                                            | Existing links **keep working** for the patient (lookup is by hash; the key is not involved). Only a retry of an in-flight notification fails to open → revoke that link and mint a new one. Invitations sealed in pending outbox events also fail (F8) — a shared-key consequence. | [D] F7 (SealOpenError on wrong key); [A] revoke-and-mint path |
| **S10 Key rotation**                                               | Not applicable.                                                                                                                                                                                                                                                             | Same as S9 for in-flight rows; ADR-0006 already requires draining pending events before rotating this key (F8). With a 14-day link lifetime, rotation never needs to wait 14 days: only **unsent** rows matter.                                                                     | [C] F8; [A]                                                   |
| **S11 Failed-send recovery** (final failure, give-up)              | Row ends `failed`; staff press «ابعت» again → S8 (new row, new link).                                                                                                                                                                                                       | Same; the failed row's link stays live until expiry unless revoked. Proposed: a final failure revokes its own link (no one received it for sure — except S6, where it may have; see open question Q4).                                                                              | [A]                                                           |
| **S12 Void before/after send**                                     | Void revokes live links (Task 8f); the worker skips a queued row as `invoice_void`.                                                                                                                                                                                         | Same; a sealed copy of a revoked link is never opened (the retry path checks `revoked_at` first).                                                                                                                                                                                   | [A]                                                           |

## 5. Decisions needed (focused)

- **Q1 — C1 itself:** add `token_sealed` (sealed copy bound to the row) so S5 and S7 deliver a working,
  single link per notification? Without it, S5 can leave the patient with a dead first link and S7 can leave two
  live links per notification (or a dead first one if the retry revokes it).
- **Q2 — which key:** (a) `OUTBOX_SEAL_KEY` as §8c.1 says (already in API and worker; rotation rules of ADR-0006
  apply; a loss also breaks pending invitations), or (b) a **new dedicated `INVOICE_LINK_SEAL_KEY`** in the worker
  only (the API never seals or opens the token; separate blast radius; one more secret for the owner to create in
  Dokploy for staging and production). Recommendation: (b), because only the worker needs it and invoice links
  should not share a fate with invitations.
- **Q3 — where the send runs:** (a) §8c.1 as written: Tx-L commits, then the send runs **outside** any
  transaction, then a new transaction records the outcome — a new pattern for one kind, which must also re-take
  the WhatsApp channel pace lock outside the ledger lock; or (b) **Tx-L commits, then the existing `whileLocked`
  path sends and records exactly as for every other kind** — the only change is that the link is durable before
  the send. Recommendation: (b): it fixes S5/S7, keeps one locking pattern, and the channel pacing and
  ambiguous-outcome rules (F5) stay untouched. This contradicts the earlier "network outside DB locks" instruction
  for this kind, so it needs an explicit choice.
- **Q4 — final failures:** should a final failure revoke its own link? S6 (timeout, maybe delivered) argues for
  keeping it live until expiry; a refused send argues for revoking. Recommendation: revoke only on failures that
  prove non-delivery (e.g. `evo_not_on_whatsapp`, Meta `meta_not_on_whatsapp`), keep it on ambiguous ones.

## 6. New operational requirements if C1 is approved

1. A seal key in the worker environment on staging and production (Q2: existing `OUTBOX_SEAL_KEY` or a new
   `INVOICE_LINK_SEAL_KEY` the owner generates with `openssl rand -base64 32` and pastes into Dokploy).
2. Rotation runbook line: rotate only after the invoice queue is drained (no `queued` invoice rows); unexpired
   links keep working after rotation.
3. Backups contain `token_sealed`; restoring a backup without the matching key only affects retries of rows that
   were in flight at backup time.
4. Logging: `token`, `tokenSealed` and the link path are added to the pino redaction list; the public route logs
   its pattern, not its path.
5. Monitoring: a `seal_unreadable`-style count for invoice links (key mismatch) in the worker log.

## 7. Demonstrated vs assumed (summary)

- **Demonstrated:** SecretSealer properties (F7, unit tests); partial-index resend semantics and that the old
  `ON CONFLICT ON CONSTRAINT` breaks after the swap (F9, mirror-table proof); outbox payload is ids-only (F1, code).
- **Read in code, not exercised:** the at-least-once double-send window (F6); dispatcher claim/rollback (F2);
  finality of timeouts (F5); key usage per sealer (§2.1).
- **Assumed (no code, no test yet):** every C1 behaviour in S2–S12; the revoke-and-mint path; grants on
  `token_sealed`; the real-table index swap with its CHECKs; both rewritten writers.

## 8. Tests C1 would ship with (if approved)

Crash after Tx-L before send (same URL on retry); crash after provider accept before Tx-S commit (delivered URL
still opens; retry re-sends the same URL); retryable failure ×2 (one live link); key replaced between attempts
(revoke + mint, exactly one live link); sealed value copied to another row fails to open; void between attempts
(skip, no open); pino output and outbox rows never contain token or sealed value; `invoice_link_lookup` owner and
`eyadex_platform` have no privilege on `token_sealed`.
