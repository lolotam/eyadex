# Invoice line price fills from the service price (owner decision 2026-10-24)

Web only. No contract, mock, API or SQL change. No lockfile change.

## Behaviour

1. Picking or changing a service on a service line, or picking/changing its doctor, sets the line's unit price: the doctor's price for that service if one exists, else the base price.
2. «إضافة خدمة» fills the new line's price for the pre-selected first service the same way.
3. A typed price is never overwritten by re-renders or background refetches of the price list; only a new service or doctor pick on that line refills it.
4. The edit form and a sourced draft never get repriced on load: filling runs only from user picks (event handlers), never from an effect.
5. A service with no price (no doctor price and `priceMinor` null): the price stays as it is (0.000 for a new line), and «لا يوجد سعر لهذه الخدمة…» (existing key `errors.price_missing`, ar + en already present) shows under the line at once.
6. Without `view:prices:clinic` the price list is never requested (`usePriceList(false)`); lines stay manual and no early "no price" message is shown (we cannot know). The existing server `price_missing` after «إصدار» still shows.

## Technical details

- New pure module `invoices/line-price.ts`: `linePriceMinor(list, serviceId, providerId): string | null` (doctor price via `providerPrices[].memberId === providerId`, else `priceMinor`), using `priceOf` from `services/price-queries.ts`. Unit-tested.
  - Check needed: `invoices/` importing `services/` must pass the area-boundary test; if it fails, the helper re-implements the lookup locally and `usePriceList` access goes through `useApi().finance.prices` in an invoices-local hook.
- `invoice-form.tsx`: `const prices = usePriceList(can(session.permissions, "view", "prices"))`; a `refill(index)` that computes the price and `form.setValue("lines.i.unitPrice", money.toMajor(minor))` when not null. Passed to `InvoiceLineRow` as `onPicked`. The append handler uses the same lookup for the first service.
- `invoice-line-row.tsx`: service and doctor `onValueChange` call `field.onChange(v)` then `p.onPicked()`.
- `missingAt(i)` adds: prices loaded, line is a service line with a service, and `linePriceMinor` is null. Kept under 300 lines (form is 242 now; move the lookup/append into a small hook `use-line-pricing.ts` if needed).
- Mock: none needed; `finance.prices` already exists and the API accepts any submitted unit price.

## Tests (each reverted to prove it fails)

- `line-price.test.ts`: base price; doctor price wins; doctor without a price falls back to base; no price → null.
- `invoice-form-pricing.test.tsx` (new): picking a service fills base price; picking a doctor with a price fills it, changing the doctor refills; a typed price survives a re-render and a `refetchQueries` of prices; unpriced service shows the message without submitting; no `view:prices:clinic` → `prices` never called, line stays 0.000; edit form with saved lines keeps the saved prices after the price list loads.
- Existing `new-invoice-issuance.test.tsx` / `new-invoice-page.test.tsx` updated only if their mocks need a `finance.prices` stub.

## Gates

typecheck, lint 0 errors, vitest with counts, prettier on touched files, Arabic/English 1440/390 preview check, review-lessons checklist.

## Open product questions

1. The price list keys doctor prices by `memberId`, and the line's doctor is a `membershipId`. I will treat them as the same id (as the services price screen does) unless you say otherwise.
2. When the newly picked service/doctor has no price but the line already has a non-zero price (from an earlier pick or typing), should the old price stay (my plan) or reset to 0.000?
3. Should a sourced (appointment/visit) form also refill when the user changes a service on it? My plan: yes, same rule, since it only reacts to picks.
