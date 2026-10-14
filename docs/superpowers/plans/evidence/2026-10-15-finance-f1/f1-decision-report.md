# F1 corrected-plan decision report (focused review)

**Pinned to:** docs `9120f9b` (`docs/finance-design`) and code `f694a52` (`feat/f1-finance-api`), both based on
`main` `759e8b4`. Line numbers below are at those SHAs. Nothing is sent to Lovable; no dependent task is
implemented; production SQL and deployment stay owner-gated.

Evidence tags: **[V]** verified (test run, proof output or code read at the pinned SHA) · **[U]** unrun (a
planned SQL or CI check that has not executed) · **[P]** proposal awaiting decision.

## 1. Decisions requested

### 1.1 C1 — durable invoice-link retry (token retry/restart) [P]

Exact proposal, spec §8c.1 (`docs/specs/finance-design.md:312-317`):

> **C1 — durable invoice-link retry.** R1-16 stores the link token only as a SHA-256 hash, which a retried
> send cannot rebuild. Proposal: `invoice_links` also stores `token_sealed` (the existing `SecretSealer`,
> AES-256-GCM, key `OUTBOX_SEAL_KEY`, context `invoice_link:<clinic>:<link>:<notification>`); lookup still
> uses only the hash; the lookup function's owner and the platform have no grant on the sealed column; a retry
> re-opens the sealed token and re-sends the same URL; a rotated key or expiry revokes the link and mints a new
> one. Network sends run after the link transaction commits, never inside it.

The restart behaviour in the plan (`2026-10-15-finance-f1.md:803-804`, Task 9):

> A crash between 1 and 3 leaves the row `queued`; the next attempt re-enters step 1, finds the live link and
> re-sends **the same URL** — one link per notification, never two live links for one send.

If declined (plan `:810-811`): "a retry mints a new link and revokes the old one" (hash-only kept): a crashed send
could then leave the patient holding a link that no longer works.

The four focused choices from the review packet (`c1-review-packet.md` §5, quoted in short):

| Q   | Question                              | Packet recommendation                                                                  | Conflicts with                                                                                                                                                           |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Add `token_sealed` at all?            | Yes (fixes S5 dead first link, S7 two live links)                                      | R1-16 hash-only storage                                                                                                                                                  |
| Q2  | Which key?                            | (b) a new `INVOICE_LINK_SEAL_KEY`, worker only                                         | §8c.1 text says `OUTBOX_SEAL_KEY`                                                                                                                                        |
| Q3  | Where does the network send run?      | (b) commit the link first, then send through the existing `whileLocked` path           | §8c.1 and plan Task 9 say "never inside" a transaction; today every send runs inside one ([V] packet §2.2, `pg-notification-store.ts:53-70`, `send-whatsapp.ts:100-145`) |
| Q4  | Does a final failure revoke its link? | Only failures that prove non-delivery; keep the link on ambiguous ones (`evo_timeout`) | none                                                                                                                                                                     |

Approving C1 means answering Q1–Q4; §8c.1 and Task 9 are then edited to the chosen Q2/Q3 before any code.

### 1.2 `send_request_id` — approved rule, one open detail

The rule itself is **approved** as R2-5 (`finance-design.md:289-294`, §8b binding) and was part of the owner's F1
approval relayed by the supervisor on 2026-10-15 ("…واختبار تعارض نفس المعرف…" — a test for the same-id
conflict):

> A repeated `send_request_id` with the same invoice and channel returns the first row; the same id with a
> different invoice or channel is `validation` (`send_request_conflict`).

It does **not** depend on C1: the column, its partial unique index and the conflict rule live in 0062 next to the
index swap, and the swap's semantics are proven on a mirror table ([V] `output.txt:45,55-57`, "same send_request_id
with another invoice/channel refused", "ON CONFLICT ON CONSTRAINT fails after the swap").

Approval requested:

1. **Status code.** Code says **400** (`apps/api/src/shared/errors.ts`, `send_request_conflict: 400`, matching
   `validation: 400` at `:9`, as R2-5 says "is `validation`"); plan Task 9 test 4 says **422**
   (`2026-10-15-finance-f1.md:819`). Proposed: keep 400 and correct the plan line.
2. **Split 0062** into "sends" (index swap, kind and subject `invoice`, `send_request_id`) and "links"
   (`invoice_links`, `invoice_link_lookup` and its owner), so the C1-independent half can ship before the C1 answer.

### 1.3 D-P1 — why it is still "pending" while the server PDF stays the contract

- **Approved contract:** `GET /invoices/:id/pdf`, "Bilingual PDF rendered by the API… (approved contract; D-P1 in
  §8c is only a proposal)" (`finance-design.md:110`; FIN-5).
- **D-P1** (`finance-design.md:318-322`, plan `:49-58`) proposes replacing it with a web print view. It was
  raised because the API renders no PDF today (prescriptions print in the browser), so the server PDF means a new
  renderer (library, Arabic shaping, fonts) that has no design yet.
- "Pending" therefore means one thing only: **Task 8g (the renderer) is held** until D-P1 is answered, because
  plan `:751-753` says that if D-P1 is declined, 8g first gets its own design note (renderer, Arabic shaping, A4).
  It does not reopen the contract: contracts, SQL, the API, the brief and the mock all target the server PDF.
- The one web element that would change if D-P1 were approved is the brief's PDF button (§6), which would become
  a print view; the brief already excludes any print view and the public page.
- Recommended answer: **decline D-P1** (keep the approved server PDF), then approve a short 8g design note.

## 2. Task dependency map

| Task                                             | Depends on C1           | Depends on D-P1         | State at the pinned SHAs                                      |
| ------------------------------------------------ | ----------------------- | ----------------------- | ------------------------------------------------------------- |
| 1 money + totals                                 | no                      | no                      | done (`daa8ae8` family) [V]                                   |
| 2a module + 13 keys, 2b contracts                | no                      | no                      | done (`daa8ae8`, `829bfe9`, `7f36ae8`, `f694a52`) [V]         |
| 3 SQL 0060 core                                  | no                      | no                      | not started (held only by "go")                               |
| 4 SQL 0061 totals + currency                     | no                      | no                      | not started; proofs exist [V]                                 |
| 5 SQL 0062 sends (index swap, `send_request_id`) | no                      | no                      | not started; mirror proof [V]                                 |
| 5 SQL 0062 links (`invoice_links`, lookup owner) | **yes**                 | no                      | held                                                          |
| 6 SQL 0063 release grants                        | no                      | no                      | not started                                                   |
| 7 Drizzle + shared BlobStore                     | no                      | no                      | not started                                                   |
| 8a–8f, 8h–8j API                                 | no                      | no                      | not started                                                   |
| 8g server PDF renderer                           | no                      | **yes**                 | held                                                          |
| 9 invoice send worker + public link              | **yes**                 | no (link shows the PDF) | held                                                          |
| 10 Lovable brief                                 | no (excludes link page) | button only (§1.3)      | drafted, **unsent** (`.lovable/plan/p4-f1-web-2026-10-15.md`) |
| 11 integrate, review, release                    | yes                     | yes                     | later                                                         |

## 3. Evidence

### 3.1 The 13 permission keys

| Claim                                                       | Evidence                                                                                                                                                  | Tag |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| Spec defines 9 + 2 + 2                                      | `finance-design.md:69-73` (§3.1 table), `:323` (§8c.3 "**13** finance keys")                                                                              | V   |
| Resources and grammar                                       | `permissions.ts:20-22` (resources), `:34` (key regex), `:60-62` (module `finance`)                                                                        | V   |
| Scopes per action                                           | `permissions.ts:103-110` (`invoices` view clinic/branch/own, create/update/deactivate branched; `discounts` create branched; `prices` view/update clinic) | V   |
| The 13 literals                                             | `permissions.ts:197-209` (`PERMISSION_KEYS`)                                                                                                              | V   |
| Exact set, order, last 13 rows, only `own` is view-invoices | `__tests__/finance-catalogue.spec.ts:9-47`, run: contracts 70/70                                                                                          | V   |
| Discount needs view on invoices                             | `permissions.ts:137-138` (`VIEWED_THROUGH`), `roles.ts:58`, test `finance-catalogue.spec.ts:49-59`                                                        | V   |
| `own` needs `view:invoices:clinic` to grant                 | `grant-rules.ts:36-37`, test `finance-grant-rules.spec.ts`, run: API 664/664                                                                              | V   |
| New-clinic roles                                            | `system-roles.ts:19-21` (admin = clinic scope minus `medical`), `:51-52` (doctor), `:72-76` (receptionist)                                                | V   |
| DB seed ids `…0c0034`–`…0c0040` in catalogue order          | plan `:449-451` (0060 step 2); `permission-catalogue.db.spec.ts` compares rows                                                                            | U   |
| Locked admin gets exactly the 7 clinic-scope keys           | plan `:649-662` (0063, `p.scope = 'clinic'`); `finance-release.sql` test                                                                                  | U   |

Spec wording gap: §3.1 (`finance-design.md:75-76`) still says the clinic admin "already holds the whole
catalogue"; R2-4 and §8c.3 (`:327-328`) say seven clinic-scope keys, which is what the code and 0063 do.
Proposed one-line spec correction, pending this review.

### 3.2 Per-line vs aggregate money bounds

| Bound                                                                                | Evidence                                                                                  | Tag |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --- |
| Line cap 10¹², aggregate cap 2⁶³−1, digits only                                      | `money.ts:12,15,17,30,33`                                                                 | V   |
| Requests: prices, unit prices, line discounts use the line cap                       | `finance.ts:32,50,60,208,215`                                                             | V   |
| Invoice discount and every response total use the aggregate                          | `finance.ts:33,107,119,121,139-143,233,235,285`                                           | V   |
| Totals: gross per line ≤ 10¹²; every aggregate bounded                               | `invoice-totals.ts:83`, `:142-150` (`bounded`)                                            | V   |
| Tests: above-line aggregate passes; above-ceiling fails; line 10¹²+1 fails           | `invoice-totals.spec.ts:88,153`; `money.spec.ts:52`; `finance-contracts.spec.ts:71,89-91` | V   |
| DB: `clinic_services.price_minor` ≤ 10¹²                                             | plan `:459`                                                                               | U   |
| DB: `service_provider_prices.price_minor` ≤ 10¹² (added in `bd21515`)                | plan `:461-462`                                                                           | U   |
| DB: `invoice_lines.unit_price_minor`, `line_total_minor` ≤ 10¹² (added in `bd21515`) | plan `:471-472`                                                                           | U   |
| DB: invoice aggregates `>= 0`, ceiling = `bigint`                                    | plan `:467`                                                                               | U   |

### 3.3 SECURITY DEFINER owners, grants and policies

Planned shape (plan `:487-499`, Task 4; `:622-627`, Task 5 links):

| Owner (NOLOGIN, NOBYPASSRLS)    | Function                 | Column grants                                                                                                                                                                                           | Policies (to the owner)                              | Caller            |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------- |
| `eyadex_finance_totals_owner`   | `finance_monthly_totals` | `clinics (id, timezone)`; `invoices (clinic_id, status, issued_at, total_minor, currency)`                                                                                                              | SELECT USING (true) on both                          | `eyadex_platform` |
| `eyadex_finance_currency_owner` | `finance_set_currency`   | `clinics` SELECT `(id, currency)`, UPDATE `(currency, currency_exponent, updated_at)`; SELECT `clinic_services (clinic_id, price_minor)`, `service_provider_prices (clinic_id)`, `invoices (clinic_id)` | `clinics` SELECT + UPDATE; SELECT on the other three | `eyadex_platform` |
| `eyadex_invoice_link_owner`     | `invoice_link_lookup`    | `invoice_links (clinic_id, id, invoice_id, token_hash, expires_at, revoked_at)`, never `token_sealed`                                                                                                   | own SELECT                                           | `eyadex_app`      |

All: `SECURITY DEFINER`, `SET search_path = pg_catalog, public`, `REVOKE ALL … FROM PUBLIC`, EXECUTE to the one
caller (plan `:497-499`).

| Check                                                                                                                                                        | Evidence                                                            | Tag           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------- |
| Platform could set `currency` directly before the fix                                                                                                        | `output.txt:3`                                                      | V             |
| A column-only revoke does not help (table-level UPDATE from 0013:34 remains)                                                                                 | `output.txt:4`                                                      | V             |
| After `REVOKE UPDATE` + 12 named columns: currency, exponent, mixed update refused; tax, status, SELECT, INSERT work                                         | `output.txt:5-10`; SQL `currency-bypass-proof.sql`; plan `:514-516` | V             |
| Totals by month per clinic through the function                                                                                                              | `output.txt:31-32`                                                  | V             |
| Platform direct read of `invoices` and `service_provider_prices` refused                                                                                     | `output.txt:33-34`                                                  | V             |
| `currency_locked` with invoices; `currency_unsupported`; clean clinic → SAR/2                                                                                | `output.txt:35-38`                                                  | V             |
| Both owners `login=false bypassrls=false`; `eyadex_app` has no EXECUTE; owner has no `patient_id`                                                            | `output.txt:39-40`                                                  | V             |
| The above ran on a local `postgres:18-alpine` with 0001–0059, in a rolled-back transaction, with function bodies from the proof file (not yet the 0061 file) | `output.txt:1`                                                      | V (scope)     |
| 0061 as a migration file, in CI                                                                                                                              | Task 4                                                              | U             |
| Column-check `DO` block fails when `clinics` gains an unreviewed column                                                                                      | plan `:506-513`                                                     | U             |
| Void excluded from totals; clinic-timezone month edge                                                                                                        | Task 4 step list                                                    | U             |
| Lookup owner has no privilege on `token_sealed`; platform none on `invoice_links`                                                                            | Task 9, `db/tests/finance.sql`                                      | U, held by C1 |
| The index swap on the real `patient_notifications` table and both rewritten writers                                                                          | Task 5 step 4                                                       | U             |

## 4. Other discrepancies found in this review (not edited; proposed fixes)

| Where                              | Says                                             | Should say                                       |
| ---------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| plan `:819` (Task 9 test 4)        | 422 `send_request_conflict`                      | 400 (§1.2)                                       |
| spec `:75-76` (§3.1)               | admin "already holds the whole catalogue"        | the seven clinic-scope finance keys (§3.1 above) |
| plan `:71` (waiting list)          | "the print parts of 10"                          | "the PDF button of 10 only if D-P1 is approved"  |
| plan `:80` (branches and delivery) | contracts reach `lovable` "first (Task 9)"       | Task 10 step 1, after 0060 is green              |
| plan `:366` (Task 2 error list)    | includes `invoice_link_expired`                  | held with C1 (reconciliation §6)                 |
| spec §8c.1 / plan Task 9           | `OUTBOX_SEAL_KEY`, sends outside any transaction | whatever Q2/Q3 decide                            |

## 5. Lovable readiness gates (brief unsent)

Sequence kept: **Plan mode → plan review → separate execution instruction** (memory rule 2026-10-15; brief
header and plan Task 10 steps 3–5).

1. This review answered (C1 Q1–Q4, D-P1, the 400 status, the 0062 split).
2. SQL 0060 written and green in CI (`db` job) before contracts merge into `lovable` (Task 10 step 1).
3. Merge and send back to back: the merge turns the web typecheck red in about 75 files (63 from the
   `errors.<code>` dictionary type) until brief §0 lands. It was 15 files before `829bfe9` added the codes.
4. The supervisor approves the brief text; the brief then goes in Plan mode; Lovable's plan is reviewed; a
   separate "Execute the approved plan" message follows.
5. Not in this brief (later): the branch prefix field and the platform currency/tax fields (Tasks 8h/8i), the
   public link page (C1), any print view (D-P1).

## 6. Changes since the pinned SHAs

None on any branch: `origin/docs/finance-design` = `9120f9b`, `origin/feat/f1-finance-api` = `f694a52`,
`origin/main` = `origin/lovable` = `origin/staging` = `759e8b4` (checked 2026-10-15 after `git fetch`). This
report is the only new file; its commit is the next one on `docs/finance-design`.
