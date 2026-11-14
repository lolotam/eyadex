# Payments and Refunds List Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print every authorized result matching the active receipts or refunds tab's filters, with localized metadata and no forms, navigation or actions.

**Architecture:** Rework Lovable checkpoint `90683a1e269296e50a1f559ae91650b941c28a2c`; replace its immediate, visible-page print with a cancellable, sequential cursor collection through the existing `ApiClient`. Keep the interactive list and its TanStack Query cache separate from a transient print document, rendered through a body-level React portal only after collection succeeds. Keep all payment logic and scoped print CSS in `apps/web/src/payments`; reuse the report print opt-in idea without importing another business area or changing global print rules.

**Tech Stack:** TypeScript, React 19, TanStack Start/Query, existing Zod finance contracts, shadcn/ui, lucide-react, local CSS print media, Vitest and React Testing Library; pnpm 12.5.1 and Node 24 or newer.

---

## Ownership, baseline and file map

Approved spec: `docs/superpowers/specs/2026-11-14-payments-print-design.md`. Planning checkout: `C:/Users/waleed_Mohamed/.t3/worktrees/eyadex/payments-print`, clean at `b86c4ef1049d9bb016d724df1a6924f8c1a94893` before this document. Only this plan is created during planning; no implementation, dependency installation, commits, pushes or deployment occur in this phase. The required sub-skill header is execution guidance, not authorization to dispatch agents now. Lovable implements the web changes; the orchestrator reviews, fixes findings and lands them through the existing delivery loop.

Read `AGENTS.md`, `CLAUDE.md`, `CLAUDE.architecture.md`, `apps/web/AGENTS.md`, `.lovable/review-lessons.md` and the approved spec before implementation. Existing reference paths: `apps/web/src/payments/receipt-queries.ts`, `apps/web/src/payments/use-receipt-columns.tsx`, `apps/web/src/payments/use-refund-columns.tsx`, `apps/web/src/shared/api/payments-client.ts`, `packages/contracts/src/finance-payments.ts`, `packages/contracts/src/finance-refunds.ts`, `apps/web/src/report-exports/screens/report-print.css`, and `apps/web/src/styles.css:156`.

| Files | Responsibility / disposition |
| --- | --- |
| `apps/web/src/payments/collect-payment-print-pages.ts`, `apps/web/src/payments/collect-payment-print-pages.test.ts` | New cursor collector and deterministic collection tests. |
| `apps/web/src/payments/payment-calendar-date.ts`, `apps/web/src/payments/payment-calendar-date.test.ts` | New timezone-independent formatter for date-only business dates and date filters. |
| `apps/web/src/payments/use-payment-list-print.ts`, `apps/web/src/payments/use-payment-list-print.test.tsx` | New transient operation, synchronous duplicate lock, committed invalidation and post-render print request. |
| `apps/web/src/payments/payment-print-summary.tsx` | Rework checkpoint summary; localized timestamp, remove `visibleOnly`. Absent on baseline; preserve this checkpoint filename. |
| `apps/web/src/payments/payment-print-document.tsx`, `apps/web/src/payments/payment-print-document.test.tsx` | New portal, plain business table and DOM/locale tests. |
| `apps/web/src/payments/payments-print.css` | Replace checkpoint CSS with document-only opt-in and paged layout; absent on baseline. |
| `apps/web/src/payments/receipts-content.tsx`, `apps/web/src/payments/refunds-content.tsx` | Wire one print operation to each list's filters and existing API; preserve visible pagination. |
| `apps/web/src/payments/receipts-content.test.tsx`, `apps/web/src/payments/refunds-content.test.tsx`, `apps/web/src/payments/payments-content.test.tsx` | Rework checkpoint tests; integration coverage for complete pages, filters and actual tab unmount. Last file is absent on baseline. |
| `apps/web/src/payments/payments-content.tsx` | Remove checkpoint page-wide print marker/direct print button; retain conditional tab mounting. |
| `apps/web/src/shared/i18n/ar-payments.ts`, `apps/web/src/shared/i18n/en-payments.ts` | Matching print keys; remove rejected visible-page wording. |

No contract, API, adapter, database, permission, audit, lockfile, global CSS, invoice-print or report-print changes are needed. Keep each implementation/test file at most 300 lines and one React component per file. Do not duplicate checkpoint components under alternate names. Existing checkpoint edits to the screen column hooks are harmless but insufficient: print uses a separate plain table, including full patient names and refund reasons.

## Task 1: Reconcile the checkpoint and pin the red regression

**Owner:** Lovable, with the orchestrator supplying the checkpoint diff. **Files:** modify `apps/web/src/payments/receipts-content.test.tsx`; read the checkpoint files in the map.

- [ ] **Inspect before editing.** Run `git rev-parse HEAD`, `git status --short`, and `git show 90683a1e -- apps/web/src/payments apps/web/src/shared/i18n/ar-payments.ts apps/web/src/shared/i18n/en-payments.ts`. Expected planning baseline is the SHA above; checkpoint shows `onClick={() => window.print()}`, a page-wide `data-payments-print`, and `payments.print.visibleOnly`. On Lovable, work forward from its current checkpoint-containing branch; do not reset, revert the checkpoint, cherry-pick it twice, or rewrite published history.
- [ ] **Add a failing receipt regression using the existing `rows`, `h`, and `show` fixtures.** Extend `h` with `listPayments: vi.fn()` and mock `useApi` to return `{ payments: { listPayments: h.listPayments } }`; extend the existing persona mock with `usePersona: () => ({ persona: { kind: "custom", clinicId: "00000000-0000-7000-8000-000000000001", memberId: null }, ready: true })`. Add `QueryClientProvider` around `show()` with a fresh `new QueryClient({ defaultOptions: { mutations: { retry: false } } })`; import it and `QueryClient` from `@tanstack/react-query`. Use `waitFor` from Testing Library. Supply `h.session.clinic = { timezone: "Asia/Kuwait" }` in this test's hoisted fixture type and reset; production continues using the real session contract.

```tsx
it("prints every matching receipt, including rows outside the visible page", async () => {
  const all = Array.from({ length: 41 }, (_, i) => ({ ...rows[0]!, id: `print-${i}`, receiptNumber: `PRINT-${i}` }));
  h.listPayments.mockResolvedValueOnce({ items: all.slice(0, 20), nextCursor: "c20", total: 41 })
    .mockResolvedValueOnce({ items: all.slice(20, 40), nextCursor: "c40", total: 41 })
    .mockResolvedValueOnce({ items: all.slice(40), nextCursor: null, total: 41 });
  const print = vi.spyOn(window, "print").mockImplementation(() => {
    expect(document.querySelectorAll("[data-payments-print] tbody tr")).toHaveLength(41);
    expect(document.querySelector("[data-payments-print]")?.textContent).toContain("PRINT-40");
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "طباعة القائمة" }));
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  expect(h.listPayments.mock.calls.map((call) => call[1].cursor)).toEqual([undefined, "c20", "c40"]);
});
```

- [ ] **Run red:** `pnpm --filter @eyadex/web test src/payments/receipts-content.test.tsx`. Expected baseline failure: no Print action; checkpoint failure: no complete collection/41-row document. A missing provider or unrelated fixture failure is not the desired red; fix the harness first. Reset `listPayments`, restore spies, clear localStorage and clean up after each test.
- [ ] **Record the acceptance target:** run the same command after Tasks 2–6; expected all receipt tests pass and the displayed list remains on its original 20-row cursor page. Keep this regression red while implementing the collector first; do not weaken it to 20 rows or make the print spy count cached screen rows.

## Task 2: Collect every cursor page, with no partial success

**Files:** create `apps/web/src/payments/collect-payment-print-pages.ts` and `apps/web/src/payments/collect-payment-print-pages.test.ts`.

- [ ] **Write the failing tests.** Import `describe, expect, it, vi` from `vitest` and `collectPaymentPrintPages` from `./collect-payment-print-pages`. The small numeric fixture deliberately tests traversal independently of payment formatting.

```ts
it("follows cursors even when total or an intermediate page is empty", async () => {
  const read = vi.fn().mockResolvedValueOnce({ items: [1], nextCursor: "a", total: 0 })
    .mockResolvedValueOnce({ items: [], nextCursor: "b", total: 0 })
    .mockResolvedValueOnce({ items: [2], nextCursor: null, total: 0 });
  expect(await collectPaymentPrintPages(read, () => true)).toEqual([1, 2]);
  expect(read.mock.calls).toEqual([[undefined], ["a"], ["b"]]);
});
it("rejects a later-page failure and restarts without a cursor on retry", async () => {
  const failure = new Error("network");
  const read = vi.fn().mockResolvedValueOnce({ items: [1], nextCursor: "a" }).mockRejectedValueOnce(failure);
  await expect(collectPaymentPrintPages(read, () => true)).rejects.toBe(failure);
  read.mockResolvedValueOnce({ items: [3], nextCursor: null });
  expect(await collectPaymentPrintPages(read, () => true)).toEqual([3]);
  expect(read.mock.calls.at(-1)).toEqual([undefined]);
});
```

- [ ] **Run red:** `pnpm --filter @eyadex/web test src/payments/collect-payment-print-pages.test.ts`; expected missing collector import.
- [ ] **Implement the collector.** The page reader closes over a snapshot of filters/persona; the collector owns only the cursor. It ignores `total` as a termination condition, has no row cap and never publishes partial rows. There is no `AbortSignal` parameter on the existing payments methods: invalidation discards the response and stops subsequent requests, rather than pretending transport cancellation exists.

```ts
export type PrintPage<T> = { items: T[]; nextCursor: string | null };
export type PrintPageReader<T> = (cursor: string | undefined) => Promise<PrintPage<T>>;
export async function collectPaymentPrintPages<T>(read: PrintPageReader<T>, current: () => boolean): Promise<T[] | null> {
  const rows: T[] = []; const seen = new Set<string>(); let cursor: string | undefined;
  do {
    if (!current()) return null;
    const page = await read(cursor);
    if (!current()) return null;
    rows.push(...page.items);
    if (page.nextCursor === null) return rows;
    if (seen.has(page.nextCursor)) throw new Error("Repeated payment print cursor");
    seen.add(page.nextCursor); cursor = page.nextCursor;
  } while (current());
  return null;
}
```

- [ ] **Add focused cancellation/empty/loop assertions:** `expect(await collectPaymentPrintPages(vi.fn(), () => false)).toBeNull()`; an empty terminal page resolves `[]`; a deferred page resolved after `current` becomes false resolves `null` and never reads another page; repeated cursor rejects with `Repeated payment print cursor`. Run the Task 2 command; expected all green. Preserve API row order; do not deduplicate, synthesize totals, fetch invoice details or log row contents.

## Task 3: Own the print operation and invalidate stale work

**Files:** create `apps/web/src/payments/use-payment-list-print.ts` and `apps/web/src/payments/use-payment-list-print.test.tsx`.

- [ ] **Write a failing hook test with a fresh QueryClient provider.** Import React's `ReactNode`, Testing Library's `act, renderHook, waitFor`, Vitest's `it, expect, vi`, TanStack Query's `QueryClient, QueryClientProvider`, and the hook. Define the provider in this test file (one component). Test a single page before testing the UI.

```tsx
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
it("discards an old filter run, even if its final response arrives later", async () => {
  let finish!: (page: { items: number[]; nextCursor: null }) => void;
  const read = vi.fn(() => new Promise<{ items: number[]; nextCursor: null }>((resolve) => { finish = resolve; }));
  const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
  const hook = renderHook(({ key }) => usePaymentListPrint(key, read, true), { initialProps: { key: "receipts:A" }, wrapper: Wrapper });
  act(() => { void hook.result.current.prepare(); });
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  hook.rerender({ key: "receipts:B" });
  await act(async () => { finish({ items: [1], nextCursor: null }); });
  expect(hook.result.current.document).toBeNull(); expect(print).not.toHaveBeenCalled();
});
```

- [ ] **Run red:** `pnpm --filter @eyadex/web test src/payments/use-payment-list-print.test.tsx`; expected missing hook import. Add `afterEach` cleanup/spy restoration; use a controllable `requestAnimationFrame` stub for tests that need to stop between DOM commit and printing.
- [ ] **Implement this hook.** The effect runs after the caller's document has committed; the animation-frame callback checks freshness again. The mutation receives the captured reader as a variable, preventing later renders from changing an in-flight request's filters. Print rows are transient local state; clear mutation data after settling, with no persistent storage or audit event.

```ts
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { collectPaymentPrintPages, type PrintPageReader } from "./collect-payment-print-pages";
export function usePaymentListPrint<T>(key: string, read: PrintPageReader<T>, enabled: boolean) {
  const epoch = useRef(0); const locked = useRef(false); const printed = useRef(-1);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const [empty, setEmpty] = useState(false);
  const [document, setDocument] = useState<{ token: number; rows: T[]; printedAt: string } | null>(null);
  const { mutateAsync, reset } = useMutation({
    mutationFn: ({ reader, current }: { reader: PrintPageReader<T>; current: () => boolean }) => collectPaymentPrintPages(reader, current),
    retry: false, gcTime: 0,
  });
  const invalidate = () => {
    epoch.current++; locked.current = false;
    setBusy(false); setError(null); setEmpty(false); setDocument(null); reset();
  };
  useLayoutEffect(() => {
    epoch.current++; locked.current = false;
    setBusy(false); setError(null); setEmpty(false); setDocument(null); reset();
    return () => { epoch.current++; locked.current = false; };
  }, [key, enabled, reset]);
  const prepare = async () => {
    if (!enabled || locked.current) return;
    locked.current = true; const token = ++epoch.current;
    const current = () => epoch.current === token;
    setBusy(true); setError(null); setEmpty(false); setDocument(null);
    try {
      const rows = await mutateAsync({ reader: read, current });
      if (!current() || rows === null) return;
      if (rows.length === 0) { setEmpty(true); locked.current = false; setBusy(false); }
      else setDocument({ token, rows, printedAt: new Date().toISOString() });
    } catch (failure) {
      if (current()) { setError(failure); locked.current = false; setBusy(false); }
    } finally { if (current()) reset(); }
  };
  useEffect(() => {
    if (!document) return;
    const token = document.token;
    const frame = requestAnimationFrame(() => {
      if (epoch.current !== token || printed.current === token) return;
      printed.current = token;
      try { window.print(); } catch (failure) { if (epoch.current === token) { setError(failure); setDocument(null); } }
      finally {
        if (epoch.current === token) { locked.current = false; setBusy(false); }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [document]);
  useEffect(() => {
    const done = () => setDocument(null);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);
  return { prepare, invalidate, busy, error, empty, document };
}
```

- [ ] **Prove lifecycle boundaries before integrating:** add tests calling `prepare()` twice inside one `act` (one reader run); empty results (no print); rejected page (error, unlocked); retry (fresh first page); invalidation after rows are collected but before the queued frame (no print); unmount and tab-away/back ABA (old response ignored); and StrictMode (one print). For cancel, dispatch `window.dispatchEvent(new Event("afterprint"))` and assert `document === null`, `busy === false`, and a new click works. Assert old failures cannot overwrite a newer successful run. Run the Task 3 command; expected green. Keep completed rows until `afterprint`, next prepare, invalidation or unmount; clearing them immediately when `window.print()` returns can blank nonblocking print previews.

## Task 4: Replace the visible-page summary and render a plain document

**Files:** rework/create `apps/web/src/payments/payment-print-summary.tsx`; create `apps/web/src/payments/payment-print-document.tsx` and `apps/web/src/payments/payment-print-document.test.tsx`; modify `apps/web/src/shared/i18n/ar-payments.ts` and `apps/web/src/shared/i18n/en-payments.ts`.

- [ ] **Pin calendar dates before writing the document.** Create `payment-calendar-date.test.ts` with `expect(formatPaymentCalendarDate("2026-11-01", "en")).toBe("1 Nov 2026")` and the Arabic equivalent, and run it with `TZ=America/New_York` as well as the default environment. Create `payment-calendar-date.ts` with `export function formatPaymentCalendarDate(value: string, lang: "ar" | "en"): string { const parsed = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(parsed.getTime())) throw new RangeError("Invalid payment calendar date"); return new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(parsed); }`. The explicit UTC zone prevents a date-only business day from shifting in a browser west of UTC. Run `pnpm --filter @eyadex/web test src/payments/payment-calendar-date.test.ts`; expected green on both runs.

- [ ] **Write a failing document test.** In `payment-print-document.test.tsx`, import `render, cleanup` from Testing Library, `afterEach, expect, it` from Vitest, `I18nProvider`, and `PaymentPrintDocument`. Use a complete synthetic receipt fixture copied from the existing `base`/`rows[0]` in `receipts-content.test.tsx`, and a complete synthetic refund from `refunds-content.test.tsx`; define them locally as `Payment` and `Refund` imported from contracts. No actual patient data. Assert the refund's entire long reason, invoice number and amount are present as text, and no navigation/control nodes exist:

```tsx
render(<I18nProvider manageDocument={false}><PaymentPrintDocument view="refunds" rows={[refund]} branches={[]} filters={[]} printedAt="2026-11-14T09:00:00.000Z" zone="Asia/Kuwait" /></I18nProvider>);
const root = document.querySelector("[data-payments-print]")!;
expect(root.parentElement).toBe(document.body);
expect(root.textContent).toContain(refund.reason);
expect(root.textContent).toContain("0.500 KWD");
expect(root.querySelector("a,button,form,input,select,textarea,details,[role=dialog],[role=checkbox]")).toBeNull();
```

- [ ] **Run red:** `pnpm --filter @eyadex/web test src/payments/payment-print-document.test.tsx`; expected missing component. Test both `ar` and `en` by setting `eyadex:language` before mounting `I18nProvider` and awaiting its effect; clean storage afterward. Freeze `printedAt` as shown instead of snapshotting the machine clock.
- [ ] **Replace the checkpoint's `payments.print` objects with these exact strings.** Keep the existing tab/column/empty/error keys; use `tDynamic('errors.' + errorKeyOf(error))` for failures, not raw exception messages.

```ts
// en-payments.ts, inside payments
print: { action: "Print list", summary: "Print summary", allResults: "All results matching the applied filters.", filters: "Applied filters", noFilters: "No filters applied", preparing: "Preparing list…", failed: "Could not prepare the list", empty: "No results to print", printedAt: "Printed at" },
// ar-payments.ts, inside payments
print: { action: "طباعة القائمة", summary: "ملخص الطباعة", allResults: "كل النتائج المطابقة للفلاتر المطبّقة.", filters: "الفلاتر المطبّقة", noFilters: "لا توجد فلاتر مطبّقة", preparing: "جارٍ تجهيز القائمة…", failed: "تعذر تجهيز القائمة", empty: "لا توجد نتائج للطباعة", printedAt: "وقت الطباعة" },
```

- [ ] **Rework `PaymentPrintSummary` in place.** Export `PrintFilter = { label: string; value: string }`. Keep its existing title, filter heading and `<dl>` mapping, but remove `hidden print:block` from its section (the document root handles visibility), replace `visibleOnly` with `allResults`, and add `printedAt: string` and `zone: string` props. With `lang` from `useI18n`, compute `const timestamp = new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(printedAt));` and render `<p>{t("payments.print.printedAt")}: <time dateTime={printedAt}>{timestamp}</time></p>`. Reuse the checkpoint filter mapping, not a second summary component.
- [ ] **Implement the complete document below.** Use existing `formatDate` and `formatMinor` conventions; the plain cells intentionally omit links, disclosure controls and screen truncation. Import CSS here so direct list mounts also have it. Do not import `ReportTable` or report hooks across the area boundary.

```tsx
import { createPortal } from "react-dom";
import type { Payment, Refund } from "@eyadex/contracts/finance";
import type { BranchOption } from "@eyadex/contracts/users";
import { formatMinor } from "@eyadex/contracts/money";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { branchNameIn } from "./receipt-queries";
import { formatPaymentCalendarDate } from "./payment-calendar-date";
import { PaymentPrintSummary, type PrintFilter } from "./payment-print-summary";
import "./payments-print.css";
type Props = { branches: readonly BranchOption[] | undefined; filters: PrintFilter[]; printedAt: string; zone: string } & ({ view: "receipts"; rows: Payment[] } | { view: "refunds"; rows: Refund[] });
export function PaymentPrintDocument(props: Props) {
  const { t, pick, lang, dir } = useI18n();
  if (typeof document === "undefined") return null;
  const title = t(`payments.views.${props.view}`);
  const headers = [props.view === "receipts" ? t("payments.receipts.number") : t("payments.refunds.number"), t("payments.receipts.date"), t("payments.receipts.patient"), t("payments.receipts.branch"), t("payments.receipts.invoice"), t("payments.receipts.method"), t("payments.receipts.amount"), ...(props.view === "refunds" ? [t("payments.refunds.reason")] : [])];
  return createPortal(<section data-payments-print lang={lang} dir={dir}>
    <PaymentPrintSummary title={title} filters={props.filters} printedAt={props.printedAt} zone={props.zone} />
    <table><caption>{title}</caption><thead><tr>{headers.map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{props.rows.map((row) => <tr key={row.id}>
        <td dir="ltr">{"receiptNumber" in row ? row.receiptNumber : row.refundNumber}</td>
        <td>{formatPaymentCalendarDate(row.businessDate, lang)}</td><td>{row.patientName}</td>
        <td>{branchNameIn(props.branches, row.branchId, pick)}</td><td dir="ltr">{row.invoiceNumber}</td>
        <td>{t(`payments.method.${row.method}`)}</td><td dir="ltr" className="text-end tabular-nums">{`${formatMinor(row.amountMinor, row.currencyExponent)} ${row.currency}`}</td>
        {"reason" in row ? <td>{row.reason}</td> : null}
      </tr>)}</tbody></table>
  </section>, document.body);
}
```

- [ ] **Run green:** `pnpm --filter @eyadex/web test src/payments/payment-print-document.test.tsx` and `pnpm --filter @eyadex/web typecheck`. Expected both pass; one body-level document, correct title/direction/date/time/filters in both languages, seven receipt columns or eight refund columns, no patient IDs beyond React keys and no controls. Verify missing branch names use existing `—` fallback and do not trigger unauthorized branch reads.

## Task 5: Isolate print layout from the shell and every form

**Files:** rework/create `apps/web/src/payments/payments-print.css`; extend `apps/web/src/payments/payment-print-document.test.tsx`.

- [ ] **Add a failing structural test:** render a normal screen sibling with a form, navigation and button, plus the document portal; assert the only body child with `data-payments-print` is the document and `root.querySelector('form,nav,button,[role="dialog"],header,aside') === null`. A real print-media browser check in Task 8, not jsdom, proves computed CSS and pagination.
- [ ] **Replace the checkpoint stylesheet with this local opt-in.** The body-child selector also removes Radix portals and toasts from print layout; it is inactive everywhere else. Normal flow avoids clipping long tables or reserving blank pages for an invisible app shell.

```css
[data-payments-print] { display: none; }
@media print {
  body:has(> [data-payments-print]) > :not([data-payments-print]) { display: none !important; }
  body:has(> [data-payments-print]) { overflow: visible !important; height: auto !important; }
  body > [data-payments-print] { display: block !important; position: static; width: 100%; max-width: none; margin: 0; color: #000; background: #fff; }
  [data-payments-print], [data-payments-print] * { visibility: visible; }
  [data-payments-print] table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
  [data-payments-print] th, [data-payments-print] td { border: 1px solid #ccc; padding: 4px; text-align: start; vertical-align: top; overflow-wrap: anywhere; white-space: pre-wrap; }
  [data-payments-print] .text-end { text-align: end; }
  [data-payments-print] thead { display: table-header-group; }
  [data-payments-print] tr { break-inside: avoid; page-break-inside: avoid; }
  [data-payments-print] form, [data-payments-print] button, [data-payments-print] input, [data-payments-print] select, [data-payments-print] textarea, [data-payments-print] nav, [data-payments-print] [role="dialog"], [data-payments-print] [role="checkbox"] { display: none !important; }
}
```

- [ ] **Run:** `pnpm --filter @eyadex/web test src/payments/payment-print-document.test.tsx`. Expected DOM assertions pass. In review, `git diff -- apps/web/src/styles.css apps/web/src/report-exports/screens/report-print.css` must be empty. No CSS `left/right`, globally applied `@page`, absolute table positioning or outer page-wide print marker.

## Task 6: Bind the active filters and show preparation/error/empty states

**Files:** modify `apps/web/src/payments/receipts-content.tsx`, `apps/web/src/payments/refunds-content.tsx`, `apps/web/src/payments/payments-content.tsx`, and the corresponding three `*.test.tsx` files in the map.

- [ ] **Write red filter assertions before wiring.** Extend the Task 1 receipt harness with a pending first page, change `from` using the existing input, then resolve it; expect no `window.print`. Start again and assert every call carries the new date. In the refund harness add `listRefunds`, the same API/persona/QueryClient seams, and its own 41-row fixture built from existing `row`; assert all three cursors and no call contains `receiptNumber`. Run `pnpm --filter @eyadex/web test src/payments/receipts-content.test.tsx src/payments/refunds-content.test.tsx`; expected failures for missing all-page/filter behavior.
- [ ] **Extract the existing list query's filter object, excluding `limit` and `cursor`, and use it for both paths.** In receipts use the following code with `Payment`/`PaymentListQuery` imports, `useApi`, `usePersona`, `usePaymentListPrint`, and `PaymentPrintDocument`. In refunds type `filters` as `Omit<RefundListQuery, "cursor" | "limit">`, omit `receiptNumber`, instantiate `usePaymentListPrint<Refund>`, and call `api.payments.listRefunds(persona, { ...filters, limit: 100, ...(cursor ? { cursor } : {}) })`. The larger valid print page size is an optimization, not a row limit; APIs may still return 20-row pages. Keep screen queries at `PAGE_SIZE = 20`.

```tsx
const filters: Omit<PaymentListQuery, "cursor" | "limit"> = {
  ...(branchId ? { branchId } : {}), ...(method ? { method: paymentMethodSchema.parse(method) } : {}),
  ...(seesPatients && patient ? { patientId: patient.id } : {}), ...(from ? { from } : {}),
  ...(to ? { to } : {}), ...(searched ? { receiptNumber: searched } : {}),
};
const api = useApi(); const { persona, ready } = usePersona();
const { lang } = useI18n();
const identity = JSON.stringify(["receipts", persona, session?.membershipId, session?.permissions, session?.branchIds, session?.allBranches, session?.blocked, session?.features, session?.clinic, filters, number, lang]);
const printing = usePaymentListPrint<Payment>(identity,
  (cursor) => api.payments.listPayments(persona, { ...filters, limit: 100, ...(cursor ? { cursor } : {}) }),
  ready && Boolean(persona.clinicId) && Boolean(session?.clinic) && can(session?.permissions ?? [], "view", "payments") && !session?.blocked && !searchPending);
const list = useReceiptList({ ...filters, limit: PAGE_SIZE, ...(!searchChanged && pages.cursor ? { cursor: pages.cursor } : {}) });
```

- [ ] **Invalidate synchronously on edits and keep the print identity independent of screen pagination.** In both existing `filtered` handlers insert `printing.invalidate()` before `apply(); pages.reset();`. For the receipt number use `onChange={(e) => { printing.invalidate(); setNumber(e.target.value); }}`; disable Print while `searchPending` so the new raw number cannot print with the old 300ms-debounced search. Refund identity uses `"refunds"` and omits `number`. Permission loss removes the patient filter from requests and summary immediately, as existing code already does; the identity invalidates its earlier document. Retain `view === "receipts" ? <ReceiptsContent /> : <RefundsContent />` so inactive lists unmount; remove the checkpoint's parent direct-print action and parent `data-payments-print` marker.
- [ ] **Reuse the checkpoint's `printFilters` construction**, using `branchNameIn`, translated payment method, permitted `patient.label`, `formatPaymentCalendarDate(from, lang)`/`formatPaymentCalendarDate(to, lang)`, and `searched` for receipts only. Import the UTC calendar-date helper from `payment-calendar-date.ts` and `lang` from the existing `useI18n()` return; do not pass date-only values through the browser-timezone `formatDate`. Add this list-local control/document block; import `Printer` from lucide and `Button`/`errorKeyOf` through their existing paths. The on-screen list and pager stay mounted and usable; no print fetching populates their query cache.

```tsx
<div className="mb-4 flex flex-wrap items-center gap-2 print:hidden" aria-busy={printing.busy}>
  <Button variant="outline" disabled={printing.busy || searchPending} onClick={() => void printing.prepare()}><Printer className="size-4" aria-hidden />{t(printing.busy ? "payments.print.preparing" : "payments.print.action")}</Button>
  {printing.busy ? <p role="status">{t("payments.print.preparing")}</p> : null}
  {printing.empty ? <p role="status">{t("payments.print.empty")}</p> : null}
  {printing.error ? <div role="alert"><p>{t("payments.print.failed")}</p><p>{tDynamic(`errors.${errorKeyOf(printing.error)}`)}</p><Button disabled={printing.busy || searchPending} onClick={() => void printing.prepare()}>{t("common.tryAgain")}</Button></div> : null}
</div>
{printing.document && session?.clinic ? <PaymentPrintDocument view="receipts" rows={printing.document.rows} branches={branches.data} filters={printFilters} printedAt={printing.document.printedAt} zone={session.clinic.timezone} /> : null}
```

- [ ] **Apply the refund block with `view="refunds"` and no `searchPending` term**; both Print buttons also disable when the hook's authorization/readiness predicate is false (extract that predicate as `printEnabled` and use `!printEnabled` in `disabled`). For `payments-content.test.tsx`, replace checkpoint's immediate-print test with real lists and mocked authorized list API methods; switch tabs with the existing Radix `mouseDown` pattern while a receipt page is deferred. Resolve it after entering refunds: zero receipt print calls, only the refund document on the next print. Switching back creates a fresh run. Run the Task 6 tests plus `pnpm --filter @eyadex/web test src/payments/payments-content.test.tsx`; expected green, including Task 1's complete 41-row regression.

## Task 7: Close the behavioral regression matrix

**Files:** extend `apps/web/src/payments/receipts-content.test.tsx`, `apps/web/src/payments/refunds-content.test.tsx`, `apps/web/src/payments/payments-content.test.tsx`, `apps/web/src/payments/use-payment-list-print.test.tsx`, and `apps/web/src/payments/payment-print-document.test.tsx`. Split by the already mapped responsibilities to stay within 300 lines per code file; move the complete collection/filter assertions into the hook/document suites where they belong rather than truncating coverage.

- [ ] **Add a later-page error/retry test for each list.** Use a first page with rows and a cursor, then `mockRejectedValueOnce(new ApiError("forbidden"))`; import `ApiError` from `@/shared/api/api-error`. Assert a translated alert, no document and no print; click `common.tryAgain`, serve every page afresh and assert one print containing only the retry rows. Assert the retry's first query has no cursor. Do not auto-retry the failed page or print partial data.
- [ ] **Test every invalidation input separately:** branch, method, patient, from, to, receipt number before debounce settles, tab change, language change, persona/clinic change and loss of `view:patients`/`view:payments`. Assert no stale dialog and a fresh next run. For a completed document invalidate before its queued frame; after print returns but before `afterprint`, edit filters and assert the portal disappears. Test screen cursor navigation does not change the filter snapshot or start collection at the visible cursor.
- [ ] **Test payload parity and permission omissions.** With patient permission, all print pages have identical branch/method/patient/date/receipt-number filters except `cursor`; without it, neither patient filter metadata nor `patientId` is sent. Refunds never send `receiptNumber`. Row patient names already returned by authorized payments remain printable even when patient-file lookup permission is absent. No new permission is invented.
- [ ] **Test empty/loading/double-click/cancel and display parity.** Empty terminal collection shows `payments.print.empty`, retains the interactive state and opens no print dialog. During loading Print is disabled and announces preparation; filters and screen pager still work. Compare all print cells to the list's existing localized business values, with full refund reasons and own-currency `formatMinor` values. Run the calendar-date test under `TZ=America/New_York` and assert a `2026-11-01` business date/filter still prints 1 November, not 31 October. Verify both locale dictionaries lack `visibleOnly`.
- [ ] **Run:** `pnpm --filter @eyadex/web test src/payments src/shared/area-boundaries.test.ts src/shared/api/http/__tests__/payment-routes.test.ts src/shared/api/http/__tests__/refund-routes.test.ts`. Expected green, including existing payment/refund mock permission and reach tests; no business-area import violations. These are final acceptance tests, not a claim of backend snapshot isolation: rows come from successive authorized list requests, as approved, with no new bulk endpoint.

## Task 8: Browser print acceptance and final local gates

**Owner:** orchestrator reviews Lovable's exact candidate. **Files:** no new implementation files; review all paths above. Record evidence with the handoff/PR, not real patient data or secrets.

- [ ] **Run local screen checks with the mock adapter:** `pnpm --filter @eyadex/web dev --host 127.0.0.1 --port 5173`. Expected dev server ready; use `/clinic/payments`. Use the supported shared browser tools for checks, both Arabic/English at 1440px/390px. Verify clinic admin, branch-scoped payment viewer, payment viewer without patient lookup and a role without payment view; verify the platform cannot reach this screen. Use synthetic fixtures only.
- [ ] **Inspect actual print media and browser preview** for each tab: one row, 41 rows, and at least 100 rows spanning multiple printed pages. Assert last record present, stable column widths, repeated header where supported, readable RTL/LTR text, full reason/name wrapping and no deliberately split normal rows. Oversized single rows may split at browser page limits. Check the first and last printed pages, not just the screen DOM. Repeat with a payment/refund form/dialog and a toast open elsewhere: no forms, inputs, sidebar, app header, finance navigation, tabs, filter editors, pager, buttons, links or toast in output; no blank pages caused by the hidden shell. Cancel preview and print again. Visit report/prescription print afterward and verify this scoped CSS is inactive there.
- [ ] **Run formatting and verification sequentially from the repository root.** Run `pnpm exec prettier --check "apps/web/src/payments/collect-payment-print-pages*" "apps/web/src/payments/use-payment-list-print*" "apps/web/src/payments/payment-print-*" "apps/web/src/payments/payments-print.css" "apps/web/src/payments/receipts-content*" "apps/web/src/payments/refunds-content*" "apps/web/src/payments/payments-content*" apps/web/src/shared/i18n/ar-payments.ts apps/web/src/shared/i18n/en-payments.ts`, then `git diff --check`, `pnpm typecheck`, and `pnpm lint`. Expected exit 0 and zero lint errors. Format only changed implementation files if needed; no root `pnpm format` or lockfile changes.
- [ ] **Run every package test script one package at a time:** `pnpm --filter @eyadex/contracts test`, `pnpm --filter @eyadex/observability test`, `pnpm --filter @eyadex/db test`, `pnpm --filter @eyadex/api test`, `pnpm --filter @eyadex/web test`, `pnpm --filter @eyadex/auth test`, `pnpm --filter @eyadex/ids test`, `pnpm --filter @eyadex/secrets test`, `pnpm --filter @eyadex/worker test`. Expected all exit 0; report actual counts and failures. Do not run parallel root `pnpm test`.
- [ ] **Build the deployed preset in PowerShell:** `$env:NITRO_PRESET = 'node-server'` then `pnpm build:all`. Expected exit 0, node-server output. Do not use root `pnpm build`. Re-read `git diff --stat` and `git diff --name-only`; expected only approved web changes plus separately authorized delivery documentation. `git diff -- pnpm-lock.yaml packages/contracts apps/api apps/worker db/sql apps/web/src/styles.css` must be empty for this slice. No migration is required; existing CI/database isolation gates remain in force.

## Task 9: Staging, review and landing handoff

**Owner:** orchestrator only; Lovable supplies its working web checkpoint and exact head. **References:** `.claude/skills/eyadex-delivery-loop/SKILL.md`, `docs/specs/staging-runbook.md` §11, and `docs/adr/0021-staging.md`.

- [ ] **Review and hand off:** provide exact candidate SHA, diff, test counts, ar/en browser results, and open findings. Preserve the checkpoint's published history; orchestrator opens/reviews the delivery PR and requests reviews of its current head. Link the PR to the task. No commit or push is performed by this planning session, and this document is not a deployment receipt.
- [ ] **Promote only the reviewed, green candidate under the existing staging gate.** In the orchestrator's reviewed checkout run `git fetch origin staging`, `git merge-base --is-ancestor origin/staging HEAD` (expected exit 0), then `git push origin HEAD:refs/heads/staging`. Expected fast-forward; stop on divergent staging history, never force it for this task. Verify staging web/API/worker run the exact candidate SHA and are healthy; run `sh docker/smoke-test.sh staging-app.eyadex.com staging-platform.eyadex.com` (expected all checks pass). Any SSH-Musalam-2 access must use the currently discovered Waleed MCP Hub tools and `hub://guide`; do not use standalone SSH or bypass a denial.
- [ ] **Check real HTTP behavior on `https://staging-app.eyadex.com/clinic/payments`.** Use an authorized staging session and synthetic data. For both receipts/refunds with more than 20 matches, inspect that the first `GET /api/v1/payments` or `GET /api/v1/refunds` has no cursor and each subsequent request preserves filters, then verify the last matching row in print preview. Exercise branch restriction, absent patient lookup, receipt-number debounce, empty results, a deliberately failed later read via browser request interception, full retry, tab/filter invalidation and cancel/reprint. Repeat print-media inspection in both languages and both widths. Health checks alone do not pass this gate; if insufficient staging fixtures/access prevent it, report the precise blocker without claiming acceptance.
- [ ] **Land only after current-head CI, required reviews and staging pass.** Orchestrator handles findings under the three-round rule, merges with a merge commit, preserves Lovable synchronization, and checks the automatic production deployment and `sh docker/smoke-test.sh app.eyadex.com platform.eyadex.com`. Expected healthy production and unchanged unrelated print paths; any candidate change requires revalidation on that new head. Update `roadmap.md` and applicable PRD delivery status only in the separately authorized delivery phase. Send the owning orchestrator completion/blocker receipt with task/PR, exact head, actual results, remaining work and recommended next action.

## Independent plan review — round 1

OpenCode Zai GLM 5.3 was selected, but two `delegate_task` attempts failed with `parent_not_active` after the provider handoff. MergePilot (`openai:gpt-6.1-sol`) reviewed head `c8fc23b3434c26c2d7f4ef7b9f691c5163779191` as the disclosed independent substitute. Codex completed the same head with no major issues. No review files were modified by the bots.

| # | Finding | Sev | Verdict | Reason |
|---|---------|-----|---------|--------|
| 1 | Business dates used the browser timezone | P2 | accept | Replaced browser-local formatting for date-only values with `formatPaymentCalendarDate`, using explicit UTC, and added a `TZ=America/New_York` regression check for rows and filters. |

No other actionable finding was returned. Implementation may proceed on the corrected plan; runtime code and acceptance evidence are still required.
