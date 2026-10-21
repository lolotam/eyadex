type Lookup = (key: string) => string;

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * The finance values the generic formatter cannot read (F2 §4.6): a receipt's method, the payment-method
 * switches and the credits one application spent. Anything else, or a malformed list, is null so the caller shows it its own way.
 */
export function formatFinanceAuditList(
  field: string,
  value: unknown,
  tr: Lookup,
  lang: "ar" | "en",
): string | null {
  // A receipt's method reads as the method, not as the shared `audit.values.other` («سبب آخر»).
  if (field === "method" && typeof value === "string") {
    const key = `payments.method.${value}`;
    const label = tr(key);
    return label === key ? null : label;
  }
  if (!Array.isArray(value)) return null;
  const rows = value.map(record);
  if (rows.some((r) => r === null)) return null;
  const items = rows as Record<string, unknown>[];
  if (field === "paymentMethods") {
    if (!items.every((r) => typeof r["method"] === "string" && typeof r["enabled"] === "boolean")) {
      return null;
    }
    return items
      .map(
        (r) =>
          `${tr(`payments.method.${String(r["method"])}`)}: ${tr(r["enabled"] ? "payments.audit.on" : "payments.audit.off")}`,
      )
      .join(lang === "ar" ? "، " : ", ");
  }
  if (field === "spends") {
    if (
      !items.every((r) => typeof r["creditId"] === "string" && typeof r["amountMinor"] === "string")
    ) {
      return null;
    }
    return items.map((r) => `${String(r["creditId"])}: ${String(r["amountMinor"])}`).join("\n");
  }
  return null;
}
