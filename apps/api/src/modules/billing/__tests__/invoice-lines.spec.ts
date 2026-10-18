import type { Invoice, InvoiceLineInput } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";
import { describe, expect, it, vi } from "vitest";

import { checkServiceLines } from "../use-cases/invoice-lines.ts";

const CLINIC = "0190a000-0000-7000-8000-000000000001";
const SERVICE = "0190a000-0000-7000-8000-000000000002";
const PROVIDER = "0190a000-0000-7000-8000-000000000003";
const line = (over: object = {}): InvoiceLineInput => ({
  kind: "service",
  serviceId: SERVICE,
  providerId: null,
  quantity: 1,
  unitPriceMinor: "1000",
  discount: null,
  ...over,
});
const saved = (input: InvoiceLineInput): Invoice["lines"][number] => ({
  ...input,
  serviceId: SERVICE,
  providerId: input.kind === "service" ? input.providerId : null,
  descriptionAr: "جلسة",
  descriptionEn: "Session",
  position: 0,
  lineTotalMinor: "1000",
});
const store = (price: string | null, providerPrice: string | null = null) => {
  const execute = vi.fn().mockResolvedValue([
    {
      id: SERVICE,
      name_ar: "جلسة",
      name_en: "Session",
      price_minor: price,
      member_id: PROVIDER,
      provider_price_minor: providerPrice,
    },
  ]);
  return { tx: { execute } as unknown as Tx, execute };
};

describe("invoice service validation", () => {
  it("reads every service and provider price in one round trip and keeps error order", async () => {
    const { tx, execute } = store("1000", "0");
    await checkServiceLines(tx, CLINIC, [line(), line({ providerId: PROVIDER })]);
    expect(execute).toHaveBeenCalledTimes(1);
    const onlyProvider = store(null, "0");
    await checkServiceLines(onlyProvider.tx, CLINIC, [line({ providerId: PROVIDER })]);
    await expect(checkServiceLines(onlyProvider.tx, CLINIC, [line()])).rejects.toMatchObject({
      code: "price_missing",
      details: { position: 0 },
    });
    const noPrice = store(null);
    await expect(
      checkServiceLines(noPrice.tx, CLINIC, [line(), line({ serviceId: PROVIDER })]),
    ).rejects.toMatchObject({ code: "price_missing", details: { position: 0 } });
    await expect(
      checkServiceLines(noPrice.tx, CLINIC, [line({ serviceId: PROVIDER }), line()]),
    ).rejects.toMatchObject({
      code: "validation",
      details: [{ path: ["lines", 0, "serviceId"], code: "unknown" }],
    });
  });

  it("exempts each stored matching line once while changed and added lines need a price", async () => {
    const { tx } = store(null);
    const original = line({ discount: { kind: "pct", bp: 100, reason: "courtesy" } });
    const previous = [saved(original)];
    await expect(checkServiceLines(tx, CLINIC, [original], previous)).resolves.toBeInstanceOf(Map);
    for (const change of [
      { quantity: 2 },
      { providerId: PROVIDER },
      { unitPriceMinor: "999" },
      { discount: null },
    ]) {
      await expect(
        checkServiceLines(tx, CLINIC, [line({ ...original, ...change })], previous),
      ).rejects.toMatchObject({ code: "price_missing" });
    }
    await expect(
      checkServiceLines(tx, CLINIC, [original, original], previous),
    ).rejects.toMatchObject({ code: "price_missing", details: { position: 1 } });
  });
});
