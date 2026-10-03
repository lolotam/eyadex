// The two masks every redaction path shares (log lines, audit snapshots, free text).
export const REDACTED = "[REDACTED]";

/**
 * A phone number keeps its last 3 digits; anything else under a phone key is replaced entirely.
 *
 * @param value the value found under a phone key
 * @returns what is printed instead
 */
export function maskPhone(value: unknown): string {
  if (typeof value !== "string") return REDACTED;
  // Already masked (the sanitiser can run twice on one line): keep it, don't mask the mask.
  if (/^\*{3}\d{0,3}$/.test(value)) return value;
  // Arabic-Indic digits count as digits: the last three are kept as ASCII, nothing else survives.
  const digits = value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "");
  return digits.length > 3 ? `***${digits.slice(-3)}` : "***";
}
