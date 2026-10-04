import { describe, expect, it } from "vitest";

import { REDACTED, redactSecrets, sanitize } from "../redaction.ts";

// Post-merge Codex review of PR #16 and the PR #18 rounds: `\w` is ASCII-only, so an Arabic label never
// reached the `name=value` scanner. Every shape is asserted in BOTH modes (credentials are never audit data).
const both = (value: unknown): [unknown, unknown] => [sanitize(value), redactSecrets(value)];

describe("Arabic credential labels in free text", () => {
  it.each([
    ["كلمة المرور: hunter2", `كلمة المرور: ${REDACTED}`],
    ["كلمة السر=hunter2", `كلمة السر=${REDACTED}`],
    ["كلمه السر hunter2", `كلمه السر ${REDACTED}`],
    ["الرمز: 123456", `الرمز: ${REDACTED}`],
    ["رمز التحقق 482193 أرسل", `رمز التحقق ${REDACTED}`],
    ["الرقم السري: ٤٨٢١", `الرقم السري: ${REDACTED}`],
    ["كلمة المرور هي سر123", `كلمة المرور هي ${REDACTED}`],
    ["note: كلمة المرور hunter2", `note: كلمة المرور ${REDACTED}`],
    ["بكلمة المرور: abc def، والباقي", `بكلمة المرور: ${REDACTED}، والباقي`],
    ['المفتاح: "a, b" بعده', `المفتاح: ${REDACTED} بعده`],
    ["مفتاح API: sk-abc", `مفتاح API: ${REDACTED}`],
    ["التوكن=abc", `التوكن=${REDACTED}`],
    // Tatweel and harakat are decoration: the label is the same word.
    ["كلمـة المرور: hunter2", `كلمـة المرور: ${REDACTED}`],
    ["كَلِمَة المُرور: hunter2", `كَلِمَة المُرور: ${REDACTED}`],
    ["الرقم السرّي: 4821", `الرقم السرّي: ${REDACTED}`],
    // Round-2 review: two particles, a quoted phrase after a bare space, long mark runs, a glued value,
    // spelling variants.
    ["وبكلمة المرور: hunter2", `وبكلمة المرور: ${REDACTED}`],
    ["فبالرمز: 123456", `فبالرمز: ${REDACTED}`],
    ["كلمة المرور 'correct horse battery staple'", `كلمة المرور ${REDACTED}`],
    ['كلمة المرور "my long passphrase" ثم', `كلمة المرور ${REDACTED} ثم`],
    ["كلمـــــة المرور: hunter2", `كلمـــــة المرور: ${REDACTED}`],
    ["كلمََََة المرور: hunter2", `كلمََََة المرور: ${REDACTED}`],
    ["الرمز123456", `الرمز${REDACTED}`],
    ["الرقم السرى: 4821", `الرقم السرى: ${REDACTED}`],
    ["کلمه المرور: hunter2", `کلمه المرور: ${REDACTED}`],
    // Round-3 review: a quoted (JSON) Arabic key, the ل particle, three particles, any combining mark.
    ['{"كلمة المرور":"hunter2"}', `{"كلمة المرور":${REDACTED}}`],
    ['"كلمة المرور": "hunter2" ثم', `"كلمة المرور": ${REDACTED} ثم`],
    ['{"الرقم السري":1234}', `{"الرقم السري":${REDACTED}`],
    ['"كلمة المرور" hunter2', `"كلمة المرور" ${REDACTED}`],
    // PR #18 Codex: an escaped quote inside a quoted value is not its end.
    ['كلمة المرور: "ab\\"cd" بعده', `كلمة المرور: ${REDACTED} بعده`],
    ["كلمة المرور 'it\\'s9 secret' بعده", `كلمة المرور ${REDACTED} بعده`],
    ['{\\"كلمة المرور\\":\\"a,b\\\\\\"c\\"} بعده', `{\\"كلمة المرور\\":${REDACTED}} بعده`],
    // …and an escaped-mode value does not close on a bare quote (PR #18 Codex round 2).
    ['كلمة المرور: \\"abc"hunter2\\" بعده', `كلمة المرور: ${REDACTED} بعده`],
    // …and a bare value's digit is found however long its first word is (PR #18 Codex round 3).
    [`كلمة المرور ${"a".repeat(200)}9`, `كلمة المرور ${REDACTED}`],
    [`الرمز ${"b".repeat(1000)}7 بعده`, `الرمز ${REDACTED}`],
    // A dash, arrow or bar is a separator (PR #18 Codex round 4).
    ["كلمة المرور - hunter2", `كلمة المرور - ${REDACTED}`],
    // Typographic quotes and left arrows (PR #18 Codex round 5).
    ["كلمة المرور: «abc،def» بعده", `كلمة المرور: ${REDACTED} بعده`],
    ["كلمة المرور: “a, b” بعده", `كلمة المرور: ${REDACTED} بعده`],
    ["كلمة المرور «hunter two» بعده", `كلمة المرور ${REDACTED} بعده`],
    ["كلمة المرور: «abc, def", `كلمة المرور: ${REDACTED}`],
    ["كلمة المرور ← hunter2", `كلمة المرور ← ${REDACTED}`],
    ["الرمز <- 123456", `الرمز <- ${REDACTED}`],
    ["كلمة المرور – hunter2، بعده", `كلمة المرور – ${REDACTED}، بعده`],
    ["الرمز -> 123456", `الرمز -> ${REDACTED}`],
    ["لكلمة المرور: hunter2", `لكلمة المرور: ${REDACTED}`],
    ["لرمز الدخول: 123456", `لرمز الدخول: ${REDACTED}`],
    ["وبفكلمة المرور: hunter2", `وبفكلمة المرور: ${REDACTED}`],
    ["كلمؐة المرور: hunter2", `كلمؐة المرور: ${REDACTED}`],
    ["كلمࣣة المرور: hunter2", `كلمࣣة المرور: ${REDACTED}`],
    ["السر: hunter2", `السر: ${REDACTED}`],
    ["السر hunter2", `السر ${REDACTED}`],
    // Whitespace runs are unbounded: a bound of three let four spaces through, in every position.
    ["كلمة    المرور: hunter2", `كلمة    المرور: ${REDACTED}`],
    ["كلمة المرور    : hunter2", `كلمة المرور    : ${REDACTED}`],
    ["كلمة المرور:    hunter2", `كلمة المرور:    ${REDACTED}`],
    ["كلمة المرور     هي hunter2", `كلمة المرور     هي ${REDACTED}`],
    ["كلمة المرور\t\t\t\t: hunter2", `كلمة المرور\t\t\t\t: ${REDACTED}`],
    ["كلمة    المرور: hunter2", `كلمة    المرور: ${REDACTED}` /* NFKC folds NBSP to a space */],
    ["رمز التحقق      482193", `رمز التحقق      ${REDACTED}`],
    // A second label after a rejected first one is still read.
    ["الرمز البريدي ثم كلمة المرور: x9", `الرمز البريدي ثم كلمة المرور: ${REDACTED}`],
  ])("%j", (raw, expected) => {
    for (const out of both({ note: raw })) expect(out).toEqual({ note: expected });
  });

  it.each([
    "كلمة المرور غير صحيحة",
    "الرمز البريدي 13001",
    "الحالة: نشط",
    "التوكن انتهى",
    "الكودات: 12",
    "السرير رقم 4",
    "سر النجاح",
    '"كلمة المرور" غير صحيحة',
    "الرمز الإلكترونياتالمتطورة",
  ])("keeps %j", (raw) => {
    for (const out of both({ note: raw })) expect(out).toEqual({ note: raw });
  });
});
