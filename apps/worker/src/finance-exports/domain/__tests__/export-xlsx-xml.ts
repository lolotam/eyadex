import { strFromU8, unzipSync } from "fflate";

/** خلية بعد فك الـ ZIP. النوع من XML الفعلي، مش من وسيطة الكاتب. */
export type XlsxCell = {
  readonly kind: "text" | "number" | "empty" | "other";
  readonly value: string;
  readonly format: string | null;
};

/** ورقة واحدة بعد قواعد XML 1.0: CR الحرفي يصير LF، و`&#13;` يفضل CR، وTAB لا يتغير. */
export type XlsxSheet = {
  readonly worksheetFiles: number;
  readonly workbookSheets: number;
  readonly rows: readonly (readonly XlsxCell[])[];
  readonly formulaMarkup: boolean;
  readonly hyperlinkMarkup: boolean;
  readonly externalRelationship: boolean;
};

const WORKSHEET = /^xl\/worksheets\/sheet\d+\.xml$/;
const CELL = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function textOf(files: Record<string, Uint8Array>, name: string): string {
  const bytes = files[name];
  if (bytes === undefined) return "";
  return strFromU8(bytes);
}

function attr(source: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(source)?.[1] ?? null;
}

/**
 * يطبّق تطبيع نهايات الأسطر في XML 1.0 على النص الخام، ثم يفك الكيانات.
 * `&#13;` مش CR حرفي، فيفضل CR بعد الفك. TAB مش نهاية سطر.
 */
function xmlText(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.replace(
    /&#x([0-9a-fA-F]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/g,
    (_match, hex, dec, named) => {
      if (typeof hex === "string") return String.fromCodePoint(Number.parseInt(hex, 16));
      if (typeof dec === "string") return String.fromCodePoint(Number(dec));
      return NAMED[named] ?? _match;
    },
  );
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((item) =>
    [...(item[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((text) => xmlText(text[1] ?? ""))
      .join(""),
  );
}

function styleFormats(xml: string): (string | null)[] {
  const formats = new Map<string, string>();
  for (const tag of xml.matchAll(/<numFmt\b[^>]*\/>/g)) {
    const id = attr(tag[0], "numFmtId");
    const code = attr(tag[0], "formatCode");
    if (id !== null && code !== null) formats.set(id, xmlText(code));
  }
  const body = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  return [...body.matchAll(/<xf\b([^>]*)>/g)].map((xf) => {
    const id = attr(xf[1] ?? "", "numFmtId");
    return id === null ? null : (formats.get(id) ?? null);
  });
}

function columnIndex(address: string): number {
  const letters = /^[A-Z]+/.exec(address)?.[0] ?? "";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function cellOf(
  attrs: string,
  inner: string,
  strings: readonly string[],
  formats: readonly (string | null)[],
): { column: number; cell: XlsxCell } | null {
  const address = attr(attrs, "r");
  if (address === null) return null;
  const style = attr(attrs, "s");
  const format = style === null ? null : (formats[Number(style)] ?? null);
  const type = attr(attrs, "t");
  const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
  if (inner.includes("<f")) {
    return { column: columnIndex(address), cell: { kind: "other", value: raw ?? "", format } };
  }
  if (type === "s" && raw !== undefined) {
    return {
      column: columnIndex(address),
      cell: { kind: "text", value: strings[Number(raw)] ?? "", format },
    };
  }
  if (type === "inlineStr") {
    const inline = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((item) => xmlText(item[1] ?? ""))
      .join("");
    return { column: columnIndex(address), cell: { kind: "text", value: inline, format } };
  }
  if (raw === undefined) {
    return { column: columnIndex(address), cell: { kind: "empty", value: "", format } };
  }
  if (type === null || type === "n") {
    return {
      column: columnIndex(address),
      cell: { kind: "number", value: xmlText(raw), format },
    };
  }
  return { column: columnIndex(address), cell: { kind: "other", value: xmlText(raw), format } };
}

function rowsOf(
  xml: string,
  strings: readonly string[],
  formats: readonly (string | null)[],
): XlsxCell[][] {
  const byRow = new Map<number, XlsxCell[]>();
  for (const match of xml.matchAll(CELL)) {
    const attrs = match[1] ?? match[2] ?? "";
    const placed = cellOf(attrs, match[3] ?? "", strings, formats);
    if (placed === null) continue;
    const rowNumber = Number(/\d+$/.exec(attr(attrs, "r") ?? "")?.[0] ?? "0");
    const row = byRow.get(rowNumber) ?? [];
    row[placed.column] = placed.cell;
    byRow.set(rowNumber, row);
  }
  const last = Math.max(0, ...byRow.keys());
  const rows: XlsxCell[][] = [];
  for (let rowNumber = 1; rowNumber <= last; rowNumber += 1) {
    const row = byRow.get(rowNumber) ?? [];
    rows.push(
      Array.from(
        { length: row.length },
        (_unused, index) => row[index] ?? { kind: "empty", value: "", format: null },
      ),
    );
  }
  return rows;
}

/** يفك XLSX حقيقي. المقارنة على الخلايا، مش على بايتات الـ ZIP، لأن الطابع الزمني جوه الأرشيف. */
export function readXlsx(bytes: Uint8Array): XlsxSheet {
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  const worksheets = names.filter((name) => WORKSHEET.test(name)).sort();
  const workbook = textOf(files, "xl/workbook.xml");
  const sheetXml = worksheets.map((name) => textOf(files, name)).join("");
  const relationships = names
    .filter((name) => name.endsWith(".rels"))
    .map((name) => textOf(files, name))
    .join("");
  return {
    worksheetFiles: worksheets.length,
    workbookSheets: workbook.match(/<sheet\b/g)?.length ?? 0,
    rows: rowsOf(
      sheetXml,
      sharedStrings(textOf(files, "xl/sharedStrings.xml")),
      styleFormats(textOf(files, "xl/styles.xml")),
    ),
    formulaMarkup: /<f[\s>]/.test(sheetXml),
    hyperlinkMarkup: /<hyperlink[\s>]/.test(sheetXml) || /hyperlink/.test(relationships),
    externalRelationship: relationships.includes('TargetMode="External"'),
  };
}
