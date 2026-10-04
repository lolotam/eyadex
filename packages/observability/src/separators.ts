// The explicit separators between a credential name and its value, shared by the English and the Arabic
// free-text scanners so a value after `password -> x` and after `كلمة المرور ← x` is treated alike:
// `:`/`=` runs, ASCII arrows both ways, and runs of dashes (U+2010–U+2015 included), bars and the arrow
// characters (← → ⇐ ⇒). A run is at most three characters, so the pattern is constant-cost.

/** The separator alternatives as a regex source fragment (no group, no flags). */
export const SEPARATOR_PATTERN =
  "(?:[:=]{1,3}|->|=>|<-|<=|[\\-\\u2010-\\u2015|\\u2190\\u2192\\u21D0\\u21D2]{1,3})";

/** A whole word that is only a separator (`-`, `->`, `—`, `|`, `←`…). */
export const SEPARATOR_WORD = new RegExp(`^${SEPARATOR_PATTERN}$`, "u");
