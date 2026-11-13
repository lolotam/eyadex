import assert from "node:assert/strict";

/**
 * ينشئ حقول الإيصال وكلمات الربط دون إدخال النص كتعليمات Typst.
 * @returns سجل الكلمات والحقول ودالة ترميز الحقل.
 */
export function receiptFields() {
  const words = {};
  const fields = [];
  /**
   * يرمز حقلًا نصيًا ويرفض محارف التحكم قبل تقسيمه.
   * @param {string} value النص الأصلي.
   * @param {string} lang لغة واتجاه الحقل.
   * @param {string} weight وزن الخط.
   * @returns {string} تعبير Typst يقرأ النص كبيانات.
   */
  function field(value, lang = "ar", weight = "regular") {
    assert.equal(typeof value, "string", "receipt_field_type");
    assert(!/[\p{Cf}\p{Cc}]/u.test(value), "unsupported_format_character");
    if (lang === "ar" && !/\p{Script=Arabic}/u.test(value)) lang = "en";
    fields.push(value);
    const parts = value
      .split(/\s+/u)
      .filter(Boolean)
      .map((text) => {
        const id = `w${Object.keys(words).length.toString(36)}`;
        words[id] = text;
        return [id, text];
      });
    return `field(json(bytes(${JSON.stringify(JSON.stringify(parts))})), ${JSON.stringify(lang)}, ${JSON.stringify(weight)},244.236)`;
  }
  return { words, fields, field };
}

// Same reviewed field layout as the invoice. Shared extraction machinery stays unchanged.
export const fieldLayout = `#let field(parts,lang,weight,limitCap)=context {
  text(lang:lang,dir:if lang=="ar" {rtl} else {ltr},weight:weight,box(layout(size=>{
    let gap=measure(h(0.25em)).width
    let rows=()
    let row=()
    let used=0pt
    for part in parts {
      let limit=if size.width>=8pt {calc.min(size.width,limitCap*1pt)} else {limitCap*1pt}
      let pieces=()
      if measure(text(part.at(1))).width<=limit {
        pieces.push(part.at(1))
      } else {
        let piece=""
        for cluster in part.at(1).clusters() {
          if piece!="" and measure(text(piece+cluster)).width>limit {
            pieces.push(piece)
            piece=""
          }
          piece+=cluster
        }
        if piece!="" { pieces.push(piece) }
      }
      let location=here().position()
      let instance=str(location.page)+":"+str(calc.round(location.x.pt()*1000))+":"+str(calc.round(location.y.pt()*1000))
      let content=[#for (index,piece) in pieces.enumerate(){
        if index>0 { linebreak() }
        text(piece)
      }]
      let body=box(link("urn:e:"+part.at(0)+"#"+instance,content))
      let width=measure(body).width
      let extra=if row.len()>0 { gap } else { 0pt }
      if row.len()>0 and used+extra+width>limit {
        rows.push((cells:row,width:used))
        row=()
        used=0pt
        extra=0pt
      }
      row.push(body)
      used+=extra+width
    }
    if row.len()>0 { rows.push((cells:row,width:used)) }
    if rows.len()>0 {
      let width=calc.max(..rows.map(row=>row.width))
      box(width:width,stack(dir:ttb,spacing:0.4em,..rows.map(row=>
        align(if lang=="ar" {right} else {left},grid(columns:(auto,)*row.cells.len(),column-gutter:gap,..row.cells)))))
    }
  })))
}`;
