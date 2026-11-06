import assert from "node:assert/strict";

// Synthetic template proof. Values are already formatted: no money arithmetic here.
export function invoiceSource(model) {
  const words = {},
    roles = {},
    fields = [],
    fieldRecords = [];
  let next = 0;
  function field(value, lang = "ar", weight = "regular", role = "single") {
    assert(!/[\p{Cf}\p{Cc}]/u.test(String(value)), "unsupported_format_character");
    if (lang === "ar" && !/\p{Script=Arabic}/u.test(String(value))) lang = "en";
    const parts = String(value)
      .split(/\s+/u)
      .filter(Boolean)
      .map((text) => {
        const id = `w${(next++).toString(36)}`;
        words[id] = text;
        roles[id] = role;
        return [id, text];
      });
    fields.push(String(value));
    fieldRecords.push({ value: String(value), role, lang, weight, ids: parts.map((p) => p[0]) });
    return `field(json(bytes(${JSON.stringify(JSON.stringify(parts))})), ${JSON.stringify(lang)}, ${JSON.stringify(weight)},${role === "row" ? 244.236 : 510.236})`;
  }
  function literal(value) {
    const role = fieldRecords.at(-1).role;
    return "#" + field(value, "en", "regular", role);
  }
  const pair = (ar, en, role = "single") =>
    `[#${field(ar, "ar", "regular", role)} #linebreak() #${field(en, "en", "regular", role)}]`;
  const headings = [
    pair("البند", "#", "table-header"),
    pair("الوصف", "Description", "table-header"),
    pair("الكمية", "Qty", "table-header"),
    pair("سعر الوحدة", "Unit price", "table-header"),
    pair("الخصم", "Discount", "table-header"),
    pair("الإجمالي", "Total", "table-header"),
  ];
  const rows = model.lines.flatMap((line) => [
    `[#${field(line.position, "en", "regular", "row")}]`,
    pair(
      line.descriptionAr + (line.discountReasonAr ? ` — ${line.discountReasonAr}` : ""),
      line.descriptionEn + (line.discountReasonEn ? ` — ${line.discountReasonEn}` : ""),
      "row",
    ),
    ...[line.quantity, line.unitPrice, line.discount, line.total].map(
      (value) => `[#${field(value, "en", "regular", "row")}]`,
    ),
  ]);
  const voidHeader = model.voidReason
    ? `header: block(width:100%, fill:rgb("ffe8e8"), inset:5pt)[#${field("فاتورة ملغاة", "ar", "bold", "page")} ${literal("/")} #${field("VOID INVOICE", "en", "bold", "page")} #linebreak() #${field(model.voidReason, "ar", "regular", "page")} ${literal("/")} #${field(model.voidDateAr, "ar", "regular", "page")} ${literal("/")} #${field(model.voidDate, "en", "regular", "page")}],`
    : "";
  const headerRows = model.header
    .map(
      ({ ar, en }) =>
        `#grid(columns:(1fr,1fr),align(left)[#${field(en, "en")}],align(right)[#${field(ar, "ar")}])`,
    )
    .join("\n");
  const logo = model.logoBytes
    ? `#image(bytes(${JSON.stringify(model.logoBytes).replaceAll("[", "(").replaceAll("]", ")")}),width:20mm,height:10mm,fit:"contain")`
    : "";
  const source = `#let field(parts,lang,weight,limitCap)=context {
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
}
#set text(font:"Amiri",size:10pt,lang:"en",dir:ltr)
#set page(paper:"a4",margin:15mm,${voidHeader}
  footer:align(center)[#${field("صفحة", "ar", "regular", "page")} ${literal("/")} #${field("Page", "en", "regular", "page")}
    #context text(dir:ltr,counter(page).display("1 / 1",both:true))
    #h(8pt) #${field("نسخة", "ar", "regular", "page")} ${literal("/")} #${field("Version " + model.version, "en", "regular", "page")}
  ])
${logo}
#grid(columns:(1fr,1fr),align(left)[#${field(model.clinicEn, "en", "bold")}],align(right)[#${field(model.clinicAr, "ar", "bold")}])
${headerRows}
#par[#${field("رقم الفاتورة")} #${field(model.number, "en")} ${literal("/")} #${field("Invoice", "en")}]
#par[#${field("التاريخ")} #${field(model.dateAr, "ar")} ${literal("/")} #${field(model.dateEn, "en")}]
#par[#${field("الحالة")} #${field(model.statusAr)} ${literal("/")} #${field(model.statusEn, "en")}]
#par[#${field("المراجع")} #${field(model.patientName)} ${literal("/")} #${field("Patient", "en")}]
#set text(size:9pt)
#table(columns:(22pt,1fr,28pt,70pt,70pt,70pt),rows:auto,inset:3pt,stroke:0.3pt+gray,
  table.header(${headings.join(",")}),${rows.join(",")})
#set text(size:10pt)
#block(breakable:false)[
${model.totals.map((total) => `#par[#${field(total.ar)} ${literal("/")} #${field(total.en, "en")} #${field(total.value + " " + model.currency, "en")} ]`).join("\n")}
${model.invoiceDiscount !== null && model.invoiceDiscount !== undefined ? `#par[#${field("خصم الفاتورة")} ${literal("/")} #${field("Invoice discount", "en")} #${field(model.invoiceDiscount, "en")}]` : ""}
${model.invoiceDiscountReason ? `#par[#${field("سبب الخصم")} ${literal("/")} #${field("Discount reason", "en")} #${field(model.invoiceDiscountReason)}]` : ""}
#par[#${field(model.currencyAr)} ${literal("/")} #${field(model.currencyEn, "en")}]
]
`;
  const allIds = [...source.matchAll(/field\(json\(bytes\(("(?:\\.|[^"\\])*")\)\)/g)].flatMap(
    (match) => JSON.parse(JSON.parse(match[1])).map(([id]) => id),
  );
  const sourceOrder = allIds.filter((id) => roles[id] === "single" || roles[id] === "row");
  const repeatedOrder = Object.fromEntries(
    ["page", "table-header"].map((role) => [role, allIds.filter((id) => roles[id] === role)]),
  );
  return {
    source,
    words,
    fields,
    roles,
    sourceOrder,
    fieldRecords,
    repeatedOrder,
    headerCells: headings,
  };
}
