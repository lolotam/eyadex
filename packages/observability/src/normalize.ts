// A string value is normalised before it is scanned. Two reasons, both about obfuscation:
// NFKC folds full-width and compatibility characters, so "５００１２３４５" is the same value as
// "50012345"; and zero-width/bidi controls are invisible when rendered but break every digit regex
// ("5001\u200D2345" reads as a phone number but is not one to a scanner). The original string is kept
// whenever no rule matched (see redaction.ts), so an ordinary value that merely contains a control is
// not rewritten.
const INVISIBLE_CONTROLS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/**
 * The single normalisation used by every value scanner.
 *
 * @param value any string about to be scanned
 * @returns the value with compatibility characters folded and invisible controls removed
 */
export const normalizeValue = (value: string): string =>
  value.normalize("NFKC").replace(INVISIBLE_CONTROLS, "");
