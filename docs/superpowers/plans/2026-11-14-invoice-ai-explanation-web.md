# Invoice AI Explanation — Web adapters and UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Approved spec: `docs/superpowers/specs/2026-11-14-invoice-ai-explanation-design.md`. Parent plan: `docs/superpowers/plans/2026-11-14-invoice-ai-explanation.md`.

## Task 15: Add the finance boundary and HTTP adapter

**Owner: Lovable, `apps/web` only.** **Files:** `finance-client.ts`, `http/http-invoice-explanations.ts`, `http/http-finance.ts`, `http/__tests__/invoice-explanations.test.ts`.

- [ ] Add the two methods to `FinanceApi`, importing the types from `@eyadex/contracts/invoice-explanation`. Lovable consumes the contracts delivered by Task 1 and must not edit `packages/contracts`.

```ts
explainInvoice(persona: Persona, invoiceId: string, body: ExplanationBody,
  idempotencyKey: string): Promise<ExplanationAdmission>;
invoiceExplanation(persona: Persona, invoiceId: string,
  requestId: string): Promise<ExplanationStatusResponse>;
```

- [ ] Add a fetch-stub test using existing `stubFetch`, `CLINIC`, `USER`, `me`, `clientWith` from `http/__tests__/fetch-stub.ts`. For both admission statuses 202 and 200 return the Task 1 admission fixture; call `api.finance.explainInvoice` and assert the same parsed response, same-origin credentials, encoded path, body containing only question/language, and exact `Idempotency-Key` header. Test code for the core assertion:

```ts
const body = { question: "Explain the balance", language: "en" as const };
const admission = { request: { id: USER, status: "queued", createdAt: "2026-11-14T00:00:00.000Z",
  expiresAt: "2026-11-14T01:00:00.000Z" } };
const h = clientWith((call) => call.url.startsWith("/api/v1/me")
  ? { body: me } : { status: 202, body: admission });
await expect(h.api.finance.explainInvoice({ kind: "custom", clinicId: CLINIC, memberId: USER },
  USER, body, "explanation-key-1")).resolves.toEqual(admission);
```

- [ ] Run `pnpm --filter @eyadex/web test src/shared/api/http/__tests__/invoice-explanations.test.ts`. Expected RED: new operation missing. Implement the complete adapter:

```ts
import { explanationAdmissionSchema, explanationBodySchema, explanationStatusResponseSchema }
  from "@eyadex/contracts/invoice-explanation";
import type { FinanceApi } from "../finance-client";
import type { HttpContext } from "./http-context";
export function createHttpInvoiceExplanations({ transport }: HttpContext): Pick<FinanceApi,
  "explainInvoice" | "invoiceExplanation"> {
  const id = encodeURIComponent;
  return {
    explainInvoice: (_persona, invoiceId, body, idempotencyKey) =>
      transport.send("POST", `/v1/invoices/${id(invoiceId)}/explain`, {
        body: explanationBodySchema.parse(body), idempotencyKey, schema: explanationAdmissionSchema,
      }),
    invoiceExplanation: (_persona, invoiceId, requestId) =>
      transport.send("GET", `/v1/invoices/${id(invoiceId)}/explanations/${id(requestId)}`, {
        schema: explanationStatusResponseSchema,
      }),
  };
}
```

- [ ] Compose it into `createHttpFinance`: return `{ ...createHttpFinanceSettings(ctx), ...createHttpInvoices(ctx), ...createHttpInvoiceExplanations(ctx) }`. The existing transport already `safeParse`s responses and accepts all successful HTTP statuses; do not weaken schema validation to support 202.
- [ ] Test all queued/running/succeeded/failed polling shapes, malformed/oversized/extra-property responses, and all six AI envelope codes. Each envelope must produce its own `ApiError.code`, never `unknown`; every `errors.<code>` must exist in both dictionaries after Task 17. Assert no prompt/question is ever put into a URL/query or diagnostic.
- [ ] Rerun targeted HTTP tests. Expected GREEN; failure messages contain only stable keys. No SDK dependency or AI credential in any web file.


## Task 16: Implement an ephemeral deterministic mock

**Owner: Lovable, `apps/web` only.** **Files:** `mock/mock-invoice-explanations.ts`, `mock/mock-invoice-explanation-state.ts`, `mock/mock-invoice-explanations.test.ts`, `mock/mock-finance.ts`.

- [ ] Add a mock test using `as`, `api`, `clinicIdAt`, `getState`, `resetMockData` from `mock-test-kit`. Issue a synthetic invoice using the `manual()` body pattern in `apps/web/src/invoices/invoice-patient-name-mock.test.ts`. Admit, read queued at time 0, running at 2 seconds, succeeded at 4 seconds, and assert a second live request is `ai_busy`. Run the new test; expected RED before the adapter exists.
- [ ] Create ephemeral state in a `WeakMap<MockState, ExplanationMemory>`, **never** a property of `MockState`, localStorage or sessionStorage. Replacing mock state automatically drops access to previous requests. Define:

```ts
import type { ExplanationAdmission, ExplanationBody, ExplanationError, ExplanationStatus }
  from "@eyadex/contracts/invoice-explanation";
import type { Persona } from "@eyadex/contracts/session";
import type { MockState } from "./mock-store";
export type MockExplanation = {
  clinicId: string; invoiceId: string; requestedBy: string; persona: Persona;
  question: string | null; language: ExplanationBody["language"]; admittedAt: number;
  result: ExplanationStatus; failure: ExplanationError | null;
};
export type ExplanationMemory = {
  jobs: Map<string, MockExplanation>;
  keys: Map<string, { hash: string; admission: ExplanationAdmission }>;
  windows: Map<string, { startedAt: number; count: number }>;
};
const memory = new WeakMap<MockState, ExplanationMemory>();
export function explanationMemory(db: MockState): ExplanationMemory {
  let value = memory.get(db);
  if (!value) { value = { jobs: new Map(), keys: new Map(), windows: new Map() }; memory.set(db, value); }
  return value;
}
```

- [ ] Implement `createMockInvoiceExplanations` returning the same two methods, with optional injected `now: () => number` and `failure: ExplanationError | null` for tests. Normal production preview defaults to `Date.now` and null. This injection is not a UI setting or a production API parameter.
- [ ] Admission order: `guardFinance(getState(), persona)`; reject inactive role and missing invoice view permission; validate route/body/key; load the same-clinic invoice and apply **clinic, else branch, else own** precedence; hash normalized `{invoiceId,question,language}` with Web Crypto SHA-256; re-read state/access after the async hash; advance due jobs; replay/conflict; active capacity; window counter; insert. The final capacity/rate/insert portion must be synchronous to prevent two promises from both admitting. Use this fingerprint without storing the question in the key map:

```ts
async function explanationHash(invoiceId: string, body: ExplanationBody): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([invoiceId, body.question, body.language]));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

- [ ] Key the memory ledger by `JSON.stringify([clinicId,membershipId,key])`. Replays return the first strict admission metadata even after expiry; keys store only digest and metadata. Each new request gets one-hour expiry; preserve content only in its job. Remove expired job objects on every read/admission and through an expiry timer; clear question on both success/failure. No `persist()` call in this adapter.
- [ ] Implement `advance` based on injected time, not poll count: 0–1999 ms queued, 2000–3999 ms running, 4000 ms onwards terminal. Before a due terminal transition, resolve the pinned requesting member against current state and reapply finance/view/reach. Lost access produces `ai_access_revoked`. Authorized success uses `strip(db, storedInvoice)` and the accepted question to construct a translated deterministic answer from actual figures. A simple complete formatter is:

```ts
function mockExplanationText(invoice: Invoice, body: ExplanationBody): string {
  const label = body.language === "ar"
    ? { question: "السؤال", total: "الإجمالي بوحدات العملة الصغرى", paid: "المدفوع", owed: "المتبقي", demo: "شرح تجريبي للمراجعة" }
    : { question: "Question", total: "Total in minor currency units", paid: "Paid", owed: "Owed", demo: "Sample explanation for review" };
  const items = invoice.lines.map((line) => {
    const description = body.language === "ar" ? line.descriptionAr || line.descriptionEn : line.descriptionEn || line.descriptionAr;
    return `${description}: ${line.quantity} × ${line.unitPriceMinor} = ${line.lineTotalMinor}`;
  });
  const settlement = invoice.status === "issued" && invoice.settlement
    ? [`${label.paid}: ${invoice.settlement.paidMinor}`, `${label.owed}: ${invoice.settlement.owedMinor}`] : [];
  return [label.demo, `${label.question}: ${body.question}`, ...items,
    `${label.total}: ${invoice.totalMinor} ${invoice.currency}`, ...settlement].join("\n");
}
```

- [ ] Parse generated mock text with `explanationTextSchema`; oversize/empty means `ai_generation_failed`, not truncation. Polling applies actor/clinic/module/permission/visibility first, then requester/invoice/clinic/expiry matching, then strict response parsing. Never return a `MockExplanation` object directly.
- [ ] Compose the returned methods into `createMockFinance()`. Do not route them through the existing `write()` wrapper, which persists mock state. Preserve all existing methods.
- [ ] Test all six injected errors and retry with a fresh key; replay after completion; changed-body/key conflict; concurrent admission; five completed requests then sixth rate refusal; next ten-minute window; other requester; other clinic/invoice; disabled finance; live permission/branch changes; own/branch precedence; expiry; close-without-polling still reaches completion when time advances. Assert `JSON.stringify(getState())` and browser storage contain neither synthetic question nor answer. Run `pnpm --filter @eyadex/web test src/shared/api/mock/mock-invoice-explanations.test.ts`; expected GREEN.


## Task 17: Add exact Arabic/English copy

**Owner: Lovable, `apps/web` only.** **Files:** `shared/i18n/ar-invoice-explanation.ts`, `en-invoice-explanation.ts`, `ar.ts`, `en.ts`.

- [ ] Add dictionary assertions to the HTTP adapter test: every key below resolves in both languages; all six error codes resolve to the Task 4 text. Run the test; expected RED for missing keys.
- [ ] Export `arInvoiceExplanation`/`enInvoiceExplanation`, each with an `invoiceExplanation` object, and `arInvoiceExplanationErrors`/`enInvoiceExplanationErrors` with the six Task 4 code messages. Spread the first at the dictionary root and the errors inside `errors`, following existing finance dictionary composition.

| Key under `invoiceExplanation` | Arabic | English |
| --- | --- | --- |
| `action` | شرح الفاتورة بالذكاء الاصطناعي | Explain invoice with AI |
| `title` | شرح بنود الفاتورة | Explain invoice items |
| `question` | ما الذي تريد توضيحه؟ | What would you like explained? |
| `example` | وضّح الخصم والمبلغ المتبقي بلغة بسيطة. | Explain the discount and remaining balance in simple language. |
| `guidance` | لا تُدخل أسماء أو بيانات تعريفية أو معلومات طبية. | Do not enter names, identifying details, or medical information. |
| `generate` | إنشاء الشرح | Generate explanation |
| `close` | إغلاق | Close |
| `queued` | طلب الشرح في الانتظار. | Explanation request is queued. |
| `running` | جارٍ إنشاء الشرح… | Generating explanation… |
| `review` | راجع الشرح قبل نسخه. لا يُرفق بالفاتورة ولا يُرسل تلقائيًا. | Review before copying. This is not attached to the invoice or sent automatically. |
| `copy` | نسخ الشرح | Copy explanation |
| `copied` | تم نسخ الشرح. | Explanation copied. |
| `copyFailed` | تعذّر النسخ. حاول مرة أخرى. | Copy failed. Try again. |
| `retry` | إنشاء شرح جديد | Generate a new explanation |
| `questionLength` | اكتب من 1 إلى 1000 حرف بعد إزالة المسافات الزائدة. | Enter 1 to 1000 characters after trimming. |
| `expired` | انتهت صلاحية الشرح. أنشئ طلبًا جديدًا. | This explanation expired. Create a new request. |

- [ ] Rerun dictionary assertions and `pnpm --filter @eyadex/web typecheck`. Expected GREEN. No UI text, validation text, button label, placeholder, progress text or toast bypasses i18n.


## Task 18: Implement the request/poll lifecycle outside React markup

**Owner: Lovable, `apps/web` only.** **Files:** `invoices/use-invoice-explanation.ts`, `use-invoice-explanation.test.tsx`.

- [ ] Test the hook using the existing invoice action test pattern: `vi.mock` only `useApi` and persona hooks, real QueryClient/I18nProvider. Use fake timers. Admission returns queued, first poll running, second succeeded. Verify one immediate status read then subsequent reads every 2000 ms while active; no polling after terminal state, unmount, close, or access refusal. Run `pnpm --filter @eyadex/web test src/invoices/use-invoice-explanation.test.tsx`; expected RED.
- [ ] Implement `useInvoiceExplanation(invoiceId)` inside the dialog's mounted subtree. Use `useApi`, `usePersona`, current `useI18n().lang`, a mutation with `retry:false`, `gcTime:0`, and component state for status/error. Do not put question/answer into query keys, persisted QueryClient state, router state or browser storage. Define the outward return as `{ generate, busy, request, error, reset }`, where `request` is `ExplanationStatus | null` and `error` is `WebErrorCode | null`.
- [ ] Keep a synchronous `busyRef` to suppress double clicks before React rerenders. On `generate(question)`, parse `{question,language:lang}` with the contract, clear the prior answer, create a fresh UUID idempotency key, then perform exactly one admission mutation. A new Generate/terminal retry always uses a new key; automatic network retries are disabled. The admitted request ID and expiry start the polling effect.
- [ ] Implement the effect's scheduling with recursive `setTimeout`, not `setInterval`, so a slow GET cannot overlap another GET. Increment a generation epoch in cleanup and check it after **every await**, including admission; late responses from a closed/reopened dialog cannot set state. The concrete scheduling pattern is:

```ts
useEffect(() => {
  if (!admitted) return;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      const answer = await api.finance.invoiceExplanation(persona, invoiceId, admitted.request.id);
      if (!active) return;
      setRequest(answer.request);
      if (answer.request.status === "queued" || answer.request.status === "running")
        timer = setTimeout(() => { void poll(); }, 2000);
      else busyRef.current = false;
    } catch (error) {
      if (!active) return;
      setRequest(null);
      setError(errorKeyOf(error));
      busyRef.current = false;
    }
  };
  void poll();
  return () => { active = false; if (timer) clearTimeout(timer); };
}, [api, persona, invoiceId, admitted]);
```

- [ ] Add a separate expiry timer based on admitted `expiresAt` that clears the displayed answer and stops polling at expiry, even if the dialog remains open after success. Represent local expiry with `not_found` plus the `expired` UI message; do not add an `expired` status or an unapproved AI error code. For a GET `not_found`, show the same unavailable/expired copy without asserting that an unknown job certainly existed. `reset` cancels timers, clears status/question/error/admission, increments the epoch, and resets the mutation. Unmount clears mutation cache content through `gcTime:0`; component state then disappears.
- [ ] Clear display/polling when the live session no longer has invoice-view access or finance enabled, and on persona/clinic/invoice changes; key the dialog subtree by actor+invoice. Do not fall back to a cached success after a 401/403/404. A later manual retry still lets the API make the current-access decision.
- [ ] Test 200 replay metadata, all six failed job codes, transport refusals, local expiry, same-question fresh retry key, rapid double click, language captured at submission, persona change, close while POST is pending, close while GET is pending, and reopen showing an empty form. No test calls a real gateway. Rerun targeted hook tests; expected GREEN.


## Task 19: Add the invoice action, dialog, and copy interaction

**Owner: Lovable, `apps/web` only.** **Files:** `invoice-explanation-action.tsx`, `invoice-explanation-dialog.tsx`, `invoice-page.tsx`, `invoice-explanation-dialog.test.tsx`.

- [ ] Add a UI test rendering the new action in QueryClient/I18n providers with mocked `ApiClient.finance` and a visible authorized invoice. Assert Generate is disabled for an empty/whitespace question, typing a valid question enables it, and a success renders plain text. Use the test harness pattern in `invoice-pdf-action.test.tsx`; run the targeted dialog test for RED.
- [ ] Implement `InvoiceExplanationAction({invoiceId})` with an outline small shadcn Button and controlled Dialog. Render `InvoiceExplanationDialog` **only while open**; closing unmounts it and opening creates fresh state. The action belongs beside `InvoicePdfAction` in `InvoicePage` after invoice GET succeeded. Do not restrict it to issued invoices, update permission, or a role name: the spec grants it to everyone who can view that invoice, including a visible void invoice.

```tsx
const [open, setOpen] = useState(false);
return <Dialog open={open} onOpenChange={setOpen}>
  <DialogTrigger asChild><Button variant="outline" size="sm">
    {t("invoiceExplanation.action")}
  </Button></DialogTrigger>
  {open && <InvoiceExplanationDialog invoiceId={invoiceId} onClose={() => setOpen(false)} />}
</Dialog>;
```

- [ ] Implement the dialog with `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, labelled `Textarea`, and react-hook-form using the question field from `explanationBodySchema`. Map all form errors to `invoiceExplanation.questionLength`. Call only `useInvoiceExplanation`; no adapter imports or finance arithmetic in the component. Keep logical classes (`text-start`, `ms-*`, `pe-*`), at most 8px radius, thin borders, flat surfaces, and existing semantic color tokens.
- [ ] Show queued/running progress with `role="status"` and `aria-live="polite"`; disable Generate while busy but keep Close available. Failed jobs and transport errors use `role="alert"` and `tDynamic("errors." + code)`; local/not-found expiry uses the dedicated translation. Retry clears the old request and allows a new question/key. Render the answer as:

```tsx
{request?.status === "succeeded" && <>
  <p className="text-sm text-muted-foreground">{t("invoiceExplanation.review")}</p>
  <div className="whitespace-pre-wrap break-words rounded-md border p-3 text-start text-sm">
    {request.explanation}
  </div>
  <Button type="button" variant="outline" onClick={() => { void copy(request.explanation); }}>
    {t("invoiceExplanation.copy")}
  </Button>
</>}
```

- [ ] Implement `copy(text)` with `navigator.clipboard.writeText(text)`, catching denial/unavailable clipboard. Toast only `t("invoiceExplanation.copied")` or `t("invoiceExplanation.copyFailed")`; never toast/log the text or question. Render HTML-like output literally; do not use Markdown, links or `dangerouslySetInnerHTML`.

```ts
async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("invoiceExplanation.copied"));
  } catch {
    toast.error(t("invoiceExplanation.copyFailed"));
  }
}
```
- [ ] Add Arabic RTL/English LTR label and 1000/1001-character validation tests; run the targeted dialog test for GREEN.
- [ ] Add queued/running progress and duplicate-submit-disable tests; run the targeted dialog test for GREEN.
- [ ] Add the six error-code cases using the Task 4 table and a fresh-key retry assertion; run the targeted dialog test for GREEN.
- [ ] Add success-with-line-breaks and literal `<script>`/URL text cases; assert no script/link elements are created; run the targeted dialog test for GREEN.
- [ ] Add clipboard success/denial cases; assert translated feedback contains no question/answer; run the targeted dialog test for GREEN.
- [ ] Add Escape/Close, focus-return, close/reopen-empty and language-change cases; run the targeted dialog test for GREEN.
- [ ] Add permission-loss and invoice-change cases. Assert existing invoice/payments/notification objects are unchanged and `finance.send` is never called; run the targeted dialog test for GREEN.
- [ ] Run `pnpm --filter @eyadex/web test src/invoices/invoice-explanation-dialog.test.tsx src/invoices/use-invoice-explanation.test.tsx src/shared/area-boundaries.test.ts`, then web typecheck/lint. Expected GREEN, zero new cross-area imports and no new routes. Lovable hands its web-only patch to the orchestrator; no SQL/API/worker/config/lockfile edits from Lovable.
