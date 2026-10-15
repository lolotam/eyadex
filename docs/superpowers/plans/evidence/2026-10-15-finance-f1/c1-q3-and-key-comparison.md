# C1 — Q3 send-path comparison and a dedicated seal key (for focused review)

Supplements `c1-review-packet.md`. **Not an approval of C1**: Task 9, the `invoice_links` half of 0062 and every
C1 code path stay held. Facts are tagged **[C]** read in code at `main` `759e8b4` (file:line given), **[A]**
assumed behaviour of a design not yet written.

## 1. Facts both paths start from

| #   | Fact                                                                                                                                                                                                                 | Source                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| K1  | The dispatcher claims one outbox event per transaction (`FOR UPDATE SKIP LOCKED`) and holds the claim until the handler returns; a crash rolls the claim back                                                        | [C] `packages/db/src/dispatcher.ts:177-200`                                               |
| K2  | The handler locks the ledger row `FOR UPDATE` in a `withTenant` transaction; a row not `queued` is skipped as settled                                                                                                | [C] `pg-notification-store.ts:53-70`, `send-notification.ts:50-55`                        |
| K3  | WhatsApp pacing: the clinic's channel row is taken `FOR UPDATE SKIP LOCKED` in that same transaction; if another send holds it the event is deferred one pace (8 s); after a send `next_send_at = now + 8 s + 0–4 s` | [C] `pg-channel-lock.ts:20-51`, `send-whatsapp.ts:59-61,83-84`, `whatsapp-pace.ts:2-4`    |
| K4  | Network timeouts: Evolution 8 s, Meta 15 s, the email route chain 8 s in total                                                                                                                                       | [C] `evolution-whatsapp-sender.ts:5`, `meta-graph-sender.ts:5`, `send-along-routes.ts:10` |
| K5  | The worker's app pool runs transactions with a 30 s timeout                                                                                                                                                          | [C] `apps/worker/src/main.ts:56-61`                                                       |
| K6  | `evo_timeout` is final (no automatic retry: Evolution has no idempotency key)                                                                                                                                        | [C] `evolution-failure.ts:4-14,60-69`                                                     |

Both paths begin with **Tx-L**: lock the ledger row, find or mint the link (sealed copy), commit.

- **Path (a)** — §8c.1 as written: Tx-L commits → send with **no** transaction → **Tx-R** records the outcome.
- **Path (b)** — packet recommendation: Tx-L commits → the **existing** `whileLocked` transaction (ledger
  lock + channel lock) sends and records, as for every other kind.

## 2. Bounded comparison

| Dimension                                                | (a) send outside any transaction                                                                                                                                                                                                                                       | (b) existing `whileLocked` path                                                                                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Crash after the provider accepted, before the record** | Row stays `queued`; outbox claim rolls back (K1); retry re-enters Tx-L, finds the live link, re-sends **the same URL**. Patient: 2 identical working messages. [A]                                                                                                     | Send transaction rolls back (K1, K2); retry identical to (a): same URL, 2 identical working messages. [A]                                                                                              |
| **Crash before the send**                                | Same URL on retry, 1 message. [A]                                                                                                                                                                                                                                      | Same. [A]                                                                                                                                                                                              |
| **Concurrent retries of one notification**               | Between Tx-L commit and Tx-R nothing locks the ledger row, so a second handler for the same `notificationId` passes Tx-L and sends too ⇒ **duplicate send** unless a new `sending` state with a lease is added (new states, timeouts, recovery of expired leases). [A] | The ledger row lock serialises them; the second handler waits, then sees `sent` and skips (K2). No new state. [C] for the lock, [A] for the invoice kind                                               |
| **Channel pacing (WhatsApp)**                            | The channel lock (K3) lives in a transaction; outside one it is gone, so two invoice sends of one clinic can go out < 8 s apart unless pacing is re-implemented as a lease on `next_send_at` (reserve-then-send). New pattern for one kind. [A]                        | Unchanged: the channel row is held during the send; a second send is deferred one pace (K3). [C]                                                                                                       |
| **Lock / connection hold time**                          | Two short transactions (milliseconds); no pool connection held during the network call.                                                                                                                                                                                | Ledger row, channel row and one pool connection held for the network call: ≤ 8 s (Evolution, email chain) or ≤ 15 s (Meta), under the 30 s transaction cap (K4, K5). Same as every notification today. |
| **Ambiguous timeout (`evo_timeout`)**                    | Recorded final in Tx-R; link committed in Tx-L. [A]                                                                                                                                                                                                                    | Recorded final in the send transaction; link committed in Tx-L. [A]                                                                                                                                    |
| **Code surface**                                         | New: send outside the store, a lease state, a pacing lease, their tests and recovery jobs.                                                                                                                                                                             | One extra short Tx-L before the existing call; no change to pacing, retry or finality rules.                                                                                                           |

**Bound on harm, both paths:** at-least-once delivery (K1) means at most one extra identical message per crash
window; with C1 every delivered URL works. Path (a) adds a second duplicate source (concurrency) and a pacing
gap that (b) does not have. Path (a)'s only gain is shorter lock and connection hold, which the worker already
accepts for every other kind.

**Recommendation (unchanged): (b).** It needs the explicit choice because it departs from the sentence in
§8c.1 "Network sends run after the link transaction commits, never inside it": under (b) the _link_ transaction
still commits before the send, but the send runs inside the existing ledger transaction.

## 3. A dedicated seal key — rotation and recovery (Q2 option b)

Name: `INVOICE_LINK_SEAL_KEY`, 32 random bytes base64 (`openssl rand -base64 32`), **worker only** (the API never
seals or opens a link token; lookup is by SHA-256 hash). Created by the owner in Dokploy for staging and
production; never in a file, log or commit (CLAUDE.md §8).

| Event                                               | Proposed behaviour [A]                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal send                                         | Tx-L seals the token with context `invoice_link:<clinic>:<link>:<notification>`; retries open it and re-send the same URL.                                                                                                                                                          |
| Planned rotation                                    | 1) stop new invoice sends from being picked (pause the worker or wait), 2) wait until no invoice ledger row is `queued`, 3) replace the key, restart the worker. Sent links keep working (lookup never uses the key). No 14-day wait.                                               |
| Rotation without draining / key replaced by mistake | A retry's `open` throws `SealOpenError` ⇒ revoke that link (`revoked_at`) and mint a new one for the same notification; the patient may hold a dead first link **only** if the first attempt was delivered and then crashed. Logged as `invoice_link_seal_unreadable` (count only). |
| Key lost                                            | Same as the row above for in-flight rows; nothing else breaks (unlike `OUTBOX_SEAL_KEY`, whose loss also breaks pending invitations — ADR-0006).                                                                                                                                    |
| Key missing at boot                                 | The worker refuses to start the invoice handler (config validation), other handlers run; invoice rows stay `queued` until the key is set.                                                                                                                                           |
| Backup restore                                      | Rows in flight at backup time need the key that was live then; others are unaffected.                                                                                                                                                                                               |
| Key leaked                                          | Rotate as planned; sealed values in backups taken before rotation stay decryptable with the leaked key, but only reveal tokens of links that expire within 14 days and are revocable by voiding or by a revoke-all job.                                                             |

No key versioning in `SecretSealer` today (single `v1` format, packet F7), so two keys cannot be live at once;
the drain step is what makes rotation safe.

## 4. Decisions still open for C1

| Q   | Choice                  | Recommendation                                 |
| --- | ----------------------- | ---------------------------------------------- |
| Q1  | Store `token_sealed`    | yes                                            |
| Q2  | Key                     | dedicated `INVOICE_LINK_SEAL_KEY`, worker only |
| Q3  | Send path               | (b), with §8c.1's sentence amended             |
| Q4  | Revoke on final failure | only on failures that prove non-delivery       |
