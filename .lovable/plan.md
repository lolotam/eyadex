# Invoice line price fills from the service price (owner decision 2026-10-24)

Web only. No contract, mock, API or SQL change. No lockfile change.

## Behaviour

1. Picking or changing a service on a service line, or picking/changing its doctor, sets the line's unit price: the doctor's price for that service if one exists, else the base price.
2. «إضافة خدمة» fills the new line's price for the pre-selected first service the same way.
3. A typed price is never overwritten by re-renders or background refetches of the price list; only a new service or doctor pick on that line refills it.
4. The edit form and a sourced draft never get repriced on load: filling runs only from user picks (event handlers), never from an effect.
5. A pick with no price at all (no doctor price and no base price) resets the line to 0.000 and shows «لا يوجد سعر لهذه الخدمة…» (existing key `errors.price_missing`, ar + en already present) under the line at once. The owner answered on 2026-10-24: the old price does not stay.
6. While the price list is still on its way, «إضافة خدمة» and the service and doctor selects of every service line are disabled: a pick before the prices arrive would be lost. They open again once the list is there. The free-item button stays open.
7. When the price request fails, one note above the lines says so (new key `finance.invoice.pricesUnavailable`, in the finance dictionaries) with a retry button (`common.retry`); the selects are open again and the lines stay manual until a retry works.
8. Without `view:prices:clinic` the price list is never requested, and a cached list is never read either; lines stay manual and no early "no price" message is shown (we cannot know). The existing server `price_missing` after «إصدار» still shows.
9. In the edit form a saved line the user did not change (same service, same doctor, same price) is not flagged as unpriced: the API keeps a saved line's price even when the price was removed (`checkServiceLines`). A line the user changed is flagged as before.

## Technical details

- The lookup lives in `invoices/line-price.ts`: `linePriceMinor(list, serviceId, providerId)` (the doctor's price via `providerPrices[].memberId === providerId`, else `priceMinor`), `pickedPriceMajor(...)` (the price a pick writes, 0.000 when the service has none), `isUnpricedLine(...)` (the "no price" message, skipping a saved unchanged line) and `useLinePrices()` (the query, with `loading` and `failed` for the form).
- `useLinePrices` asks for the list only with `view:prices:clinic` and the finance module explicitly on (as `usePriceList` reads it), and hands back no data at all without the key, so a cached list is never shown to a member who may not read prices.
- `invoice-form.tsx`: `priceFor` writes the looked-up price on a pick only (`refill(index)`); the note and its retry sit above the lines; the add-service button and the line selects are disabled while the list loads. The form stays under 300 lines (274 now).
- `invoice-line-row.tsx`: the service and doctor selects take `disabled` from the form; their `onValueChange` calls `field.onChange(v)` then `p.onPicked()`.
- Mock: none needed; `finance.prices` already exists and the API accepts any submitted unit price.

## Tests (each reverted to prove it fails)

- `invoice-form-pricing.test.tsx`: picking a service fills the base price; a doctor's own price wins and changing the doctor refills; a typed price survives a re-render and a background refetch; an unpriced service resets to 0.000 and shows the message at once; without `view:prices` no request is made and the line stays manual; the edit form keeps the saved prices after the list loads; the picks wait for the list and fill the price once it arrives; a failed list shows the note and a retry fills the price again; without `view:prices` a cached list fills nothing; a saved unchanged line is not flagged and a changed one is.
- There is no `line-price.test.ts`: the lookup is covered through the form, which is where the rules live.
- Existing `new-invoice-issuance.test.tsx` / `invoice-edit-discounts.test.tsx` need no change: their mocked sessions hold no `view:prices`, so the list is never asked for.

## Gates

typecheck, lint 0 errors, vitest with counts, prettier on touched files, Arabic/English 1440/390 preview check, review-lessons checklist.

## Open product questions

All three are answered by the owner on 2026-10-24:

1. The price list keys doctor prices by `memberId` and the line's doctor is a `membershipId`: they are the same id, as the services price screen does.
2. A pick with no price resets the line to 0.000 and shows «لا يوجد سعر لهذه الخدمة…» at once.
3. A sourced (appointment/visit) form refills on a pick like any other form: it only reacts to picks.
