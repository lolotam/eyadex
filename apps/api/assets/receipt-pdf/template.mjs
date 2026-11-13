import assert from "node:assert/strict";
import { fieldLayout, receiptFields } from "./fields.mjs";

/**
 * يبني إيصال دفعة مستقلة من حقول النموذج المسموح بها.
 * @param {object} model نموذج الإيصال النصي.
 * @param {object} options اسم ملف الشعار المملوك للعملية الأم إن وجد.
 * @returns {object} المصدر والكلمات والحقول اللازمة للتحقق والربط.
 */
export function receiptSource(model, { logoFile = null } = {}) {
  const { words, fields, field } = receiptFields();
  assert(logoFile === null || /^(logo\.png|logo\.jpg)$/.test(logoFile), "receipt_logo_path");
  const pair = (ar, en, weight = "regular") =>
    `[#${field(en, "en", weight)}],[#${field(ar, "ar", weight)}]`;
  const row = (labelAr, valueAr, labelEn, valueEn = valueAr) =>
    `[#${field(labelEn, "en")}: #${field(valueEn)}],[#${field(labelAr)}: #${field(valueAr)}]`;
  const header = model.header.map(({ ar, en }) => pair(ar, en)).join(",");
  const rows = [
    row("رقم الإيصال", model.number, "Receipt number"),
    row("رقم الفاتورة", model.invoiceNumber, "Invoice number"),
    row("المراجع", model.patientName, "Patient"),
    row("التاريخ", model.dateAr, "Date", model.dateEn),
    row("الوقت", model.time, "Time"),
    row("طريقة الدفع", model.methodAr, "Payment method", model.methodEn),
    row(
      "المبلغ المستلم",
      `${model.amount} ${model.currencyAr}`,
      "Amount received",
      `${model.amount} ${model.currencyEn}`,
    ),
    ...(model.reference === null ? [] : [row("المرجع", model.reference, "Reference")]),
  ];
  const source = `${fieldLayout}
#set text(font:"Amiri",size:10pt,lang:"en",dir:ltr)
#set page(paper:"a4",margin:15mm,footer:align(center)[
  #context text(dir:ltr,counter(page).display("1 / 1",both:true))
])
#set table(align:(left,right),inset:6pt,stroke:none)
${logoFile === null ? "" : `#image(${JSON.stringify(logoFile)},width:40mm,height:20mm,fit:"contain")`}
#table(columns:(1fr,1fr),${pair(model.clinicAr, model.clinicEn, "bold")}${header ? `,${header}` : ""})
#v(8pt)
#table(columns:(1fr,1fr),${pair("إيصال استلام", "Payment receipt", "bold")})
#v(6pt)
#table(columns:(1fr,1fr),${rows.join(",")})
`;
  return { source, words, fields };
}
