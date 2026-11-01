import type { PreparedField } from "./export-cells.ts";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const SHEET_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function text(value: string): string {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (!(
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)
    )) {
      throw new Error("export_value_invalid");
    }
  }
  return (
    value
      // OOXML Xstring escapes its own escape prefix, so a literal _xHHHH_ stays literal in Excel.
      .replace(/_x(?=[0-9a-fA-F]{4}_)/g, "_x005F_x")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\r/g, "&#13;")
  );
}

function letters(index: number): string {
  let result = "";
  do {
    result = String.fromCharCode(65 + (index % 26)) + result;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return result;
}

/**
 * بيكتب صف XML واحد؛ المبالغ نص، والعدادات أرقام آمنة، وكل النصوص inline من غير sharedStrings.
 * @param fields خلايا متحقق منها وبنفس ترتيب أعمدة التقرير
 * @param index رقم الصف داخل الورقة، يبدأ بواحد
 * @returns XML محدود بصف واحد، أو رفض لقيمة غير صالحة
 */
export function sheetRowXml(fields: readonly PreparedField[], index: number): string {
  const cells = fields.map((field, column) => {
    const address = `${letters(column)}${index}`;
    if (field.kind === "count") {
      if (field.value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("export_value_invalid");
      return `<c r="${address}" t="n"><v>${field.value}</v></c>`;
    }
    const value = field.kind === "money" ? field.text : field.value;
    return `<c r="${address}" s="1" t="inlineStr"><is><t xml:space="preserve">${text(value)}</t></is></c>`;
  });
  return `<row r="${index}">${cells.join("")}</row>`;
}

/**
 * يفتح ورقة بالاتجاه المطلوب؛ حد الصفوف بتاع الصيغة يكمّل في ورقة تالية عند الكاتب.
 * @param rtl هل اللغة عربية
 * @returns بداية الورقة قبل صف الترويسات
 */
export function sheetStartXml(rtl: boolean): string {
  return `${XML}<worksheet xmlns="${SHEET_NAMESPACE}"><sheetViews><sheetView workbookViewId="0" rightToLeft="${rtl ? 1 : 0}"/></sheetViews><sheetData>`;
}

/**
 * بيولد تعريفات المصنف جزءًا بجزء؛ مفيش تجميع XML كل الأوراق في نص واحد.
 * @param kind ملف التعريف المطلوب
 * @param sheets عدد الأوراق المكتوبة بالكامل
 * @returns أجزاء XML بترتيب ثابت
 */
export function* workbookXml(
  kind: "types" | "workbook" | "relations",
  sheets: number,
): Generator<string> {
  yield XML;
  const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  if (kind === "types") {
    yield '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    for (let i = 1; i <= sheets; i++)
      yield `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    yield "</Types>";
  } else if (kind === "workbook") {
    yield `<workbook xmlns="${SHEET_NAMESPACE}" xmlns:r="${relationships}"><sheets>`;
    for (let i = 1; i <= sheets; i++)
      yield `<sheet name="Report ${i}" sheetId="${i}" r:id="rId${i}"/>`;
    yield "</sheets></workbook>";
  } else {
    yield '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    for (let i = 1; i <= sheets; i++)
      yield `<Relationship Id="rId${i}" Type="${relationships}/worksheet" Target="worksheets/sheet${i}.xml"/>`;
    yield `<Relationship Id="rIdStyles" Type="${relationships}/styles" Target="styles.xml"/></Relationships>`;
  }
}

export const ROOT_RELATIONSHIP = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
export const WORKBOOK_STYLES = `${XML}<styleSheet xmlns="${SHEET_NAMESPACE}"><numFmts count="1"><numFmt numFmtId="164" formatCode="@"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;
