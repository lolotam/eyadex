# Plan: Card 1(b) reduced + Card B (PDF "not available yet" message)

Base: `lovable` = `46e84dd2` (checked here). Still held: PR #171, `payments/receipt-details*`, `payments/receipt-pdf-*`, `shared/pdf/*`, receipt PDF i18n keys, Card 2c.

## Card A — Card 1(b), invoice page + invoice PDF button

Checks: Arabic and English, 1440 and 390, signed in as clinic admin and as doctor, through the normal screens (mock, seed unchanged).
- Keyboard: Tab order through the header actions (PDF, send menu, edit, void), payment panel, movements; visible focus ring on each.
- Names: every control has an accessible name; icons are hidden from screen readers.
- Focus return: edit and void dialogs, the send menu, and the PDF button after an error/retry.
- Tap targets at 390: at least 44px high.
- Announcements: "Preparing PDF…" while pending; the error banner once on failure.
- Print: print media on the invoice page, one page and a long invoice (many lines), as in Card 1(a).

Files in scope: `invoices/invoice-page.tsx`, `invoices/invoice-pdf-action.tsx`, `invoices/invoice-pdf-tab.ts` (read only unless a defect), `payments/invoice-payment-panel.tsx`, `invoice-movements.tsx`, their tests, invoice PDF i18n keys.

Expected defects (each confirmed in the browser before it is fixed):
1. Header buttons use `size="sm"` (32px): PDF, send, edit, void. Fix: 44px minimum on narrow screens only (`min-h-11` below `sm`), desktop unchanged. Test: class/size assertion that fails without it.
2. "Preparing PDF…" status region is created at the same moment as its text, which some screen readers skip. Fix: keep the live region always mounted, fill text only while pending. Test: region exists before the click.
3. Error banner icon (`AlertCircle`) not hidden from screen readers; back-link arrow too. Fix: `aria-hidden`. Test: queried icon has `aria-hidden`.
4. Print: Card 1(a) found the global print rule hides non-report pages. If the invoice page prints blank, I report it and propose a fix (it touches `styles.css`, shared app-wide) — I will not change it without your OK.
5. Payment panel / movements: check only; fix only what is confirmed.

Anything not found in the browser is dropped, not fixed.

## Card B — "PDF is not available yet" (503)

What the API sends today (read in `apps/api`): the default `UnavailableInvoicePdf` throws `ServiceUnavailableError` → HTTP 503, code `unknown`, no details. A real render failure is `pdf_render_failed`; busy is `pdf_busy` (both already in the web catalogue).

How the web tells them apart: only by HTTP status 503. The code alone (`unknown`) cannot. Today `errorFromResponse` drops the status, so the page shows "Something went wrong".

Honest limit: 503 with `unknown` is also what the API sends when another dependency is down (e.g. the rate limiter's Redis). So the web cannot truly know "not built yet" versus "temporarily down" without an API change. Wording therefore says "not available right now", not "coming soon".

Web-only change:
- `shared/api/http/http-errors.ts`: keep the code `unknown`, add `details.status = 503` when the response is 503 (no other behaviour change; existing callers keep working).
- `shared/api/api-error.ts`: small `isServiceUnavailable(error)` reader.
- `invoice-pdf-action.tsx` / `invoice-page.tsx`: pass a third state "unavailable" up; banner shows the new text, neutral (info) style instead of destructive; button label stays "Retry opening PDF".
- Mock unchanged (it always renders).

Proposed text:
- ar: «ملف PDF غير متاح حاليًا» — «إنشاء ملفات PDF للفواتير غير متاح على الخادم الآن. حاول لاحقًا، أو اطبع الفاتورة من المتصفح.»
- en: "PDF isn't available right now" — "Invoice PDFs can't be created on the server at the moment. Try again later, or print the invoice from your browser."
(The "print from the browser" part is kept only if Card A shows the page prints correctly; otherwise dropped.)

Tests (each fails without its fix): HTTP adapter turns a 503 into `unknown` with `status: 503`; a 500 `unknown` stays without it; invoice page shows the unavailable text for 503 and the old "could not be opened" text for `pdf_render_failed` and plain `unknown`.

Proposed for the orchestrator (not done here): a dedicated code (e.g. `pdf_unavailable`) from the API would make this exact.

## Order and limits
Card A one commit per fix group, then Card B one commit. Focused tests only, no full suite. apps/web only, files under 300 lines (`invoice-page.tsx` is 253; if it would pass 300 the banner moves to its own file), ar+en keys, logical CSS, no new libraries.

## Handoff
Files changed, tests run, defects with evidence, and what I could not verify (Node 24 build, staging, real print, screen reader).
