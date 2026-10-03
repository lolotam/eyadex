# 0001 — Log and audit redaction

- **Status:** Accepted
- **Date:** 2026-10-03
- **Phase:** B (`packages/observability`)

## Context

`apps/api` and `apps/worker` log through one pino configuration, and the audit trail keeps before/after
snapshots of business records. Both paths must satisfy CLAUDE.md §5 and §8: no secret, token, password,
civil ID or full phone number in a log line, and no civil ID in an audit snapshot. The redaction helpers
(`redaction.ts`, `credential-words.ts`, `keys.ts`, `free-text.ts`, `urls.ts`, `emails.ts`, `masks.ts`) apply a
key-based walk plus free-text scanners.

An adversarial red-team against the built package found 16 bypass classes (suffix-only key matching, strings
scanned but numbers not, `scheme://`-only URLs, no PEM/provider/prose shapes, a throwing getter). A second
adversarial review found more: the free-text scanners were quadratic on a long value; `sex` had been dropped
from patient identity; a relative reference embedded in prose was never scanned; `hash`/`digest` were
stripped as metadata and leaked the credential hash; a quoted credential with no separator leaked whole and a
multi-word value leaked its tail; `tok_`/`inv_` were opaque in URLs but not in free text; non-Latin
credential keys were redacted in log mode only; a bare `name` printed a patient name; numeric path segments
and an opaque host survived; `codeMac` regressed to nothing; an own `__proto__` key vanished; and a repeated
sibling object was mislabelled `[Circular]`.

**The sanitiser is a defence-in-depth safety net, not the primary control.** The primary control is
structured logging: a finite event catalogue (`BASE_LOG_EVENTS` + each process's events), values passed in
named fields rather than interpolated messages, and allowlisted fields on the audit writer. The sanitiser
exists for the mistake that slips past the catalogue, so it must fail closed, must never throw, and must
stay linear on adversarial input.

## Decision

### Rules

1. **Credential keys.** A key is a credential when its NFKC-folded form (case and separators removed)
   _contains_ a long credential word — `password, passwd, passphrase, token, secret, apikey, privatekey,
signingkey, accesskey, credential, authorization, cookie, signature, pem, certificate, hmac, csrf, xsrf,
otp, cvv, cvc, dsn, connectionstring, session, bearer, salt, nonce, codemac` — or _is / ends with_ a short
   one after a metadata suffix (`value, raw, encoded, base64, header, id, number, …`) is stripped:
   `pwd, pass, pin, sig, key, hash, digest, checksum, sid`. `hash` and `digest` are credential words, **not**
   metadata, so they are never stripped away; every intermediate stripped form is tested, not only the last.
   Structural names (`sortKey`, `cacheKey`, `i18nKey`…) are exempt. The words live in `credential-words.ts`.
2. **Free-text credentials** (both modes). PEM/PGP/OpenSSH blocks (a lone `BEGIN` runs to end of string);
   provider key shapes (`AKIA`/`ASIA`, `AIza`, `sk_live_`/`rk_live_`, `ghp_`/`github_pat_`, `xox[baprs]-`,
   `glpat-`, and `tok_`/`inv_` — case-insensitive and with no leading `\b`, so a decoded
   `%252F…tok_…` still matches while `stock_level`/`invoice_total`/`tokenizer` do not); `name=value` /
   `name: value` pairs (including escaped JSON and metadata names) classified with the same credential
   vocabulary; a bare credential word followed by a quoted value (`password 'hunter two'`); CLI flags
   `--password/--token/--api-key/--secret`; a bare credential word followed by its value when the value
   itself looks like a credential (a digit, ≥16 characters, or a `tok_`/`inv_` prefix),
   e.g. `password hunter2`, `otp 482193`; and prose `password is x`, `token was x`, `token x is used`. The
   prose value runs to the end of the clause and is withheld unless every word of it is a status word
   (`STATUS_WORDS` in `free-text.ts`), so `token is invalid` stays and `password is invalid, hunter2` does not. The `name=value`
   rule shares the word list but uses whole-word matching for the short words, so `spin=3` survives. Every
   name quantifier is bounded and lazy (`{1,200}?`) and anchored at a token boundary, so the scan cannot go
   quadratic. A name longer than 200 characters is an accepted risk (§11).
3. **Patient identity** (log mode). A key containing `name, fullname, firstname, lastname, middlename,
familyname, givenname, patientname, clientname, customername, displayname, ownername, mothername,
fathername, spousename, contactname, emergencyname, doctorname, gender, sex, nationality, maritalstatus,
address, passport`, or the part `patient` (ids kept), is replaced whole. A bare `name` **is** redacted,
   with an explicit exemption for the technical spellings `routeName, eventName, filename, keyName,
serviceName, className, tableName, columnName, methodName, hostname, moduleName, jobName, queueName,
taskName, typeName, fieldName`, plus the business-entity spellings `clinicName, branchName,
organisationName, organizationName` (a clinic or a branch is not a patient); `displayName` is
   deliberately not exempt. A key that contains any non-ASCII letter (Arabic `اسم_العميل`, mixed
   `user_كلمة`) is replaced in **both** modes.
4. **Non-string values.** Finite numbers and bigints are scanned as their decimal string by the civil-ID and
   phone rules; a match replaces the value with the masked/`REDACTED` string, otherwise the value is kept.
5. **URLs and relative references.** An absolute URL keeps scheme, host and port; userinfo, path, query and
   fragment are withheld. The host is judged label by label (so `hooks.example.org` is kept) and is
   withheld when one label is opaque (`tok_`/`inv_`, ≥16 chars, a digit-and-letter mix ≥10) or two labels
   of ≥6 chars mix letters and digits (a token spread over subdomains). A relative reference is scanned as the whole value **or embedded in free text** (a slash or `?` that
   starts a token): query and fragment are always withheld; opaque path segments (a `tok_`/`inv_` prefix, a
   numeric code of ≥6 digits, ≥16 chars, or a digit-and-letter mix ≥10) are replaced; ordinary segments
   (`/v1/health`, `/clinic/patients`, `/invite/:token`) are kept, and ordinary prose with slashes
   (`and/or`, `3/4`, `km/h`, `03/10/2026`) is left alone. Under a URL-named key (`url, uri, link, href,
redirect, callback, returnto, next, location`) the whole path after the first segment is withheld. A value
   may both start with a relative reference and contain an absolute URL, so both passes run on it. An absolute
   URL whose authority carries a `:` but no `@` (a userinfo split by whitespace, `user:pa ss@host`) withholds
   the whole value rather than leave the password's other half readable; a complete URL is scrubbed match by
   match, so a separate email in the same value is not dragged down with it. Credentials run in both modes,
   so audit keeps no URL token.
6. **Unicode values.** Every string is NFKC-normalised and stripped of zero-width/bidi controls before
   scanning (full-width digits become ASCII); if nothing matched, the original string is kept unchanged.
7. **Phones.** Kuwaiti halves may be separated by space `.` `-` `/` and optional parentheses; a generic
   international number (`+` then 8–15 digits with those separators) is masked to its last 3 digits.
8. **Emails.** Unicode local parts and IDN domains. The scan is anchored on each `@`: the local part is
   read backwards (at most 255 characters, never past the previous `@`, leading punctuation such as `-ali`
   or `+ali` dropped) and the domain forwards, so the pass is linear; a cheap `@` check skips it when no
   address is possible, and a percent-encoded value is scanned after one guarded `decodeURIComponent`, with the
   decoded-and-redacted text emitted when a rule matches.
9. **Codes.** A key `code` or ending with `code` is redacted when the value holds a digit (any script) or is
   ≥10 chars, except the structural code keys (`statusCode, errorCode, countryCode, currencyCode,
languageCode, postalCode, zipCode, exitCode, httpCode, responseCode`) and snake_case-only values
   (`not_found`). A `tok_`/`inv_` value is always secret; the prefix list is shared with URLs and free text.
10. **Robustness.** A throwing property getter becomes `REDACTED`; `sanitize`/`redactSecrets` never throw —
    an unexpected failure returns `REDACTED`. Buffers/typed arrays become `REDACTED`; a `Map` is walked as an
    object (key rules on string keys); a `Set` is walked as an array. Output objects have a null prototype, so
    **`sanitize` keeps an own `__proto__` key as an ordinary key and walks it**: it returns
    `{ __proto__: { password: "[REDACTED]" }, note: "ok" }`. Through pino that key is **never printed** — the
    real line is `{"level":30,…,"note":"ok","msg":"log message withheld"}` (pino drops the `__proto__`
    property while serialising). `redaction-redteam-robustness.spec.ts` pins both the returned object and the
    written line. Only a true cycle (an object that is its own ancestor) becomes `[Circular]`; a repeated
    sibling is walked again, and anything deeper than the depth cap is `[Truncated]`.
11. **Length and cost.** A string value longer than 64 KB is replaced whole without being scanned. The
    scanners are linear — every quantifier is bounded — and `redaction-performance.spec.ts` pins the budget:
    100 KB adversarial inputs < 150 ms; a 16 KB realistic mixed string < 50 ms; a 64 KB word run followed by
    `@`, a 64 KB dotted run followed by `@`, and a 64 KB `password` run, Arabic run or Arabic dotted run followed by `@` (the email scanner);
    a 64 KB dotted run followed by `/`, a 100 KB word run followed by `://`, and a 64 KB dotted run
    followed by a separate URL (the URL scanner, which pins the bounded scheme), each
    < 150 ms; and one real 64 KB `logger.info` line < 300 ms in total.

### Two modes

- `sanitize` (log lines): all of the above, **plus** phones masked to their last 3 digits, emails replaced,
  patient identity replaced, and private payloads (`payload`, `providerBody`, `emailHtml`…) dropped.
- `redactSecrets` (audit snapshots): credentials, PEM, civil IDs, URL tokens and non-ASCII keys are replaced;
  names, emails and phones are kept by design, because the audit row is clinic-side and its fields are
  allowlisted at the writer.

## Consequences

- Over-redaction is the accepted direction: `sessionCount` (contains "session"), any key ending in `key`
  (`monkey`, `turkey`, `compass`, `bypass`), `sex` making `essex`-style keys dark, a bare name-containing key
  without the structural exemption (`username`, `nickname`), a legitimate 6-digit business `code` or 6-digit
  numeric path segment, `key=value` in free text, and `hashes` are redacted. A hidden field is cheaper than a
  leaked one.
- The credential words live in one vocabulary (`credential-words.ts`); the free-text rule and the key rule
  cannot drift apart again.
- Adding a new credential field is a vocabulary change, not a new rule — and the added tests must include a
  leak case, a leave-alone case, and (for a new scanner) a performance case.

### Accepted risks (documented, not implemented)

1. **Identity _values_ in free text.** Only keys classify identity: `note: "patient أحمد محمد"` keeps the
   name. Detecting person names in arbitrary prose needs a model, not a regex; callers must pass identity in
   named fields.
2. **Identifiers split across array items or sibling keys.** The walk is per value, so `["300040",
"112347"]` is never reassembled. Reassembling arbitrary fragments would over-redact ordinary numbers and
   is not worth the risk; callers must pass whole identifiers.
3. **Birth dates as plain dates under neutral keys.** A timestamp is everywhere in logs and cannot be
   treated as sensitive; a birth date is caught by key (`birth`, `dob`). `startedAt: "1990-01-01"` is not
   special.
4. **Audit snapshots keep names, emails and phones by design.** The clinic-side audit row is allowlisted at
   the writer; credentials, PEM, civil IDs, URL tokens and non-ASCII keys are still redacted there.
5. **An email with no dot in the domain** (`user@localhost`) is not matched: the EMAIL shape requires a
   dotted domain, because a bare `@word` is common in ordinary prose.
6. **A letter-only OTP under a `…code` key** (`pinCode: "abcdef"`) is not redacted: `isCodeSecretValue`
   needs a digit or ≥10 chars, or a known token prefix. A caller-generated OTP is numeric, so this is a
   residual gap for hand-written letter codes only.
7. **A non-Kuwaiti national ID in free text.** The free-text civil-ID rule knows only the Kuwaiti 12-digit
   shape (first digit 2 or 3); another country's ID under a neutral key is kept. A key named `civilId` or
   `nationalId` still redacts it.
8. **Local phone formats without a leading `+`.** Only Kuwaiti local numbers and `+`-prefixed international
   numbers are masked; a bare foreign local number (`call 5551234567`) is kept. A key named `phone`/`mobile`
   still masks it.
9. **Over-redaction is intentional** (see Consequences). The cost is a hidden field, never a leaked one.
10. **The 64 KB cap replaces a legitimate over-long value whole.** A log field has no business being larger
    than that; if one ever is, it is withheld rather than scanned.
11. **A free-text credential name longer than 200 characters.** The name quantifier is bounded and lazy
    (`{1,200}?`), so a 200-plus-character name (a long `password_…` prefix) is not classified and its value is
    kept. A key-based rule still redacts the same field, and the bound is what keeps the scan linear.
12. **`your code is 482193` survives.** The word `code` is deliberately not a credential word in prose, so
    `error code 404` stays readable; the price is that an OTP written after `code` is kept. **OTPs are never
    interpolated into a log message** — they arrive in a named `code`/`otp` field, where the key rule
    redacts them.
13. **A password made only of status words.** After `is`/`was` a clause is kept only when every word of
    it is in `STATUS_WORDS` (about 50 words — `invalid`, `expired`, `ok`, `not`, `set`, `none`, `weak`, … —
    listed in `free-text.ts`), so `token is invalid` and `password is too short` stay readable. The price:
    `password is ok` or `password is not` keeps a password that happens to be such a word. A named
    `password` field still redacts it.
14. **An email local part longer than 255 characters** keeps its leading characters: the backward read
    stops at 255 so the pass stays linear, and only the last 255 characters and the domain are withheld.
    No real address is that long.

### Deliberately not covered

Per the reviewed decision, no rule was added for a long base64 blob under a neutral `blob`/`data` key, for
`(at)`/`(dot)` email obfuscation, or for a raw Basic base64 value without its scheme. Each is broad enough to
over-redact ordinary data; the decision left them out rather than guess.
