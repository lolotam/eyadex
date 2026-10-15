// Disposable 8g probe 2: E1–E5 amounts, logo bytes, language isolation. Synthetic data only.
// Usage (inside node:24-alpine): node probe2.mjs <typst> <fonts> <contracts-src> <pdfjs-module> <out>
import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";

const [typst, fonts, contracts, pdfjsPath, out] = process.argv.slice(2);
const { computeInvoiceTotals } = await import(`${contracts}/invoice-totals.ts`);
const { formatMinor } = await import(`${contracts}/money.ts`);
const { getDocument } = await import(pdfjsPath);

const ARGS = ["compile", "--format", "pdf", "--ignore-system-fonts", "--font-path", fonts, "--root", "/probe-root", "-", "-"];
const typstString = (s) =>
  '"' + s.replace(/[\\"]/g, (c) => "\\" + c).replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u{${c.charCodeAt(0).toString(16)}}`) + '"';

function compile(doc, format = "pdf") {
  return new Promise((resolve) => {
    const args = format === "pdf" ? ARGS : ARGS.map((a) => (a === "pdf" ? format : a));
    const started = process.hrtime.bigint();
    const child = spawn(typst, args, { env: {}, cwd: "/", stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) =>
      resolve({ code, ms: Number(process.hrtime.bigint() - started) / 1e6, out: Buffer.concat(chunks), stderr: stderr.slice(0, 300) }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(doc);
  });
}

async function pdfText(buf) {
  const pdf = await getDocument({ data: new Uint8Array(buf) }).promise;
  const parts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const { items } = await (await pdf.getPage(p)).getTextContent();
    parts.push(...items.map((i) => i.str));
  }
  return parts.filter((s) => s.trim() !== "");
}

// ---------- Synthetic PNG (no libraries): RGB, filter 0 per row.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const logos = {
  small: png(240, 120, (x, y) => [20 + (x % 200), 90, 160 - (y % 120)]),
  // Random pixels do not compress: about 1 MB, just under the 1 048 576-byte logo cap.
  big: (() => { const noise = randomBytes(580 * 580 * 3); return png(580, 580, (x, y) => noise.subarray((y * 580 + x) * 3, (y * 580 + x) * 3 + 3)); })(),
};

// ---------- E1–E5 from spec §8b.1 (KWD, exponent 3; amounts in fils).
const L = (position, unitPriceMinor, discount = null) => ({ position, quantity: 1, unitPriceMinor, discount });
const EXAMPLES = {
  E1: { input: { lines: [L(1, 500n), L(2, 500n)], invoiceDiscount: { kind: "amount", minor: 1n }, taxRateBp: 0 }, lineTotals: [499n, 500n], tax: 0n, total: 999n },
  E2: { input: { lines: [L(1, 0n), L(2, 1n), L(3, 1n)], invoiceDiscount: { kind: "amount", minor: 1n }, taxRateBp: 0 }, lineTotals: [0n, 0n, 1n], tax: 0n, total: 1n },
  E3: { input: { lines: [L(1, 12500n, { kind: "pct", bp: 10000 })], invoiceDiscount: null, taxRateBp: 0 }, lineTotals: [0n], tax: 0n, total: 0n },
  E4: { input: { lines: [L(1, 3n), L(2, 4n)], invoiceDiscount: { kind: "amount", minor: 1n }, taxRateBp: 1500 }, lineTotals: [2n, 4n], tax: 1n, total: 7n },
  E5: { input: { lines: [L(1, 12345n, { kind: "pct", bp: 1000 })], invoiceDiscount: null, taxRateBp: 0 }, lineTotals: [11110n], tax: 0n, total: 11110n },
};

const template = readFileSync(new URL("./invoice2.typ", import.meta.url), "utf8");
const docFor = (model, logo) =>
  `#let data = json(bytes(${typstString(JSON.stringify(model))}))\n` +
  `#let logo = ${logo ? `bytes((${[...logo].join(",")}))` : "none"}\n` +
  template;

const report = { examples: {}, logo: {}, isolation: null };
for (const [name, ex] of Object.entries(EXAMPLES)) {
  const t = computeInvoiceTotals(ex.input);
  const fm = (m) => formatMinor(m.toString(), 3);
  const model = {
    isolation: false,
    lines: t.lines.map((l, i) => ({ n: String(i + 1), ar: "استشارة", en: "Consultation", total: fm(l.lineTotalMinor) })),
    subtotal: fm(t.subtotalMinor), discount: fm(t.discountMinor), tax: t.taxMinor > 0n ? fm(t.taxMinor) : null, total: fm(t.totalMinor),
    date: "2026-10-15", dateEn: "15 October 2026", dateAr: "١٥ أكتوبر ٢٠٢٦",
  };
  const r = await compile(docFor(model, null));
  const text = r.code === 0 ? await pdfText(r.out) : [];
  const expected = { lines: ex.lineTotals.map(fm), tax: ex.tax > 0n ? fm(ex.tax) : null, total: fm(ex.total) };
  report.examples[name] = {
    exit: r.code,
    function: { lines: model.lines.map((l) => l.total), tax: model.tax, total: model.total },
    spec: expected,
    functionEqualsSpec: JSON.stringify(model.lines.map((l) => l.total)) === JSON.stringify(expected.lines) && model.tax === expected.tax && model.total === expected.total,
    pdfHasEveryAmount: [...expected.lines, expected.total, ...(expected.tax ? [expected.tax] : [])].every((a) => text.some((s) => s.includes(a))),
    pdfTotalCell: text.find((s) => s.startsWith("TOTAL=")) ?? null,
  };
}

// Logo transport: byte-array literal inside the stdin document.
for (const [name, bytes] of Object.entries(logos)) {
  const doc = docFor({ isolation: false, lines: [{ n: "1", ar: "استشارة", en: "Consultation", total: "15.000" }], subtotal: "15.000", discount: "0.000", tax: null, total: "15.000", date: "2026-10-15", dateEn: "15 October 2026", dateAr: "١٥ أكتوبر ٢٠٢٦" }, bytes);
  const r = await compile(doc);
  report.logo[name] = { pngBytes: bytes.length, documentBytes: Buffer.byteLength(doc), exit: r.code, ms: r.ms.toFixed(1), pdfBytes: r.out.length, stderr: r.stderr };
  if (name === "small" && r.code === 0) {
    const img = await compile(doc, "png");
    writeFileSync(`${out}/logo-small.png`, img.out);
  }
}

// Language isolation: the same mixed cells, without and with explicit isolation.
const iso = { isolation: true, lines: [{ n: "1", ar: "استشارة", en: "Consultation", total: "15.000" }], subtotal: "15.000", discount: "0.000", tax: null, total: "15.000", date: "2026-10-15", dateEn: "15 October 2026", dateAr: "١٥ أكتوبر ٢٠٢٦" };
const isoPng = await compile(docFor(iso, null), "png");
writeFileSync(`${out}/isolation.png`, isoPng.out);
const isoPdf = await compile(docFor(iso, null));
report.isolation = { exit: isoPdf.code, pngExit: isoPng.code, items: isoPdf.code === 0 ? (await pdfText(isoPdf.out)).filter((s) => /MIX|ISO|October|KWD|2026/.test(s)) : [] };
console.log(JSON.stringify(report, null, 2));
