import type { PreparedField } from "./mock-export-cells";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

// Excel's format limit includes the repeated header; it is not a business/report cap.
export const XLSX_DATA_ROWS_PER_SHEET = 1_048_575;

function xmlText(value: string): string {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (
      code === undefined ||
      !(
        code === 9 || code === 10 || code === 13 ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff)
      )
    ) throw new Error("export_value_invalid");
  }
  // One replacement pass prevents recursively escaping the inserted Xstring prefix.
  return value.replace(/_x(?=[0-9a-fA-F]{4}_)/g, "_x005F_x")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;");
}

function columnLetters(column: number): string {
  let result = "";
  do {
    result = String.fromCharCode(65 + column % 26) + result;
    column = Math.floor(column / 26) - 1;
  } while (column >= 0);
  return result;
}

function rowXml(fields: readonly PreparedField[], index: number): string {
  const cells = fields.map((field, column) => {
    const address = `${columnLetters(column)}${index}`;
    if (field.kind === "count") {
      if (field.value < 0n || field.value > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error("export_value_invalid");
      return `<c r="${address}" t="n"><v>${field.value}</v></c>`;
    }
    const value = field.kind === "money" ? field.text : field.value;
    return `<c r="${address}" s="1" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
  });
  return `<row r="${index}">${cells.join("")}</row>`;
}

/** The injected limit exercises the production continuation path without million-row fixtures. */
export function* reportSheetXmls(
  header: readonly string[],
  rows: readonly (readonly PreparedField[])[],
  rtl: boolean,
  dataRowsPerSheet = XLSX_DATA_ROWS_PER_SHEET,
): Generator<string> {
  if (!Number.isSafeInteger(dataRowsPerSheet) || dataRowsPerSheet < 1 ||
      dataRowsPerSheet > XLSX_DATA_ROWS_PER_SHEET) throw new Error("export_value_invalid");
  const headerXml = rowXml(header.map((value) => ({ kind: "text", value })), 1);
  let start = 0;
  do {
    const end = Math.min(start + dataRowsPerSheet, rows.length);
    const records = [headerXml];
    for (let index = start; index < end; index += 1) {
      const fields = rows[index];
      if (!fields) throw new Error("export_value_invalid");
      records.push(rowXml(fields, index - start + 2));
    }
    yield `${XML}<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0" rightToLeft="${rtl ? 1 : 0}"/></sheetViews><sheetData>${records.join("")}</sheetData></worksheet>`;
    start = end;
  } while (start < rows.length);
}

export function workbookParts(sheets: number): ReadonlyArray<readonly [string, string]> {
  const numbers = Array.from({ length: sheets }, (_, index) => index + 1);
  const types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${numbers.map((n) => `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const workbook = `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${numbers.map((n) => `<sheet name="Report ${n}" sheetId="${n}" r:id="rId${n}"/>`).join("")}</sheets></workbook>`;
  const relations = `${XML}<Relationships xmlns="${PACKAGE_REL}">${numbers.map((n) => `<Relationship Id="rId${n}" Type="${REL}/worksheet" Target="worksheets/sheet${n}.xml"/>`).join("")}<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`;
  const root = `${XML}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const styles = `${XML}<styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="@"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;
  return [["[Content_Types].xml", types], ["_rels/.rels", root],
    ["xl/workbook.xml", workbook], ["xl/_rels/workbook.xml.rels", relations],
    ["xl/styles.xml", styles]];
}