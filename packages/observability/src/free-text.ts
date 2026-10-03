import { maskPhone, REDACTED } from "./masks.ts";

// Free text: identifiers and credentials written inside a string, under a key that says nothing about
// them (a note, a search term, an error detail). Key-based rules cannot see these.

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
// HTTP authorization values written as text. Scheme names are case-insensitive (RFC 9110), any value length
// counts ("Basic dTpw" is u:p). Token schemes carry one token68 value; parameter schemes (Digest, OAuth,
// AWS4-HMAC-SHA256, SCRAM…) carry name="value" lists, so everything after the scheme to the end of the line
// is withheld. "Token" (not a registered scheme, but common: "Authorization: Token …") only as written.
// Over-redaction ("a basic setup" → "a basic [REDACTED]") is the accepted price in a log.
const AUTH_TOKEN_SCHEME = /\b(bearer|basic|negotiate|ntlm)\s+[^\s,;"']+/gi;
const AUTH_PARAM_SCHEME =
  /\b(digest|oauth|aws4-hmac-sha256|scram-sha-1|scram-sha-256|hoba|mutual|vapid)\s+[^\r\n]+/gi;
const TOKEN_SCHEME = /\b(Token)\s+[^\s,;"']+/g;
const JWT_IN_TEXT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
// The value is a whole quoted string ("two words", 'two words') or, unquoted, everything up to the next
// separator; the name may itself be quoted, as in JSON text ("password": "…").
const CREDENTIAL_ASSIGNMENT =
  /\b([\w.-]*?(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|session[_-]?id|session|authorization|cookie|signature)|sid|pwd|pin|otp)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&",;']+)/gi;

function scrubCredentialsInText(text: string): string {
  return text
    .replace(AUTH_PARAM_SCHEME, `$1 ${REDACTED}`)
    .replace(AUTH_TOKEN_SCHEME, `$1 ${REDACTED}`)
    .replace(TOKEN_SCHEME, `$1 ${REDACTED}`)
    .replace(JWT_IN_TEXT, REDACTED)
    .replace(CREDENTIAL_ASSIGNMENT, `$1$2${REDACTED}`);
}

// Digits may be ASCII or Arabic-Indic (an Arabic-first app: "اتصل على ٥٠٠١ ٢٣٤٥"). The country code may be
// written +965, 00965, (+965) or bare 965 ("96550012345", the normalized form without the plus).
const KUWAIT_LOCAL_PHONE =
  /(?<![\w٠-٩۰-۹+-])(?:\(?(?:\+|00|٠٠|۰۰)?(?:965|٩٦٥|۹۶۵)\)?[\s-]?)?[24569٢٤٥٦٩۲۴۵۶۹][0-9٠-٩۰-۹]{3}[\s-]?[0-9٠-٩۰-۹]{4}(?![\w٠-٩۰-۹-])/g;

/**
 * Replaces credentials and civil IDs written inside a string — in every mode, logs and audit alike.
 *
 * @param text any string value
 * @returns the text with every credential and civil ID replaced
 */
export function scrubSecretsInText(text: string): string {
  return scrubCredentialsInText(text).replace(CIVIL_ID_IN_TEXT, REDACTED);
}

/**
 * Reduces every phone number written inside a string to its last 3 digits (log mode only).
 *
 * @param text any string value
 * @returns the text with every phone number masked
 */
export function maskPhonesInText(text: string): string {
  return text
    .replace(/\+[1-9١-٩۱-۹][0-9٠-٩۰-۹]{7,14}/g, maskPhone)
    .replace(KUWAIT_LOCAL_PHONE, maskPhone);
}
