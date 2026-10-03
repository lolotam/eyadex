import { REDACTED } from "./masks.ts";

// An email address is an identifier even in a technical log, and it must be caught whatever key holds it
// (a note, a provider detail, a search term). The local part and the domain use \p{L}\p{N} so an Arabic
// local part or an IDN domain is not invisible. The local part must START with a letter or digit: after URL
// scrubbing a userinfo is "***@host", and the "***" must not be mistaken for an address.
const EMAIL =
  /[\p{L}\p{N}][\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]*@[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)+/gu;

/**
 * Replaces every email address written inside a string. A cheap `@` check skips the scan for text that
 * cannot hold an address, so the regex never runs over ordinary prose.
 *
 * @param text a string value
 * @returns the text with every address replaced
 */
export const redactEmails = (text: string): string =>
  text.includes("@") ? text.replace(EMAIL, REDACTED) : text;
