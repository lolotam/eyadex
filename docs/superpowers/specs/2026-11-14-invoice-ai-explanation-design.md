# Invoice explanation through AI Gateway

Date: 2026-11-14
Status: approved by the owner's standing instruction to choose the recommended options and proceed
Branch: `feat/invoice-ai-explanation`

## Purpose

Allow a clinic staff member who can already view an invoice to enter a free-form question or instruction about its billable items. The application produces a clear, patient-friendly explanation grounded in the invoice's actual lines and totals through Vercel AI Gateway. The staff member reviews and copies the result; it is not attached to the invoice or sent to the patient.

## Current state and boundaries

- `InvoiceReads.get()` loads an invoice inside `withTenant` and applies `view:invoices` reach (`clinic`, `branch` or `own`) before returning it.
- `POST /v1/invoices/:id/send` demonstrates the thin-controller pattern and `@Require("view:invoices:own")` plus `@RequiresFeature("finance")`.
- F3 export admission demonstrates a row plus outbox event in one transaction, requester-only status reads and a worker-side current-access check.
- The web invoice page reads through `ApiClient.finance`; mock and HTTP implementations must expose the same operation.
- No AI SDK or AI Gateway integration currently exists in the workspace.
- Lovable writes only `apps/web` and its own planning files. Contracts, SQL, API and worker work remain with the orchestrator and the designated migrations lane.
- The project's rule that work expected to exceed 200 ms goes to a worker makes synchronous AI generation non-compliant.

## Official integration references

- [AI SDK with AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/ai-sdk): the recommended TypeScript path is the `ai` package; current documentation recommends AI SDK 7 and Node 22+, compatible with this project's Node 24 baseline.
- [Authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok/authentication): self-hosted servers use `AI_GATEWAY_API_KEY`; OIDC is available for Vercel deployments but is not the deployment mechanism here.
- [Models and providers](https://vercel.com/docs/ai-gateway/models-and-providers): model ids use `creator/model-name`; model selection is configuration rather than hard-coded business logic.

## Approaches considered

1. **Bounded worker generation with an injected gateway port and a temporary request row (chosen).** One POST admits a job and one GET polls it. The worker calls the model outside a database transaction, rechecks access and stores only the temporary result. This follows the 200 ms rule and the existing F3 outbox pattern.
2. Synchronous API generation. Smaller, but holds an HTTP request for a model call expected to exceed 200 ms and was rejected by the project rule.
3. Streaming tokens over SSE. Better perceived latency, but still holds a long-lived API connection and adds partial-answer/cancellation complexity that this first slice does not need.

## User experience

- The invoice page shows an AI explanation action to users who can view the invoice.
- The action opens a dialog containing a required free-form question/instruction field, a Generate action and a Cancel/close action.
- The field accepts 1–1000 characters after trimming. Examples are translated placeholders, not hard-coded JSX text.
- Generation uses the current UI language (`ar` or `en`).
- Admission starts polling the returned request id every two seconds while the dialog remains open. Queued/running states show translated progress and disable duplicate submission.
- Closing the dialog stops polling but does not pretend to cancel the worker job. A later opening starts with a new question; it does not show an old answer as if it belonged to the new question.
- Success displays the generated text with preserved line breaks and a Copy action. Copy success/failure uses translated feedback.
- Failed/expired jobs show the returned stable error code and allow a new generation request with a fresh idempotency key. Retry never reuses a completed job's key for a different question.
- Configuration, capacity, timeout, rate-limit and generation failures have distinct translated messages. No question or generated/invoice content is written to a toast, log or audit snapshot.
- The dialog does not change invoice status, payments, stored invoice lines or notifications.

## API contracts

### Create a generation request

`POST /v1/invoices/:id/explain` with a required `Idempotency-Key`.

Strict Zod request:

```json
{
  "question": "Explain the discount and remaining balance",
  "language": "en"
}
```

Response uses HTTP 202 for a new request and HTTP 200 for an idempotent replay:

```json
{
  "request": {
    "id": "uuid",
    "status": "queued",
    "createdAt": "2026-11-14T00:00:00.000Z",
    "expiresAt": "2026-11-14T01:00:00.000Z"
  }
}
```

- `question`: trimmed string, 1–1000 characters.
- `language`: exactly `ar` or `en`.
- The route declares `@Require("view:invoices:own")` and `@RequiresFeature("finance")`.
- The use case calls `InvoiceReads.get()` before admission. An inaccessible invoice answers `not_found` exactly as the normal invoice read.
- The idempotency ledger is the existing clinic-scoped ledger. The same key and same normalized body replay the first request id; the same key with a changed body is a conflict. A failed admission leaves no claimed key.
- One queued/running request per membership is allowed. Another returns `ai_busy`. A dedicated Redis limiter allows at most five new requests per membership in ten minutes and fails closed as the existing limiter rules require; exceeding it returns `ai_rate_limited`.
- The request row and `finance.invoice_explanation_requested` outbox event are written in one tenant transaction. The event payload contains only `requestId`; the outbox already carries `clinicId`.

### Read a generation request

`GET /v1/invoices/:id/explanations/:requestId`

Strict Zod response:

```json
{
  "request": {
    "id": "uuid",
    "status": "succeeded",
    "explanation": "...",
    "errorCode": null,
    "createdAt": "2026-11-14T00:00:00.000Z",
    "expiresAt": "2026-11-14T01:00:00.000Z"
  }
}
```

- `status`: `queued`, `running`, `succeeded` or `failed`.
- `explanation`: non-empty trimmed text up to 12000 characters only on success, otherwise `null`.
- `errorCode`: one of `ai_not_configured`, `ai_generation_failed`, `ai_timeout`, `ai_rate_limited`, `ai_busy` or `ai_access_revoked` only on failure, otherwise `null`.
- The route uses the same view permission and finance feature declaration. It rechecks `InvoiceReads.get()` and requires `requested_by = actor.membershipId`. Another member, another invoice, another clinic, an expired request or an unknown id returns `not_found`.
- The normal error envelope applies. Both adapters parse the response with its Zod schema and preserve every listed error code instead of using `unknown`.

## Temporary persistence and worker lifecycle

Add one numbered SQL migration and its Drizzle mirror for `invoice_explanation_requests`:

- `(clinic_id, id)` primary key; `clinic_id` is required on every row.
- Composite foreign keys to the invoice and requesting membership within the same clinic.
- `invoice_id`, `requested_by`, nullable `question`, `language`, `status`, nullable `explanation`, nullable `error_code`, `created_at`, `updated_at` and `expires_at`.
- `question` is required while queued/running and is cleared when the worker reaches a terminal state. `explanation` is required only for success; `error_code` is required only for failure.
- RLS is ENABLED and FORCED with the standard clinic predicate for USING and WITH CHECK. The runtime API/worker access is through `withTenant`; `eyadex_platform` receives no grant.
- Indexes cover requester status reads and queued/running admission checks, beginning with `clinic_id`.
- The migration adds the table to the RLS isolation fixtures/tests in the same PR.
- Expiry is one hour after creation. A reviewed retention function owned by a NOLOGIN role and executable only by `eyadex_dispatcher` deletes expired rows; no runtime role receives general delete permission.

Worker flow:

1. The outbox handler opens the event's clinic with `withTenant` and atomically moves the queued request to `running`; a duplicate event exits without another model call.
2. It reads the requester's current membership, role, clinic, finance flag, permissions and branches without cached authorization. Revoked access finishes the row as `ai_access_revoked` without calling the model.
3. It reads the invoice through the same reach rule and constructs the allowlisted model DTO. A lost invoice reach has the same refusal.
4. It calls AI Gateway outside any database transaction with a 30-second timeout. It then writes success or a stable failure code and clears the question. The response schema rejects an empty or oversized answer rather than truncating it.
5. A worker crash/outbox retry cannot expose a partial answer. The existing outbox retry policy applies; a job that cannot safely continue ends as `ai_generation_failed` with no provider response body stored.

## Authorized model input

Build a fresh explicit DTO from the authorized invoice. Never serialize the whole `Invoice` object.

Included:

- Requested language and the staff member's question.
- Each active line's description in the requested language with a fallback to the other description, quantity, unit price, line discount kind/value and line total, all as exact minor-unit strings.
- Invoice-level discount kind/value, tax rate in basis points, subtotal, discount, tax and total; for issued invoices with settlement, paid and owed amounts.
- Currency code and exponent.

Excluded:

- Patient name, patient id, membership/user ids and branch id/name.
- Invoice id/number, source ids, link tokens and internal timestamps.
- Discount reasons, void reason, clinical content, attachments, contact details, payment/refund reasons and free-form audit data.
- Any database row, request headers, environment values or gateway credentials.

The prompt instructs the model to use only the supplied figures, not to recalculate or invent discounts/taxes/payments, and to say when the supplied data is insufficient. The server constructs the prompt; the client never supplies invoice lines or totals.

## AI Gateway adapter and configuration

- Add the officially supported `ai` dependency to `apps/worker` only, using the version selected by the lockfile and the repository's 24-hour supply-chain policy. No frontend/API AI SDK dependency or browser credential is introduced.
- Define an injected `InvoiceExplanationGenerator` port. The AI SDK adapter calls `generateText` with a plain configured model id.
- `AI_GATEWAY_API_KEY` and `AI_GATEWAY_MODEL` are read only in the worker. Missing configuration fails the job with `ai_not_configured` without preventing unrelated API/worker routes from starting.
- The model id is required configuration; there is no hidden provider/model fallback. The deployment runbook documents a supported language-model id and budget/rate-limit ownership.
- The adapter maps provider/authentication/rate-limit/timeout failures to stable error codes without chaining or logging provider response bodies.
- No streaming, tool calls, model-provided links or HTML rendering are enabled. The web renders plain text only.
- `pnpm-lock.yaml` and `.env.example` change only for this integration. Actual secrets are supplied through the approved secret channel and Dokploy configuration, never committed or pasted into chat.

## Mock behavior

- The mock applies the same actor → clinic → finance module → invoice visibility order before admission and on status reads.
- It simulates queued → running → succeeded deterministically and builds a translated explanation from the authorized mock invoice and question; no network call or AI credential is used in preview/tests.
- Mock fixtures exercise `ai_busy`, `ai_rate_limited`, `ai_not_configured`, `ai_generation_failed`, `ai_timeout` and `ai_access_revoked`, including retry with a fresh idempotency key.
- The HTTP adapter covers 202 admission, 200 replay and polling responses; the mock covers identical state transitions.

## Security, privacy and operations

- Admission, worker execution and every status read each check current authorization. Permission revocation or clinic suspension prevents subsequent use; no result is cached outside the temporary request row.
- Prompt construction has a direct unit test proving that excluded fields cannot appear even when they contain distinctive sentinel values.
- API/worker logs record only normal request metadata and stable error codes, never the question, invoice lines, patient data, prompt or generated answer.
- AI Gateway is an external processor for the limited invoice-item dataset. No clinical records or patient identity are intentionally sent.
- Deployment requires an owner-approved API key, model id and budget. Missing owner configuration leaves the feature safely unavailable with `ai_not_configured`; it never silently uses another provider.

## Testing and acceptance

- Contract tests cover strict request/response parsing, trimming, lengths, language, statuses and error codes.
- Domain tests prove exact minor-unit data is preserved and prompt DTOs contain only allowlisted fields.
- SQL tests prove forced RLS, composite foreign keys, status/result consistency, retention permission and cross-clinic read/write refusal.
- API integration tests against real PostgreSQL cover clinic/branch/own access, requester-only status, cross-clinic `not_found`, finance disabled, revoked permission, idempotent replay/conflict, admission capacity and rate limiting.
- Worker tests cover duplicate events, current-access revocation, gateway parameter construction, timeout, provider failures, result validation and question clearing, without real network calls.
- Web tests cover dialog validation, Arabic/English generation, polling, close/reopen, success, copy, retry and every error code in both mock and HTTP adapters.
- Browser checks on staging use a real configured gateway if the owner has supplied configuration; otherwise they explicitly verify the safe `ai_not_configured` state and real AI generation remains an activation check.
- The migration is applied to staging before the code that needs it, then staging checks pass before merge. Production migration precedes the production deployment; production health and the configured/unconfigured feature state are verified after deployment.

## Out of scope

- Attaching explanations to invoices, long-term history, sharing or automatic patient sending.
- Streaming, chat history, tool calling, clinical advice, medical-record input or patient identification.
- A new role permission, role-name checks, public invoice endpoint changes or platform access to invoice rows.
- Automatic currency conversion, recalculated financial truth or a second source of invoice totals.
- Multiple models, hidden fallback providers, BYOK setup or per-clinic AI settings in this slice.
