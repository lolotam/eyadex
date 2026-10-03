import { REDACTED } from "./masks.ts";

// An email address is an identifier even in a technical log, and it must be caught whatever key holds it
// (a note, a provider detail, a search term). The local part and the domain use \p{L}\p{N} so an Arabic
// local part or an IDN domain is not invisible. The local part must START with a letter or digit: after URL
// scrubbing a userinfo is "***@host", and the "***" must not be mistaken for an address.
//
// The scan is anchored on each "@" instead of on every start position. A single regex had to try a local
// part at every character: unbounded it cost ~3 s on 64 KB of word characters before a lone "@", bounded
// to 64 it still cost ~100 ms on 64 KB of "ب." (each start re-read the next 64 characters), and a guard
// against starting inside a run also stopped "-ali@" and "+ali@" from being masked. From an "@" the local
// part is read backwards at most MAX_LOCAL characters and never past the previous "@", so the whole pass is
// linear in the length of the text.
const MAX_LOCAL = 255;
const LOCAL_CHAR = /[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]/u;
const LOCAL_START = /[\p{L}\p{N}]/u;
// Each label is capped at 63 characters (RFC 1035) and a label count above 15 is not an address.
const LABEL = "[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?";
const DOMAIN = new RegExp(`${LABEL}(?:\\.${LABEL}){1,15}`, "uy");

/** The start of the local part that ends just before `at`, or -1 when there is none. */
function localPartStart(text: string, at: number): number {
  let start = at;
  while (start > 0 && at - start < MAX_LOCAL && LOCAL_CHAR.test(text.charAt(start - 1))) start -= 1;
  // Leading punctuation ("-ali", "+ali", "***") is not part of the address; it must open with a letter or
  // digit, which also keeps a scrubbed "***@host" userinfo from matching.
  while (start < at && !LOCAL_START.test(text.charAt(start))) start += 1;
  return start < at ? start : -1;
}

/**
 * Replaces every email address written inside a string. A cheap `@` check skips the scan for text that
 * cannot hold an address, so ordinary prose costs nothing.
 *
 * @param text a string value
 * @returns the text with every address replaced
 */
export function redactEmails(text: string): string {
  if (!text.includes("@")) return text;
  let out = "";
  let last = 0;
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    if (at < last) continue;
    const start = localPartStart(text, at);
    if (start < last || start === -1) continue;
    DOMAIN.lastIndex = at + 1;
    const domain = DOMAIN.exec(text);
    if (domain === null) continue;
    out += text.slice(last, start) + REDACTED;
    last = at + 1 + domain[0].length;
  }
  return out + text.slice(last);
}
