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

// Audit text is stricter than a log value: every format (Cf) and control (Cc) character goes, not only
// the zero-width/bidi set above. A log keeps a value unchanged when no rule matched, so it scans with the
// narrow set; an audit string is always rewritten (it is stored append-only and shown to people), so a
// soft hyphen, a C0 control or any other invisible character between digits must never split a number.
const CONTROL_SPACE = /[\t\n\r\v\f]/g;
const AUDIT_INVISIBLE = /[\p{Cf}\p{Cc}]/gu;

/**
 * One shape for audit text, on write and on read: tabs and line breaks become spaces, every invisible
 * format/control character is removed (before and after NFKC, so neither order can hide one), NFKC folds
 * full-width and styled digits, and Arabic-Indic / Eastern Arabic-Indic digits become ASCII.
 *
 * @param text the text as stored or typed (a name, a search term)
 * @returns the normalised text
 */
export const normalizeAuditText = (text: string): string =>
  text
    .replace(CONTROL_SPACE, " ")
    .replace(AUDIT_INVISIBLE, "")
    .normalize("NFKC")
    .replace(AUDIT_INVISIBLE, "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
