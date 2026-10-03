import { TOKEN_PREFIX } from "./credential-words.ts";
import { REDACTED } from "./masks.ts";

// URLs are checked in every string value, because their key (DATABASE_URL, url, link) looks harmless. An
// absolute URL is PARSED, not pattern-matched: the parser knows that the last "@" before the host ends the
// userinfo (a password may contain "@"). A relative reference has no parser, so it is walked segment by
// segment. Only what cannot carry a credential survives.

const URL_START = /^\s*[a-z][a-z0-9+.-]*:\/\//i;
// A scheme is at most 15 characters; leaving the class unbounded made the scan quadratic, because the
// engine consumed a long dotted run at every start position before backtracking to look for "://".
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]{0,15}:\/\/[^\s"'<>]+/gi;
// A relative reference: a path, a protocol-relative path, or a bare query string (a reset link in a log).
const RELATIVE_START = /^\s*(?:\/\/|\/|\?)/;
// The same reference EMBEDDED in free text: the slash/`?` must start a token (after whitespace, a quote, a
// bracket or the string start), so "and/or", "3/4", "km/h" and "03/10/2026" stay readable.
const RELATIVE_IN_TEXT = /(?<=^|[\s"'([])(?:\/\/|\/|\?)[^\s"'<>)\]]*/g;
// A cheap pre-check so the relative pass is skipped on text with no slash or query at all.
const RELATIVE_HINT = /[/?]/;
// A URL whose authority carries a ":" but no "@" is a userinfo whose "@host" was split off by whitespace
// (`user:pa ss@host`): the scanner saw only `scheme://user:pa`, so scrubbing that token would leave the
// password's other half readable. A numeric tail is a port, not a split password, so it is not flagged.
const isSplitUserinfo = (candidate: string): boolean => {
  const scheme = candidate.indexOf("://");
  if (scheme === -1) return false;
  const authority = candidate.slice(scheme + 3).split(/[/?#\s]/, 1)[0] ?? "";
  const colon = authority.indexOf(":");
  if (colon === -1 || authority.includes("@")) return false;
  return !/^\d+$/.test(authority.slice(colon + 1));
};
// A segment is opaque when no human wrote it: a provider token prefix, a numeric code of six digits or more
// (an OTP or invite code in a path), a long random segment, or a digit-and-letter mix long enough to be an
// id. Route placeholders (`:token`, `:id`) are not opaque.
const isOpaqueSegment = (segment: string): boolean => {
  if (segment === "" || segment.startsWith(":")) return false;
  if (TOKEN_PREFIX.test(segment)) return true;
  if (/^\p{Nd}{6,}$/u.test(segment)) return true;
  if (segment.length >= 16) return true;
  return segment.length >= 10 && /\p{Nd}/u.test(segment) && /\p{L}/u.test(segment);
};

// Labels are judged one by one: a whole hostname is often 16+ characters (`hooks.example.org`) and would
// trip the length rule. That loses the signal of a token spread over several subdomains, so two or more
// labels of 6+ characters mixing letters and digits (`abcd1234.efgh5678.example.com`) also make the host
// opaque, while `api-v2.example.org` or `s3.eu-west-1.amazonaws.com` stay readable.
const isOpaqueHost = (hostname: string): boolean => {
  const labels = hostname.split(".");
  const mixed = labels.filter(
    (label) => label.length >= 6 && /\p{Nd}/u.test(label) && /\p{L}/u.test(label),
  );
  return labels.some(isOpaqueSegment) || mixed.length >= 2;
};

// The authority of a scheme-relative reference ("//user:pw@localhost") gets the same treatment as a parsed
// URL's: userinfo becomes "***@" (everything up to the LAST "@", as a parser reads it) and an opaque host is
// withheld. Copying it verbatim kept the password whenever the host had no dot for the email rule to see.
function scrubAuthority(authority: string): string {
  const at = authority.lastIndexOf("@");
  const userinfo = at === -1 ? "" : "***@";
  const hostPort = authority.slice(at === -1 ? 2 : at + 1);
  const host = hostPort.replace(/:\d*$/, "");
  return `//${userinfo}${isOpaqueHost(host) ? REDACTED : hostPort}`;
}

// An absolute URL keeps scheme, host and port. Userinfo, path, query and fragment are withheld: a reset
// link carries its token in the path, an OAuth callback in the fragment, an invitation a token in the
// query (even a bare `?token`), and no name or pattern tells those from harmless ones. A host that is
// itself opaque (a token label) is withheld too — the token must not survive in the host.
function scrubUrl(candidate: string): string {
  try {
    const url = new URL(candidate);
    const userinfo = url.username !== "" || url.password !== "" ? "***@" : "";
    const host = isOpaqueHost(url.hostname) ? REDACTED : url.host;
    const path = url.pathname === "" || url.pathname === "/" ? url.pathname : "/[REDACTED]";
    const query = url.search === "" ? "" : "?[REDACTED]";
    const fragment = url.hash === "" ? "" : "#[REDACTED]";
    return `${url.protocol}//${userinfo}${host}${path}${query}${fragment}`;
  } catch {
    // Unparseable: no pattern can tell where its userinfo ends, so only the scheme survives.
    return candidate.replace(/^(\s*[a-z][a-z0-9+.-]*:\/\/)[\s\S]*$/i, "$1[REDACTED]");
  }
}

// A relative reference. Query and fragment are always withheld. Ordinary segments are kept so
// "/v1/health", "/clinic/patients" and "/invite/:token" stay readable; an opaque segment, or — under a
// URL-named key — everything after the first segment, is replaced.
function scrubRelative(candidate: string, urlKey: boolean): string {
  const lead = /^\s*/.exec(candidate)?.[0] ?? "";
  let rest = candidate.slice(lead.length);
  let suffix = "";
  const hash = rest.indexOf("#");
  if (hash !== -1) {
    suffix = "#[REDACTED]";
    rest = rest.slice(0, hash);
  }
  const query = rest.indexOf("?");
  if (query !== -1) {
    suffix = `?[REDACTED]${suffix}`;
    rest = rest.slice(0, query);
  }
  if (rest === "" || rest === "/") return `${lead}${rest}${suffix}`;
  let authority = "";
  let path = rest;
  if (rest.startsWith("//")) {
    const slash = rest.indexOf("/", 2);
    authority = scrubAuthority(slash === -1 ? rest : rest.slice(0, slash));
    path = slash === -1 ? "" : rest.slice(slash);
  }
  const segments = path.replace(/^\//, "").split("/");
  const mapped = segments.map((segment, index) =>
    ((urlKey && index > 0) || isOpaqueSegment(segment)) && segment !== "" ? REDACTED : segment,
  );
  const joined = `${authority}${path.startsWith("/") ? "/" : ""}${mapped.join("/")}`;
  return `${lead}${joined}${suffix}`;
}

/**
 * Replaces the credentials a URL can carry. An absolute URL is parsed; a relative reference is walked —
 * as the whole value or embedded in free text; an unparseable URL keeps nothing after its scheme.
 *
 * @param text    a string value
 * @param urlKey  whether the value sits under a URL-named key (path after the first segment is withheld)
 * @returns the text with URL credentials removed
 */
export function scrubUrlCredentials(text: string, urlKey: boolean): string {
  if (URL_START.test(text)) return scrubUrl(text.trim());
  if (!text.includes("://") && !RELATIVE_HINT.test(text)) return text;
  // A value may BOTH start with a relative reference and contain an absolute URL. Returning after the
  // relative pass skipped the absolute pass, so `/x https://u:pw@host` leaked its userinfo in both modes.
  const withRelatives = RELATIVE_START.test(text)
    ? scrubRelative(text, urlKey)
    : text.replace(RELATIVE_IN_TEXT, (part) => scrubRelative(part, urlKey));
  if (!withRelatives.includes("://")) return withRelatives;
  // A split userinfo cannot be scrubbed token by token — its "@host" is in a later token — so the whole
  // value is withheld. A complete URL is scrubbed match by match, which leaves a separate email address
  // (a different token) readable instead of dragging the entire value down with it.
  const scan = new RegExp(URL_IN_TEXT.source, URL_IN_TEXT.flags);
  for (let match = scan.exec(withRelatives); match !== null; match = scan.exec(withRelatives)) {
    if (isSplitUserinfo(match[0])) return REDACTED;
  }
  return withRelatives.replace(URL_IN_TEXT, scrubUrl);
}
