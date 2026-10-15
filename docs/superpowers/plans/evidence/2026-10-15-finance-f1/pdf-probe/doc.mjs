import { readFileSync } from "node:fs";

// Typst string literal: escape backslash, quote and every control character as \u{..}.
const typstString = (s) =>
  '"' +
  s.replace(/[\\"]/g, (c) => "\\" + c).replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u{${c.charCodeAt(0).toString(16)}}`) +
  '"';

function model(lines) {
  return {
    clinicAr: "عيادة النور التجريبية",
    clinicEn: "Al Noor Test Clinic",
    branch: "فرع السالمية — Salmiya branch, Block 10 (Tel +965 0000 0000)",
    number: "SAL-2026-000042",
    date: "١٥ أكتوبر ٢٠٢٦ / 15 October 2026",
    // Injection attempt: must render as text, never run.
    patient: 'مراجع تجريبي "); #panic("injected") // \\ end',
    lines: Array.from({ length: lines }, (_, i) => ({
      n: String(i + 1),
      ar: i % 2 ? "استشارة طبية (متابعة)" : "علاج الأسنان — تنظيف بشرة، جلسة ٢",
      en: i % 2 ? "Medical consultation (follow-up)" : "Skin cleaning, session 2",
      qty: "1",
      unit: "15.000 د.ك",
      disc: i === 0 ? "10% (خصم موظف)" : "—",
      total: i === 0 ? "13.500 KWD" : "15.000 KWD",
    })),
    total: "الإجمالي Total: 748.500 د.ك KWD",
    voidBanner: "فاتورة ملغاة / VOID INVOICE",
  };
}

const template = readFileSync(new URL("./invoice.typ", import.meta.url), "utf8");

export function documentFor(lines) {
  return `#let data = json(bytes(${typstString(JSON.stringify(model(lines)))}))\n${template}`;
}

