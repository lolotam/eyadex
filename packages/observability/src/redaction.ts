import { isSecretKey } from "./credential-words.ts";
import { redactEmails } from "./emails.ts";
import { maskPhonesInText, scrubSecretsInText } from "./free-text.ts";
import {
  isCodeKey,
  isCodeSecretValue,
  isEmailKey,
  isMedicalKey,
  isNonAsciiKey,
  isPatientKey,
  isPhoneKey,
  isPrivatePayloadKey,
  isStructuralCodeKey,
  isUrlKey,
} from "./keys.ts";
import { maskPhone, REDACTED } from "./masks.ts";
import { normalizeValue } from "./normalize.ts";
import { errorDiagnostic } from "./serializers.ts";
import { scrubUrlCredentials } from "./urls.ts";

export { maskPhone, REDACTED } from "./masks.ts";

// CLAUDE.md §8: never log PINs, tokens, credentials, or a full phone number (last 3 digits only). Keys are
// matched case- and separator-insensitively at ANY depth and inside arrays — pino's own `redact` paths only
// reach the levels they name, so a secret one level deeper than expected would be printed.

const MAX_DEPTH = 8;
// A log field is not a data store. Anything larger than this is replaced without being scanned, so a
// caller-supplied or provider-supplied body cannot spend the event loop on an unbounded regex.
const MAX_STRING_LENGTH = 64 * 1024;

// A percent-encoded value hides its content from every regex, so one guarded decode is attempted; when the
// decoded text matches a rule, the decoded-and-redacted text is what gets emitted.
const tryDecode = (text: string): string | undefined => {
  if (!text.includes("%")) return undefined;
  try {
    const decoded = decodeURIComponent(text);
    return decoded === text ? undefined : decoded;
  } catch {
    return undefined;
  }
};

// The one pass over a string: URL credentials, then credentials/civil IDs, then (log mode) phones and
// emails. Credentials and civil IDs run in both modes; names, phones and emails are audit-policy choices.
function scanText(text: string, urlKey: boolean, maskPhones: boolean): string {
  if (text.length > MAX_STRING_LENGTH) return REDACTED;
  let out = scrubUrlCredentials(text, urlKey);
  out = scrubSecretsInText(out);
  if (maskPhones) out = redactEmails(maskPhonesInText(out));
  return out;
}

// Normalise first; if no rule matched, the ORIGINAL string is kept, so a value that merely contains an
// invisible control is not silently rewritten. The length cap is checked before normalising as well.
function scrubString(original: string, urlKey: boolean, maskPhones: boolean): string {
  if (original.length > MAX_STRING_LENGTH) return REDACTED;
  const decoded = tryDecode(original);
  if (decoded !== undefined) {
    const normalizedDecoded = normalizeValue(decoded);
    const scrubbedDecoded = scanText(normalizedDecoded, urlKey, maskPhones);
    if (scrubbedDecoded !== normalizedDecoded) return scrubbedDecoded;
  }
  const normalized = normalizeValue(original);
  const scrubbed = scanText(normalized, urlKey, maskPhones);
  return scrubbed === normalized ? original : scrubbed;
}

// A number or bigint can BE a civil ID or phone number under a neutral key. Its decimal string is scanned
// by those two rules; a match replaces the value with the masked/REDACTED string, otherwise the value is
// untouched. Birth dates as plain dates are an accepted risk (see docs/adr/0001-log-redaction.md).
function scanNumber(text: string, maskPhones: boolean): string {
  const afterCivil = scrubSecretsInText(text);
  return maskPhones ? maskPhonesInText(afterCivil) : afterCivil;
}

type Decision = { handled: true; value: unknown } | { handled: false };

// The key rule for one property, applied to log objects and to Map entries alike. Credentials and a
// non-ASCII key (which cannot be reasoned about from its spelling) apply in BOTH modes.
function decide(key: string, child: unknown, maskPhones: boolean): Decision {
  if (isMedicalKey(key) || isSecretKey(key)) return { handled: true, value: REDACTED };
  if (isCodeKey(key) && !isStructuralCodeKey(key) && isCodeSecretValue(child))
    return { handled: true, value: REDACTED };
  if (isNonAsciiKey(key)) return { handled: true, value: REDACTED };
  if (!maskPhones) return { handled: false };
  if (isEmailKey(key) || isPatientKey(key) || isPrivatePayloadKey(key))
    return { handled: true, value: REDACTED };
  if (isPhoneKey(key))
    return {
      handled: true,
      value: Array.isArray(child) ? child.map(maskPhone) : maskPhone(child),
    };
  return { handled: false };
}

// One walk for both entry points. Only data survives: functions are dropped, dates become ISO strings,
// errors become diagnostics. A true cycle (an object that is its own ancestor) and anything deeper than
// MAX_DEPTH are replaced rather than walked; a repeated sibling is walked again, because it is not a cycle.
// Output objects have a null prototype so an own `__proto__` key is kept as an ordinary key and walked.
function scrub(value: unknown, maskPhones: boolean): unknown {
  const walk = (node: unknown, depth: number, urlKey: boolean, ancestors: object[]): unknown => {
    if (typeof node === "function" || typeof node === "symbol") return undefined;
    if (typeof node === "string") return scrubString(node, urlKey, maskPhones);
    if (typeof node === "bigint") return scanNumber(node.toString(), maskPhones);
    if (typeof node === "number") {
      if (!Number.isFinite(node)) return node;
      const text = String(node);
      const scrubbed = scanNumber(text, maskPhones);
      return scrubbed === text ? node : scrubbed;
    }
    if (node === null || typeof node !== "object") return node;
    if (node instanceof Date) return Number.isNaN(node.getTime()) ? null : node.toISOString();
    if (node instanceof Error) return errorDiagnostic(node);
    // A buffer or typed array is raw bytes; nothing about them is safe to print.
    if (ArrayBuffer.isView(node) || node instanceof ArrayBuffer) return REDACTED;
    if (ancestors.includes(node)) return "[Circular]";
    if (depth >= MAX_DEPTH) return "[Truncated]";
    const path = [...ancestors, node];
    if (node instanceof Map) return walkMap(node, depth, path);
    if (node instanceof Set) return [...node].map((item) => walk(item, depth + 1, urlKey, path));
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1, urlKey, path));
    return walkObject(node, depth, path);
  };

  const walkObject = (
    node: object,
    depth: number,
    ancestors: object[],
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(node)) {
      let child: unknown;
      try {
        // An enumerable getter can throw; a sanitiser that throws is a sanitiser that gets bypassed.
        child = (node as Record<string, unknown>)[key];
      } catch {
        out[key] = REDACTED;
        continue;
      }
      if (typeof child === "function") continue;
      const decision = decide(key, child, maskPhones);
      out[key] = decision.handled
        ? decision.value
        : walk(child, depth + 1, isUrlKey(key), ancestors);
    }
    return out;
  };

  const walkMap = (
    node: Map<unknown, unknown>,
    depth: number,
    ancestors: object[],
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = Object.create(null);
    for (const [rawKey, child] of node) {
      const isStringKey = typeof rawKey === "string";
      const key = isStringKey ? rawKey : String(rawKey);
      const decision = isStringKey ? decide(key, child, maskPhones) : { handled: false as const };
      out[key] = decision.handled
        ? decision.value
        : walk(child, depth + 1, isStringKey && isUrlKey(key), ancestors);
    }
    return out;
  };

  return walk(value, 0, false, []);
}

/**
 * Returns an inert copy of a log object with every secret replaced, at any depth and inside arrays, and
 * every phone number reduced to its last 3 digits (CLAUDE.md §8). Civil IDs and birth dates are always
 * replaced whole, here and in redactSecrets. This is a defence-in-depth safety net: the primary control is
 * structured logging with catalogued events and allowlisted fields (see docs/adr/0001-log-redaction.md).
 *
 * @param value the object about to be logged
 * @returns a sanitised copy safe to write
 */
export function sanitize(value: unknown): unknown {
  try {
    return scrub(value, true);
  } catch {
    return REDACTED;
  }
}

/**
 * The same walk for a business record that is kept, not a technical log: secrets, PEM blocks, civil IDs and
 * URL tokens are replaced; names, emails and phone numbers are kept (clinic-side, allowlisted at the
 * writer). Used for the audit trail's before/after snapshots, where CLAUDE.md §5 forbids the civil ID in
 * any form.
 *
 * @param value the snapshot about to be stored
 * @returns a copy with no secret, PEM, civil ID or URL token in it
 */
export function redactSecrets(value: unknown): unknown {
  try {
    return scrub(value, false);
  } catch {
    return REDACTED;
  }
}
