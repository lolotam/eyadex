import { redactArabicCredentials } from "./arabic-credentials.ts";
import {
  isFreeTextCredentialName,
  looksLikeCredentialValue,
  TOKEN_PREFIX_PATTERN,
} from "./credential-words.ts";
import { maskPhone, REDACTED } from "./masks.ts";
import { opensQuote, valueEnd } from "./quotes.ts";
import { redactSeparatedPairs } from "./separators.ts";

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
// value is a secret here exactly as it is in a URL segment and under a `…code` key. The whole pattern is
// case-insensitive and the token-prefix alternative has NO leading `\b`: after one percent-decode a prefix
// can follow a word character ("%252Finvite%252Ftok_live_…" → "…Ftok_live_…"), where `\b` would fail. The
// prefixes are specific enough (`tok_`/`inv_` followed by six or more token characters) that ordinary words
// — `stock_level`, `invoice_total`, `tokenizer` — do not match, so over-redaction stays narrow.
const PROVIDER_KEY = new RegExp(
  [
    "\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b",
    "\\bAIza[0-9A-Za-z_-]{35}\\b",
    "\\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{10,}\\b",
    "\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\\b",
    "\\bgithub_pat_[A-Za-z0-9_]{20,}\\b",
    "\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b",
    "\\bglpat-[A-Za-z0-9_-]{16,}\\b",
    `${TOKEN_PREFIX_PATTERN}[A-Za-z0-9_-]{6,}\\b`,
  ].join("|"),
  "gi",
);

// HTTP authorization values written as text. Scheme names are case-insensitive (RFC 9110), any value length
// counts ("Basic dTpw" is u:p). Parameter schemes carry name="value" lists, so everything after the scheme
// to the end of the line is withheld. Over-redaction ("a basic setup") is the accepted price in a log.
const AUTH_TOKEN_SCHEME = /\b(bearer|basic|negotiate|ntlm)\s+[^\s,;"']+/gi;
const AUTH_PARAM_SCHEME =
  /\b(digest|oauth|aws4-hmac-sha256|scram-sha-1|scram-sha-256|hoba|mutual|vapid)\s+[^\r\n]+/gi;
// `Token x` (DRF and similar). Case-insensitive like the other schemes ("TOKEN abc" is a credential), but a
// lower-case "token" is also an ordinary English word, so there the value must itself look like one — "the
// token expired" stays readable.
const TOKEN_SCHEME = /\b(token)\s+([^\s,;"']+)/gi;
const JWT_IN_TEXT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

// CLI flags. Only the flags a runbook actually uses; a bare "-p" is too broad and is deliberately absent.
const CLI_CREDENTIAL = /(--?(?:password|passwd|pwd|token|secret|api-?key)\s+)(\S+)/gi;
// `name=value` / `name: value`, including escaped JSON (`{\"password\":\"x\"}`) and metadata names
// (`"passwordValue":"x"`). The name is classified with the SAME credential vocabulary as a property key.
// The name is anchored at a token boundary and its quantifier is lazy and bounded `{1,200}`, so a long name
// (`password_…=x`) is seen whole while the scan stays linear; a name over 200 characters is an accepted
// risk (see docs/adr/0001-log-redaction.md). An unquoted value also stops at the next ":" or "=": a
// non-credential name re-reads its value as a possible name ("note: password=x"), and a value that ran to the
// end of "a=a=a=…" made every re-read rescan the tail (quadratic, ~1 s on 64 KB). A credential value is
// extended to its delimiter afterwards, so "token=YWJj==" is still withheld whole.
// The separator is any run of ":"/"=", optionally broken by whitespace ("password====x", "token: ==x",
// "password:\n=x"). Each repetition REQUIRES whitespace before its ":"/"=" run, so a run can be split only
// one way: `[:=]+[:=]*` (two adjacent overlapping classes) made 63 KB of ":" take 13 s, and a bound like
// {1,3} leaked "====".
const ASSIGNMENT =
  /(?<![\w.-])([\w.-]{1,200}?)(\\?["']?\s*[:=]+(?:\s+[:=]+)*\s*)(\\?["']|[^\s&",;':=]+)/g;
// ASSIGNMENT's value is only the OPENING quote, never a whole quoted string: the shared quote scanner
// (quotes.ts) finds the end, closed or not (`password: "x` fails closed to the end of the text). A regex
// body `\\?"(?:\\.|[^"\\])*\\?"` let `\"` pairs run to the end of the text from every name — quadratic,
// ~500 ms on 64 KB of `a: \"` — and could pair `\"` with a bare `"`.
// A bare credential word followed by a quoted value and no separator: `password 'hunter two' rejected`.
// The value is consumed whole, so a multi-word secret does not leave its tail behind. The name may be
// quoted itself (`"password" 'x'`), as in ASSIGNMENT.
const QUOTED_CREDENTIAL =
  /(?<![\w.-])([\w.-]{1,200}?)\\?["']?\s+('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g;
// Prose: "password is x", "token was x". The verb list is finite on purpose — "the token expired" has no
// assignment and must stay. The value runs to the end of the LINE, not the clause: a status word before a
// comma ("password is invalid, hunter2") would otherwise free the clause while the secret sat after it.
// Only the name and the verb are matched; the value is read by hand (see redactProse).
const PROSE_HEAD = /(?<![\w.-])([\w.-]{1,200}?)\s+(is|was|[=:])\s+(?=[^\r\n])/gi;
const LINE_END = /[\r\n]/g;
// The mirror shape: "the token abcdef123 is used". Only a credential name before the value keeps this
// from eating ordinary prose.
const PROSE_VALUE_THEN_VERB = /(?<![\w.-])([\w.-]{1,200}?)\s+(\S+)\s+(is|was)\b/gi;
// A bare credential word followed by its value and no separator, quote or verb: `password hunter2
// rejected`. The value must itself look like a credential, so "password reset requested" stays readable.
// Scanned by hand rather than with one `replace`: a regex would consume `the password` under the
// non-credential name `the` and never re-read `password` as the name, leaking the value after it.
const BARE_CREDENTIAL = /(?<![\w.-])([\w.-]{1,200}?)\\?["']?\s+([^\s,;]+)/g;

const redactTokenScheme = (match: string, scheme: string, value: string): string =>
  scheme !== "token" || looksLikeCredentialValue(value) ? `${scheme} ${REDACTED}` : match;

// An unquoted value after a credential name is withheld up to the next pair delimiter, not the next space:
// "password: correct horse battery staple" must not keep "horse battery staple". Failing closed on the rest
// of the clause is the accepted price ("token=x user=bob" loses "user=bob").
const PAIR_END = /[&,;\r\n]/g;
function redactAssignments(text: string): string {
  let out = "";
  let last = 0;
  ASSIGNMENT.lastIndex = 0;
  for (let match = ASSIGNMENT.exec(text); match !== null; match = ASSIGNMENT.exec(text)) {
    // The three groups are guaranteed by the pattern; the defaults satisfy the checker.
    const name = match[1] ?? "";
    const separator = match[2] ?? "";
    const value = match[3] ?? "";
    if (!isFreeTextCredentialName(name)) {
      // Re-read the value: in "note: password=hunter2" it is itself a credential assignment.
      ASSIGNMENT.lastIndex = match.index + name.length + separator.length;
      continue;
    }
    let end = match.index + match[0].length;
    if (opensQuote(value, 0)) {
      // Any quoted value — ASCII, escaped (`\"…\"`), backtick or typographic, closed or not — ends at ITS
      // closing quote, found by the shared scanner: the regex alone can pair `\"` with a bare `"`
      // (`password: \"abc"hunter2\"`) or not close at all (`password: "x`).
      end = valueEnd(text, end - value.length);
    } else {
      PAIR_END.lastIndex = end;
      end = PAIR_END.exec(text)?.index ?? text.length;
    }
    ASSIGNMENT.lastIndex = end;
    out += text.slice(last, match.index) + `${name}${separator}${REDACTED}`;
    last = end;
  }
  return out + text.slice(last);
}
// Everything before the value is kept as written (a quoted name keeps its closing quote).
const redactQuoted = (match: string, name: string, value: string): string =>
  isFreeTextCredentialName(name) ? match.slice(0, match.length - value.length) + REDACTED : match;
// After "is"/"was" the safe direction is the opposite one: the value is withheld unless EVERY word of the
// clause is a status word. Requiring it to LOOK like a credential kept `password is swordfish` readable — a
// lone dictionary word is exactly what a weak password is — and checking only the first word kept
// `password is invalid, hunter2`. A password made only of these words is the accepted price (ADR risk 13).
const STATUS_WORDS = new Set(
  "invalid valid expired revoked missing required incorrect correct wrong empty blank null undefined not too set unset reset changed updated rotated accepted rejected disabled enabled locked unlocked present absent malformed weak strong short long used unused active inactive pending ok none being still already now".split(
    " ",
  ),
);
// Word by word, stopping at the first non-status word, so rejecting a long clause costs almost nothing.
const WORD = /\S+/g;
// Reads text[start, end) in place: copying the rest of a long line for every head would be quadratic.
const isStatusClause = (text: string, start: number, end: number): boolean => {
  WORD.lastIndex = start;
  let words = 0;
  for (let word = WORD.exec(text); word !== null && word.index < end; word = WORD.exec(text)) {
    if (!STATUS_WORDS.has(word[0].toLowerCase().replace(/[^\p{L}]/gu, ""))) return false;
    words++;
  }
  return words > 0;
};
// Scanned by hand like the assignments: a non-credential head must not swallow the rest of the line —
// "status is ok password is hunter2" re-anchors just past `status` and reads "password is …" next.
function redactProse(text: string): string {
  let out = "";
  let last = 0;
  // The end of the current line, found once per line: searching it again for every head on a long line
  // ("a is a is …") would be quadratic.
  let lineEnd = -1;
  PROSE_HEAD.lastIndex = 0;
  for (let match = PROSE_HEAD.exec(text); match !== null; match = PROSE_HEAD.exec(text)) {
    // The two groups are guaranteed by the pattern; the defaults satisfy the checker.
    const name = match[1] ?? "";
    const verb = match[2] ?? "";
    if (!isFreeTextCredentialName(name)) {
      PROSE_HEAD.lastIndex = match.index + name.length;
      continue;
    }
    const start = match.index + match[0].length;
    if (lineEnd < start) {
      LINE_END.lastIndex = start;
      lineEnd = LINE_END.exec(text)?.index ?? text.length;
    }
    const end = lineEnd;
    if (isStatusClause(text, start, end)) {
      PROSE_HEAD.lastIndex = match.index + name.length;
      continue;
    }
    out += text.slice(last, match.index) + `${name} ${verb} ${REDACTED}`;
    last = end;
    PROSE_HEAD.lastIndex = end;
  }
  return out + text.slice(last);
}
const redactProseMirror = (_match: string, name: string, value: string, verb: string): string =>
  isFreeTextCredentialName(name) && looksLikeCredentialValue(value)
    ? `${name} ${REDACTED} ${verb}`
    : _match;

// The first non-space character after the separator, on the same line (sticky: no scan past spaces).
function redactBareCredentials(text: string): string {
  let out = "";
  let last = 0;
  BARE_CREDENTIAL.lastIndex = 0;
  for (let match = BARE_CREDENTIAL.exec(text); match !== null; match = BARE_CREDENTIAL.exec(text)) {
    // The two groups are guaranteed by the pattern; the defaults satisfy the checker.
    const name = match[1] ?? "";
    const value = match[2] ?? "";
    // A typographic quote (`password «hunter two»`) is withheld whole like an ASCII one (QUOTED_CREDENTIAL).
    const valueStart = match.index + match[0].length - value.length;
    if (opensQuote(text, valueStart) && isFreeTextCredentialName(name)) {
      const end = valueEnd(text, valueStart);
      out += text.slice(last, valueStart) + REDACTED;
      last = end;
      BARE_CREDENTIAL.lastIndex = end;
      continue;
    }
    if (!isFreeTextCredentialName(name) || !looksLikeCredentialValue(value)) {
      // Re-anchor just past the name so the value word can still be read as a name.
      BARE_CREDENTIAL.lastIndex = match.index + name.length;
      continue;
    }
    out += text.slice(last, match.index + match[0].length - value.length) + REDACTED;
    last = match.index + match[0].length;
  }
  return out + text.slice(last);
}

function scrubCredentialsInText(text: string): string {
  const scrubbed = text
    .replace(PEM_BLOCK, REDACTED)
    .replace(PROVIDER_KEY, REDACTED)
    .replace(AUTH_PARAM_SCHEME, `$1 ${REDACTED}`)
    .replace(AUTH_TOKEN_SCHEME, `$1 ${REDACTED}`)
    .replace(TOKEN_SCHEME, redactTokenScheme)
    .replace(JWT_IN_TEXT, REDACTED)
    .replace(CLI_CREDENTIAL, `$1${REDACTED}`);
  const paired = redactProse(
    redactAssignments(scrubbed).replace(QUOTED_CREDENTIAL, redactQuoted),
  ).replace(PROSE_VALUE_THEN_VERB, redactProseMirror);
  // The separator-less rule runs after the pairs: a pair already redacted must not be re-read. Arabic
  // labels have their own scanner, since `\w` cannot see them.
  return redactArabicCredentials(redactBareCredentials(redactSeparatedPairs(paired)));
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
