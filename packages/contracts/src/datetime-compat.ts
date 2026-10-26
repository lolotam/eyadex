import { z } from "zod";

// Zod 3.25.76 `datetimeRegex` (v3/types.js:406-430), precision null, local false.
// Seconds stay optional. The offset alternative is `[+-]DD:?DD` with no clock range, so
// minute-only `Z`, compact `+0300`, and legacy `+24:00` / `+03:60` stay accepted unchanged.
// Zod 4.6.6 native datetime requires seconds and a ranged colon offset; that is not this contract.
const UTC_DATETIME =
  /^((\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\d|3[01])|(0[469]|11)-(0[1-9]|[12]\d|30)|(02)-(0[1-9]|1\d|2[0-8])))T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z)$/;

const OFFSET_DATETIME =
  /^((\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\d|3[01])|(0[469]|11)-(0[1-9]|[12]\d|30)|(02)-(0[1-9]|1\d|2[0-8])))T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|([+-]\d{2}:?\d{2}))$/;

const INVALID_DATETIME = "Invalid datetime";

/** UTC instant in the Zod 3.25.76 datetime shape. The parsed value is the original string. */
export function utcDatetime(): z.ZodString {
  return z.string().regex(UTC_DATETIME, INVALID_DATETIME);
}

/** Offset instant in the Zod 3.25.76 `datetime({ offset: true })` shape. Output is the input. */
export function offsetDatetime(): z.ZodString {
  return z.string().regex(OFFSET_DATETIME, INVALID_DATETIME);
}
