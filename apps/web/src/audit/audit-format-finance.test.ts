import { describe, expect, it } from "vitest";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { formatFinanceAuditList } from "./audit-format-finance";

function lookup(dict: unknown) {
  return (key: string): string => {
    let node: unknown = dict;
    for (const part of key.split(".")) {
      if (node && typeof node === "object" && part in node)
        node = (node as Record<string, unknown>)[part];
      else return key;
    }
    return typeof node === "string" ? node : key;
  };
}

const METHODS = [
  { method: "cash", enabled: true },
  { method: "knet", enabled: false },
  { method: "bank_transfer", enabled: true },
  { method: "other", enabled: false },
];
const SPENDS = [
  { creditId: "0190a000-0000-7000-8000-000000000001", amountMinor: "3000" },
  { creditId: "0190a000-0000-7000-8000-000000000002", amountMinor: "500" },
];

describe("finance audit list values", () => {
  it("reads the payment-method switches in Arabic", () => {
    expect(formatFinanceAuditList("paymentMethods", METHODS, lookup(ar), "ar")).toBe(
      "نقدًا: مفعّل، كي نت: موقوف، تحويل بنكي: مفعّل، أخرى: موقوف",
    );
  });

  it("reads the payment-method switches in English", () => {
    expect(formatFinanceAuditList("paymentMethods", METHODS, lookup(en), "en")).toBe(
      "Cash: On, KNET: Off, Bank transfer: On, Other: Off",
    );
  });

  it("lists one line per credit spent, in both languages", () => {
    const text = `${SPENDS[0]!.creditId}: 3000\n${SPENDS[1]!.creditId}: 500`;
    expect(formatFinanceAuditList("spends", SPENDS, lookup(ar), "ar")).toBe(text);
    expect(formatFinanceAuditList("spends", SPENDS, lookup(en), "en")).toBe(text);
  });

  it("reads a receipt's method as the method, «أخرى» not «سبب آخر»", () => {
    expect(formatFinanceAuditList("method", "other", lookup(ar), "ar")).toBe("أخرى");
    expect(formatFinanceAuditList("method", "knet", lookup(en), "en")).toBe("KNET");
  });

  it("leaves any other field or a malformed list to the caller", () => {
    expect(formatFinanceAuditList("changed", ["a"], lookup(en), "en")).toBeNull();
    expect(formatFinanceAuditList("paymentMethods", [{ method: 1 }], lookup(en), "en")).toBeNull();
  });
});
