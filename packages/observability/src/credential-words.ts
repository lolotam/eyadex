// The shared credential vocabulary. Kept in one module so the key rule and the free-text `name=value` rule
// reuse the SAME words: two lists that disagree (the earlier suffix list and the free-text name list did) are
// exactly how a `passwordValue` or a `…TokenHeader` slips through. The matching mode differs by list length
// on purpose (see isSecretKey).

/**
 * NFKC folds full-width and compatibility characters; case and separators are dropped so accessToken,
 * access_token and ACCESS-TOKEN are one key. Unicode letters/digits survive so an Arabic key is not
 * flattened to the empty string — the non-ASCII rule needs to see that it is non-ASCII.
 */
export const foldKey = (key: string): string =>
  key
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

// Long words are matched ANYWHERE in the key: a credential is rarely the last word once metadata is
// appended (passwordValue, tokenHeader, privateKeyPem, accessKeyId). "codemac" is a code-signing MAC.
const LONG_CREDENTIAL_WORDS = [
  "password",
  "passwd",
  "passphrase",
  "token",
  "secret",
  "apikey",
  "privatekey",
  "signingkey",
  "accesskey",
  "credential",
  "authorization",
  "cookie",
  "signature",
  "pem",
  // A certificate (or its PEM) is a credential-shaped secret; "cert" alone would collide with "certain".
  "certificate",
  "hmac",
  "csrf",
  "xsrf",
  "otp",
  "cvv",
  "cvc",
  "dsn",
  "connectionstring",
  "session",
  "bearer",
  "salt",
  "nonce",
  "codemac",
] as const;

// Short words are far too common inside ordinary words to match by containment ("pin" in "pinned",
// "key" in "monkey"), so they count only as the whole key or as its suffix. A trailing metadata suffix is
// stripped first, so pinNumber, hashValue and sid still match without admitting "pinned". "hash" and
// "digest" are credential words, NOT metadata, so they are never stripped away.
const SHORT_CREDENTIAL_WORDS = [
  "pwd",
  "pass",
  "pin",
  "sig",
  "key",
  "hash",
  "digest",
  "checksum",
  "sid",
] as const;

// Metadata a caller appends to a credential field. Stripped before the short-word test only.
const METADATA_SUFFIXES = [
  "connectionstring",
  "base64",
  "encoded",
  "content",
  "number",
  "string",
  "header",
  "value",
  "plain",
  "blob",
  "data",
  "text",
  "raw",
  "enc",
  "b64",
  "id",
] as const;

// Structural names that end in "key" but name a position, not a credential. Exempt from the secret rule.
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
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

// A plural container ("passwords", "hashes") holds secrets under ordinary child keys, so the short-word
// test also tries the singular form of the key.
const wordForms = (folded: string): string[] => {
  const forms = [folded];
  if (folded.endsWith("es")) forms.push(folded.slice(0, -2));
  if (folded.endsWith("s")) forms.push(folded.slice(0, -1));
  return forms;
};
const isShortCredential = (folded: string): boolean =>
  SHORT_CREDENTIAL_WORDS.some((word) =>
    wordForms(folded).some((form) => form === word || form.endsWith(word)),
  );

// Every intermediate form is tested, not only the last one: the suffix list is a vocabulary that will grow,
// and a future suffix could itself end in a credential word. Testing each form fixes the word that
// identified the secret before a later strip can remove it.
const strippedForms = (folded: string): string[] => {
  const forms: string[] = [];
  let base = folded;
  for (;;) {
    forms.push(base);
    const suffix = METADATA_SUFFIXES.find(
      (candidate) => base.length > candidate.length && base.endsWith(candidate),
    );
    if (suffix === undefined) return forms;
    base = base.slice(0, -suffix.length);
  }
};

/**
 * A key names a credential when it contains a long credential word, or when it is / ends with a short one
 * (after stripping a metadata suffix). Structural names are exempt.
 *
 * @param key the property name
 * @returns whether the value under it must be replaced whole
 */
export const isSecretKey = (key: string): boolean => {
  const folded = foldKey(key);
  if (folded === "" || STRUCTURAL_KEYS.has(folded)) return false;
  if (LONG_CREDENTIAL_WORDS.some((word) => folded.includes(word))) return true;
  return strippedForms(folded).some(isShortCredential);
};

// The free-text `name=value` rule shares the vocabulary but not the matching mode: a long word may appear
// anywhere in the name ("passwordValue=…", "authorizationCode=…"), while a short one must be a whole word,
// or "spin=3" and "pinned: true" would be redacted.
export const isFreeTextCredentialName = (name: string): boolean => {
  const folded = foldKey(name);
  if (folded === "") return false;
  if (LONG_CREDENTIAL_WORDS.some((word) => folded.includes(word))) return true;
  return SHORT_CREDENTIAL_WORDS.some((word) => wordForms(folded).some((form) => form === word));
};

// The opaque-token prefixes our own links carry (invite, reset) and providers use. One list so a URL
// segment, a `…code` value and free text agree on what is opaque instead of drifting apart.
export const TOKEN_PREFIX_PATTERN = "(?:tok|inv)_";
export const TOKEN_PREFIX = new RegExp(`^${TOKEN_PREFIX_PATTERN}`, "i");
