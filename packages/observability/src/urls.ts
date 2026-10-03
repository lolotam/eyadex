import { TOKEN_PREFIX } from "./credential-words.ts";
import { REDACTED } from "./masks.ts";

// URLs are checked in every string value, because their key (DATABASE_URL, url, link) looks harmless. An
// absolute URL is PARSED, not pattern-matched: the parser knows that the last "@" before the host ends the
// userinfo (a password may contain "@"). A relative reference has no parser, so it is walked segment by
// segment. Only what cannot carry a credential survives.

const URL_START = /^\s*[a-z][a-z0-9+.-]*:\/\//i;
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
// A relative reference: a path, a protocol-relative path, or a bare query string (a reset link in a log).
const RELATIVE_START = /^\s*(?:\/\/|\/|\?)/;
// The same reference EMBEDDED in free text: the slash/`?` must start a token (after whitespace, a quote, a
// bracket or the string start), so "and/or", "3/4", "km/h" and "03/10/2026" stay readable.
const RELATIVE_IN_TEXT = /(?<=^|[\s"'([])(?:\/\/|\/|\?)[^\s"'<>)\]]*/g;
// A cheap pre-check so the relative pass is skipped on text with no slash or query at all.
const RELATIVE_HINT = /[/?]/;
const AMBIGUOUS_USERINFO = /:\/\/[\s\S]*@/;
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

// An absolute URL keeps scheme, host and port. Userinfo, path, query and fragment are withheld: a reset
// link carries its token in the path, an OAuth callback in the fragment, an invitation a token in the
// query (even a bare `?token`), and no name or pattern tells those from harmless ones. A host that is
// itself opaque (a token label) is withheld too — the token must not survive in the host.
function scrubUrl(candidate: string): string {
  try {
    const url = new URL(candidate);
    const userinfo = url.username !== "" || url.password !== "" ? "***@" : "";
    const host = isOpaqueSegment(url.hostname) ? REDACTED : url.host;
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
    authority = slash === -1 ? rest : rest.slice(0, slash);
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
  if (RELATIVE_START.test(text)) return scrubRelative(text, urlKey);
  if (!text.includes("://") && !RELATIVE_HINT.test(text)) return text;
  const withRelatives = text.replace(RELATIVE_IN_TEXT, (part) => scrubRelative(part, urlKey));
  const scrubbed = withRelatives.replace(URL_IN_TEXT, scrubUrl);
  return AMBIGUOUS_USERINFO.test(scrubbed.replaceAll("://***@", "://")) ? REDACTED : scrubbed;
}
