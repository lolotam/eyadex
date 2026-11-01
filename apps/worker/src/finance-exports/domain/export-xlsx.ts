import writeXlsxFile, { type Feature } from "write-excel-file/node";

import { prepareReportExport, type PreparedField, type ReportExportInput } from "./export-cells.ts";

/** بايتات الملف في الذاكرة، أو رفض ثابت من غير القيمة ومن غير بايتات. */
export type ReportXlsxResult =
  | { readonly ok: true; readonly bytes: Buffer; readonly rowCount: number }
  | { readonly ok: false; readonly code: "export_value_invalid" };

type TextCell = { readonly type: StringConstructor; readonly value: string; readonly format: "@" };
type NumberCell = { readonly type: NumberConstructor; readonly value: number };

const invalid = (): ReportXlsxResult => ({ ok: false, code: "export_value_invalid" });

function textCell(value: string): TextCell {
  return { type: String, value, format: "@" };
}

/**
 * التحويل لـ `Number` بعد التحقق الكنسي فقط. أكبر من الحد الآمن مش سقف أعمال،
 * لكنه ماينكتبش رقمًا مقرّبًا.
 */
function countNumber(value: bigint): number | null {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function sheetCell(field: PreparedField): TextCell | NumberCell | null {
  if (field.kind === "money") return textCell(field.text);
  if (field.kind === "text") return textCell(field.value);
  const value = countNumber(field.value);
  if (value === null) return null;
  return { type: Number, value };
}

const SHEET_XML = "xl/worksheets/sheet1.xml";

/** فهرس المكتبة كائن عادي، فمفاتيح زي constructor مش رقم خلية. العنوان من الشيت اللي بنملكه. */
class SheetTextMissed extends Error {
  constructor() {
    super("export_value_invalid");
    this.name = "SheetTextMissed";
  }
}

/** XML 1.0 Char: TAB وLF وCR والحروف العادية، من غير عناصر التحكم ولا surrogate يتيم. */
function isXml10Text(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined) return false;
    const allowed =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    if (!allowed) return false;
  }
  return true;
}

function columnLetters(columnIndex: number): string {
  let index = columnIndex;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (index % 26)) + letters;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return letters;
}

function cellAddress(rowIndex: number, columnIndex: number): string {
  return `${columnLetters(columnIndex)}${rowIndex + 1}`;
}

function ownedText(
  rows: readonly (readonly (TextCell | NumberCell)[])[],
): ReadonlyMap<string, string> {
  const owned = new Map<string, string>();
  for (const [rowIndex, row] of rows.entries()) {
    for (const [columnIndex, cell] of row.entries()) {
      if (typeof cell.value !== "string" || cell.value === "") continue;
      owned.set(cellAddress(rowIndex, columnIndex), cell.value);
    }
  }
  return owned;
}

function escapeInlineText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;");
}

function inlineCell(address: string, value: string, style: string | undefined): string {
  const styleAttr = style === undefined ? "" : ` s="${style}"`;
  const space = value.trim().length === value.length ? "" : ' xml:space="preserve"';
  return `<c r="${address}"${styleAttr} t="inlineStr"><is><t${space}>${escapeInlineText(value)}</t></is></c>`;
}

function rewriteOwnedText(xml: string, owned: ReadonlyMap<string, string>): string | null {
  const seen = new Set<string>();
  const rewritten = xml.replace(
    /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g,
    (match, emptyAttrs: string | undefined, openAttrs: string | undefined) => {
      const attrs = emptyAttrs ?? openAttrs ?? "";
      const address = /\br="([^"]*)"/.exec(attrs)?.[1];
      if (address === undefined) return match;
      const value = owned.get(address);
      if (value === undefined) return match;
      seen.add(address);
      return inlineCell(address, value, /\bs="([^"]*)"/.exec(attrs)?.[1]);
    },
  );
  return seen.size === owned.size ? rewritten : null;
}

function sheetTextFeature<TFile>(owned: ReadonlyMap<string, string>): Feature<TFile> {
  return {
    files: {
      write: {
        files(_sheets, properties) {
          const current = properties.read(SHEET_XML);
          if (typeof current !== "string") throw new SheetTextMissed();
          const rewritten = rewriteOwnedText(current, owned);
          if (rewritten === null) throw new SheetTextMissed();
          return { [SHEET_XML]: rewritten };
        },
      },
    },
  };
}

function sheetRows(
  rows: readonly (readonly PreparedField[])[],
): (TextCell | NumberCell)[][] | null {
  const built: (TextCell | NumberCell)[][] = [];
  for (const row of rows) {
    const cells: (TextCell | NumberCell)[] = [];
    for (const field of row) {
      const cell = sheetCell(field);
      if (cell === null) return null;
      cells.push(cell);
    }
    built.push(cells);
  }
  return built;
}

/**
 * يكتب تقريرًا واحدًا كـ XLSX في الذاكرة، بورقة واحدة. المبلغ نص عشري متعارف عليه
 * ونوعه نص، والعداد رقم بعد التحقق. حارس الصيغة على كل نص حر، ومش على المبلغ.
 * نص فيه محرف XML 1.0 ممنوع يترفض من غير بايتات ومن غير قص.
 *
 * @param input التقرير، ولغة الترويسات، وصفوف مطبّعة بمفاتيح الأعمدة
 * @returns بايتات الملف وعدد صفوف البيانات، أو `export_value_invalid` من غير بايتات
 */
export async function writeReportXlsx(input: ReportExportInput): Promise<ReportXlsxResult> {
  const prepared = prepareReportExport(input);
  if (!prepared.ok) return prepared;
  if (!prepared.header.every(isXml10Text)) return invalid();
  const rows = sheetRows(prepared.rows);
  if (rows === null) return invalid();
  const sheet = [prepared.header.map(textCell), ...rows];
  const owned = ownedText(sheet);
  if (![...owned.values()].every(isXml10Text)) return invalid();
  try {
    const bytes = await writeXlsxFile(
      sheet,
      {},
      { features: [sheetTextFeature(owned)] },
    ).toBuffer();
    return { ok: true, bytes, rowCount: prepared.rows.length };
  } catch (error) {
    if (error instanceof SheetTextMissed) return invalid();
    throw error;
  }
}
