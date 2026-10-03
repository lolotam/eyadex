import { errorDiagnostic } from "./serializers.ts";

// CLAUDE.md §8: never log PINs, tokens, credentials, or a full phone number (last 3 digits only).
// Keys are matched case-insensitively at ANY depth and inside arrays — pino's own `redact` paths only
// reach the levels they name, so a secret one level deeper than expected would be printed.
// Keys are compared after removing case and separators, so accessToken, access_token and ACCESS-TOKEN are
// one key, and by suffix, so sessionToken, bearer_token or card_cvv are caught without being listed.
// The rules carried over from the reference implementation are kept as they are, including the ones a
// clinic product has no use for today (card CVV, a code MAC): a rule that costs nothing and would have
// been there when they become relevant is cheaper than the gap they would leave.
const SECRET_SUFFIXES = [
  // a session id or session token is a bearer credential (Better Auth sessions, cookies): session, sessionId,
  // userSession, session_id
  "session",
  "sessionid",
  "token",
  "secret",
  "password",
  "passwordhash",
  "apikey",
  "credential",
  "credentials",
  "cookie",
  "authorization",
  "pin",
  "otp",
  // "code" alone is not a secret (error_code, status_code); a PIN, OTP or pass code under a code-named key is
  "pincode",
  "passcode",
  "otpcode",
  "securitycode",
  "verificationcode",
  "codemac",
  "derivationkey",
  "verificationkey",
  "cvv",
  // a hash of a secret (pin_hash, token_hash, password_hash) is still sensitive
  "hash",
  // any key ending in "key" is a credential (secret_key, hmac_key, api_key, a bare key) unless it is
  // one of the structural names below — enumerating credential prefixes always misses the next one
  "key",
  "passphrase",
  // a connection string carries its password inline
  "dsn",
  // presigned-URL and webhook signatures (X-Amz-Signature, sig)
  "signature",
  "connectionstring",
];
const STRUCTURAL_KEYS = new Set([
  "sortkey",
  "cachekey",
  "primarykey",
  "foreignkey",
  "partitionkey",
  "groupkey",
  "lookupkey",
  "routekey",
  "eventkey",
  "messagekey",
  "translationkey",
  "i18nkey",
]);
const PHONE_SUFFIXES = ["phone", "phones", "phonenumber", "phonenumbers", "mobile", "mobiles"];
// Notification/source payloads and provider bodies never belong in technical diagnostics, and neither does
// the body of a request a caller sent us.
const PRIVATE_PAYLOAD_KEYS = new Set([
  "payload",
  "eventpayload",
  "jobdata",
  "providerbody",
  "rawbody",
  "requestbody",
  "safeparameters",
  "components",
  "emailbody",
  "emailhtml",
  "emailtext",
]);
// CLAUDE.md §5 and §8: a civil ID and a birth date are NEVER printed, not even partially, not even one
// digit — inside a log line or inside an audit snapshot. Unlike a phone number there is no "last 3" that
// is safe to keep, and unlike a secret the value cannot be re-derived from the key.
// Matched as a PART of the normalized key, not as its suffix: the field will reach the logs under
// whatever name the caller gave it (civilId, civil_id, CIVIL_ID, patientCivilId, civilIdNumber,
// nationalId, dateOfBirth, dob, birthDate, birth_date), and guessing the exact spelling is exactly how a
// medical identifier escapes the list. A false positive only hides one more field, which is the safe
// direction for the data this project holds.
const MEDICAL_KEY_PARTS = ["civilid", "nationalid", "birth", "dob"];
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");
// A plural container ("passwords", "tokens", "hashes") holds secrets under ordinary child keys, so the key
// is also tested with a trailing "s" or "es" removed — the container is redacted before its children.
const endsWithAny = (key: string, suffixes: readonly string[]): boolean => {
  const normalized = normalizeKey(key);
  const forms = [normalized, normalized.replace(/es$/, ""), normalized.replace(/s$/, "")];
  return forms.some((form) => suffixes.some((suffix) => form.endsWith(suffix)));
};
// Too short to match by suffix ("inside", "outside"), so only the whole key: a session cookie's usual name.
const SECRET_EXACT_KEYS: ReadonlySet<string> = new Set(["sid", "connectsid"]);
const isSecretKey = (key: string): boolean =>
  (endsWithAny(key, SECRET_SUFFIXES) || SECRET_EXACT_KEYS.has(normalizeKey(key))) &&
  !STRUCTURAL_KEYS.has(normalizeKey(key));
const isPhoneKey = (key: string): boolean => endsWithAny(key, PHONE_SUFFIXES);
const isEmailKey = (key: string): boolean =>
  endsWithAny(key, ["email", "emails", "emailaddress", "emailaddresses"]);
const isMedicalKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return MEDICAL_KEY_PARTS.some((part) => normalized.includes(part));
};

// URLs are checked in every string value, because their key (DATABASE_URL, url, link) looks harmless. A URL
// is PARSED, not pattern-matched: the parser knows that the last "@" before the host ends the userinfo (a
// password may contain "@"). Only scheme, host and port survive; userinfo, path, query and fragment are
// withheld: a reset link carries its token in the path, an OAuth callback in the fragment, an invitation a
// token in the query (even a bare `?token`), and no name or pattern tells those from harmless ones.
const URL_START = /^\s*[a-z][a-z0-9+.-]*:\/\//i;
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const EMAIL_OR_URL =
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+|[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+/gi;

function scrubUrl(candidate: string): string {
  try {
    const url = new URL(candidate);
    const userinfo = url.username !== "" || url.password !== "" ? "***@" : "";
    const path = url.pathname === "" || url.pathname === "/" ? url.pathname : "/[REDACTED]";
    const query = url.search === "" ? "" : "?[REDACTED]";
    const fragment = url.hash === "" ? "" : "#[REDACTED]";
    return `${url.protocol}//${userinfo}${url.host}${path}${query}${fragment}`;
  } catch {
    // Unparseable: no pattern can tell where its userinfo ends, so only the scheme survives.
    return candidate.replace(/^(\s*[a-z][a-z0-9+.-]*:\/\/)[\s\S]*$/i, "$1[REDACTED]");
  }
}

// A value that IS a URL is parsed whole (a password may even contain whitespace). A URL embedded in longer
// text is found and parsed on its own — but in text its end is a guess: "postgres://user:with space@db" is
// matched only up to the space. If an "@" still follows a "://" once every parsed userinfo is masked, the
// boundary was ambiguous and the whole value is withheld.
const AMBIGUOUS_USERINFO = /:\/\/[\s\S]*@/;
function scrubUrlCredentials(text: string): string {
  if (URL_START.test(text)) return scrubUrl(text.trim());
  const scrubbed = text.replace(URL_IN_TEXT, scrubUrl);
  return AMBIGUOUS_USERINFO.test(scrubbed.replaceAll("://***@", "://")) ? "[REDACTED]" : scrubbed;
}

const MAX_DEPTH = 8;
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

// One walk for both entry points. Only data survives: functions (including a `toJSON` hook, which JSON
// serialisation would call and which could return anything) are dropped, dates become ISO strings, errors
// become diagnostics. Cycles and anything deeper than MAX_DEPTH are replaced rather than walked.
// A Kuwaiti number written by hand inside free text ("call 5001 2345", "00965-5001-2345") under a key that
// is not a phone key. Eight digits starting 2/4/5/6/9, optional +965/00965 and one space or dash between the
// halves. The boundaries keep it off UUIDs, dates and longer digit runs: not glued to a letter, digit, dash
// or plus on either side.
// A civil ID written inside free text (a search term, a note), under a key that says nothing: 12 digits,
// ASCII or Arabic-Indic, starting with the century digit 2 or 3, optionally split by spaces or dashes. Any
// such run is replaced whole, valid checksum or not — over-redacting a 12-digit reference costs nothing,
// printing a civil ID breaks CLAUDE.md §5. It runs before phone masking, which would otherwise mask an
// 8-digit slice and leave the rest of the ID readable.
const CIVIL_ID_IN_TEXT = /(?<![\w٠-٩۰-۹-])[23٢٣۲۳](?:[\s-]?[0-9٠-٩۰-۹]){11}(?![\w٠-٩۰-۹-])/g;

// Credentials written inside free text under a key that says nothing ({ detail: "Bearer eyJ…" }): an
// Authorization scheme's value, any JWT, and `name=value` / `name: value` pairs whose name is a credential.
// The long credential words match as a suffix (accessToken=, x-api-key:), the short ones only as a whole
// word (sid=, pin:), so "pinned: true" or "spin=3" are left alone.
const AUTH_SCHEME_VALUE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_IN_TEXT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const CREDENTIAL_ASSIGNMENT =
  /\b([\w.-]*?(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|session[_-]?id|session|authorization|cookie|signature)|sid|pwd|pin|otp)(\s*[:=]\s*)("?)[^\s&",;]+\3/gi;

function scrubCredentialsInText(text: string): string {
  return text
    .replace(AUTH_SCHEME_VALUE, `$1 ${REDACTED}`)
    .replace(JWT_IN_TEXT, REDACTED)
    .replace(CREDENTIAL_ASSIGNMENT, `$1$2${REDACTED}`);
}

// Digits may be ASCII or Arabic-Indic (an Arabic-first app: "اتصل على ٥٠٠١ ٢٣٤٥").
const KUWAIT_LOCAL_PHONE =
  /(?<![\w٠-٩۰-۹+-])(?:(?:\+|00|٠٠|۰۰)(?:965|٩٦٥|۹۶۵)[\s-]?)?[24569٢٤٥٦٩۲۴۵۶۹][0-9٠-٩۰-۹]{3}[\s-]?[0-9٠-٩۰-۹]{4}(?![\w٠-٩۰-۹-])/g;

function scrub(value: unknown, maskPhones: boolean): unknown {
  const seen = new WeakSet<object>();
  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === "function" || typeof node === "symbol") return undefined;
    if (typeof node === "bigint") return node.toString();
    if (typeof node === "string") {
      // Civil IDs go in every mode (logs and audit snapshots alike); phones and emails only where masked.
      const text = scrubCredentialsInText(scrubUrlCredentials(node)).replace(
        CIVIL_ID_IN_TEXT,
        REDACTED,
      );
      return maskPhones
        ? text
            .replace(/\+[1-9١-٩۱-۹][0-9٠-٩۰-۹]{7,14}/g, maskPhone)
            .replace(KUWAIT_LOCAL_PHONE, maskPhone)
            .replace(EMAIL_OR_URL, (part) => (URL_START.test(part) ? part : REDACTED))
        : text;
    }
    if (node === null || typeof node !== "object") return node;
    if (node instanceof Date) return Number.isNaN(node.getTime()) ? null : node.toISOString();
    // pino runs this before its serializers, so an Error anywhere in the object is reduced here — its
    // message, causes and extra properties can all carry secrets.
    if (node instanceof Error) return errorDiagnostic(node);
    if (seen.has(node)) return "[Circular]";
    if (depth >= MAX_DEPTH) return "[Truncated]";
    seen.add(node);
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      if (typeof child === "function") continue;
      if (
        isMedicalKey(key) ||
        isSecretKey(key) ||
        (normalizeKey(key) === "code" && typeof child === "string" && /^\d{6}$/.test(child)) ||
        (maskPhones && (isEmailKey(key) || PRIVATE_PAYLOAD_KEYS.has(normalizeKey(key))))
      )
        out[key] = REDACTED;
      else if (maskPhones && isPhoneKey(key))
        out[key] = Array.isArray(child) ? child.map(maskPhone) : maskPhone(child);
      else out[key] = walk(child, depth + 1);
    }
    return out;
  };
  return walk(value, 0);
}

/**
 * Returns an inert copy of a log object with every secret replaced, at any depth and inside arrays, and
 * every phone number reduced to its last 3 digits (CLAUDE.md §8). Civil IDs and birth dates are always
 * replaced whole, here and in redactSecrets.
 *
 * @param value the object about to be logged
 * @returns a sanitised copy safe to write
 */
export function sanitize(value: unknown): unknown {
  return scrub(value, true);
}

/**
 * The same walk for a business record that is kept, not a technical log: secrets and URL credentials are
 * replaced, phone numbers are kept as they are. Used for the audit trail's before/after snapshots, where
 * CLAUDE.md §5 forbids the civil ID in any form — so that field is still replaced.
 *
 * @param value the snapshot about to be stored
 * @returns a copy with no secret and no civil ID in it
 */
export function redactSecrets(value: unknown): unknown {
  return scrub(value, false);
}
