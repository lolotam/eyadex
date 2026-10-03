import { isFreeTextCredentialName, TOKEN_PREFIX_PATTERN } from "./credential-words.ts";
import { maskPhone, REDACTED } from "./masks.ts";

// Free text: identifiers and credentials written inside a string under a key that says nothing about them
// (a note, a search term, an error detail). Key-based rules cannot see these. Everything here receives an
// already-normalised string (NFKC + invisible controls removed) — see redaction.ts.

// All scanners share one digit class so a full-width or Arabic-Indic digit is a digit everywhere.
const D = "0-9\u0660-\u0669\u06F0-\u06F9\uFF10-\uFF19";
const SEP = "[\\s.\\-/()]*";

// A cryptographic block. The END line may be missing (a log line was cut off), in which case everything to
// the end of the string is withheld: the body is the secret.
const PEM_BLOCK = /-----BEGIN[^\n]*-----[\s\S]*?(?:-----END[^\n]*-----|$)/g;

// Well-known provider key shapes. They are matched by shape, not by entropy, so they cost nothing on
// ordinary text. The last alternative is built from the shared token-prefix vocabulary so a `tok_`/`inv_`
// value is a secret here exactly as it is in a URL segment and under a `…code` key.
const PROVIDER_KEY = new RegExp(
  [
    "\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b",
    "\\bAIza[0-9A-Za-z_-]{35}\\b",
    "\\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{10,}\\b",
    "\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\\b",
    "\\bgithub_pat_[A-Za-z0-9_]{20,}\\b",
    "\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b",
    "\\bglpat-[A-Za-z0-9_-]{16,}\\b",
    `\\b${TOKEN_PREFIX_PATTERN}[A-Za-z0-9_-]{6,}\\b`,
  ].join("|"),
  "g",
);

// HTTP authorization values written as text. Scheme names are case-insensitive (RFC 9110), any value length
// counts ("Basic dTpw" is u:p). Parameter schemes carry name="value" lists, so everything after the scheme
// to the end of the line is withheld. Over-redaction ("a basic setup") is the accepted price in a log.
const AUTH_TOKEN_SCHEME = /\b(bearer|basic|negotiate|ntlm)\s+[^\s,;"']+/gi;
const AUTH_PARAM_SCHEME =
  /\b(digest|oauth|aws4-hmac-sha256|scram-sha-1|scram-sha-256|hoba|mutual|vapid)\s+[^\r\n]+/gi;
const TOKEN_SCHEME = /\b(Token)\s+[^\s,;"']+/g;
const JWT_IN_TEXT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

// CLI flags. Only the flags a runbook actually uses; a bare "-p" is too broad and is deliberately absent.
const CLI_CREDENTIAL = /(--?(?:password|passwd|pwd|token|secret|api-?key)\s+)(\S+)/gi;
// `name=value` / `name: value`, including escaped JSON (`{\"password\":\"x\"}`) and metadata names
// (`"passwordValue":"x"`). The name is classified with the SAME credential vocabulary as a property key.
// {\w.-}{1,40} is bounded: the name cannot run to the end of the value, which made the scan quadratic.
const ASSIGNMENT =
  /([\w.-]{1,40})(\\?["']?\s*[:=]\s*)(\\?"(?:\\.|[^"\\])*\\?"|\\?'(?:\\.|[^'\\])*\\?'|[^\s&",;']+)/g;
// A bare credential word followed by a quoted value and no separator: `password 'hunter two' rejected`.
// The value is consumed whole, so a multi-word secret does not leave its tail behind.
const QUOTED_CREDENTIAL = /(\b[\w.-]{1,40})\s+('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g;
// Prose: "password is x", "token was x". The verb list is finite on purpose — "the token expired" has no
// assignment and must stay. The value runs to the end of the clause (`,`/`;`/line), so a multi-word tail is
// not left readable after the first word is replaced.
const PROSE_CREDENTIAL = /\b([\w.-]{1,40})\s+(is|was|[=:])\s+([^\r\n,;]+)/gi;
// The mirror shape: "the token abcdef123 is used". Only a credential name before the value keeps this
// from eating ordinary prose.
const PROSE_VALUE_THEN_VERB = /\b([\w.-]{1,40})\s+(\S+)\s+(is|was)\b/gi;

const redactPair = (_match: string, name: string, separator: string): string =>
  isFreeTextCredentialName(name) ? `${name}${separator}${REDACTED}` : _match;
const redactQuoted = (_match: string, name: string): string =>
  isFreeTextCredentialName(name) ? `${name} ${REDACTED}` : _match;
const redactProse = (_match: string, name: string, verb: string): string =>
  isFreeTextCredentialName(name) ? `${name} ${verb} ${REDACTED}` : _match;
const redactProseMirror = (_match: string, name: string, value: string, verb: string): string =>
  isFreeTextCredentialName(name) ? `${name} ${REDACTED} ${verb}` : _match;

function scrubCredentialsInText(text: string): string {
  return text
    .replace(PEM_BLOCK, REDACTED)
    .replace(PROVIDER_KEY, REDACTED)
    .replace(AUTH_PARAM_SCHEME, `$1 ${REDACTED}`)
    .replace(AUTH_TOKEN_SCHEME, `$1 ${REDACTED}`)
    .replace(TOKEN_SCHEME, `$1 ${REDACTED}`)
    .replace(JWT_IN_TEXT, REDACTED)
    .replace(CLI_CREDENTIAL, `$1${REDACTED}`)
    .replace(ASSIGNMENT, redactPair)
    .replace(QUOTED_CREDENTIAL, redactQuoted)
    .replace(PROSE_CREDENTIAL, redactProse)
    .replace(PROSE_VALUE_THEN_VERB, redactProseMirror);
}

// A civil ID written inside free text: 12 digits, any script, starting with the century digit 2 or 3,
// optionally split by spaces or dashes. Replaced whole, valid checksum or not — printing a civil ID breaks
// CLAUDE.md §5, and over-redacting a 12-digit reference costs nothing. Runs before phone masking, which
// would otherwise mask an 8-digit slice and leave the rest readable.
const CIVIL_ID_IN_TEXT = new RegExp(
  `(?<![\\w${D}-])[23\u0662\u0663\u06F2\u06F3](?:[\\s-]?[${D}]){11}(?![\\w${D}-])`,
  "g",
);

// A Kuwaiti number written by hand ("call 5001 2345", "(5001)2345", "965 5001-2345"): eight digits starting
// 2/4/5/6/9, optional +965/00965 and any of space . - / or parentheses between groups.
const KUWAIT_LOCAL_PHONE = new RegExp(
  `(?<![\\w${D}+-])(?:\\(?(?:\\+|00)?(?:965|\u0669\u0666\u0665|\u06F9\u06F6\u06F5)\\)?${SEP})?` +
    `\\(?[24569\u0662\u0664\u0665\u0666\u0669\u06F2\u06F4\u06F5\u06F6\u06F9][${D}]{3}${SEP}[${D}]{4}` +
    `(?![\\w${D}-])`,
  "g",
);
// A generic international number: "+" then 8–15 digits with the same separators. A number that resolves to
// at least 8 digits keeps only its last 3, whatever the country. An optional leading "(" keeps a bracketed
// country code ("(+965) …") whole instead of leaving a stray bracket behind.
const INTL_PHONE = new RegExp(`\\(?\\+[1-9\u0661-\u0669\u06F1-\u06F9](?:${SEP}[${D}]){7,14}`, "g");

/**
 * Replaces credentials, provider keys, PEM blocks and civil IDs written inside a string — in every mode,
 * logs and audit alike.
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
  return text.replace(INTL_PHONE, maskPhone).replace(KUWAIT_LOCAL_PHONE, maskPhone);
}
