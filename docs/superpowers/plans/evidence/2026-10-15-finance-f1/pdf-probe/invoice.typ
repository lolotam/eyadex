#set page(paper: "a4", margin: 15mm, footer: context align(center, text(8pt)[#counter(page).display("1 / 1", both: true)]))
#set text(font: ("IBM Plex Sans Arabic", "IBM Plex Sans"), size: 10pt)

#block(fill: rgb("#fde8e8"), inset: 6pt, width: 100%, align(center, text(weight: "semibold", data.voidBanner)))

#grid(columns: (1fr, 1fr), gutter: 8pt,
  align(left, text(dir: ltr)[*#data.clinicEn*]),
  align(right, text(dir: rtl, lang: "ar")[*#data.clinicAr*]),
)
#align(right, text(dir: rtl, lang: "ar", data.branch))
#align(right, text(dir: rtl, lang: "ar")[رقم الفاتورة: #data.number — #data.date])
#align(right, text(dir: rtl, lang: "ar")[المراجع: #data.patient])

#set text(size: 9pt)
#table(
  columns: (auto, 1fr, 1fr, auto, auto, auto, auto),
  table.header(repeat: true, [\#], [الوصف], [Description], [الكمية Qty], [السعر Unit], [الخصم Disc.], [الإجمالي Total]),
  ..data.lines.map(l => (
    l.n,
    text(dir: rtl, lang: "ar", l.ar),
    text(dir: ltr, l.en),
    l.qty,
    text(dir: rtl, lang: "ar", l.unit),
    text(dir: rtl, lang: "ar", l.disc),
    l.total,
  )).flatten(),
)
#align(right, text(dir: rtl, lang: "ar", weight: "semibold", data.total))
