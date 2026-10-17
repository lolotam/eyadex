#set page(paper: "a4", margin: 15mm)
#set text(font: "IBM Plex Sans Arabic", size: 10pt)
#let ar(body) = text(dir: rtl, lang: "ar", body)
#let en(body) = text(dir: ltr, lang: "en", body)
// Isolation: a box is laid out on its own, so the bidi algorithm sees it as one object.
#let iso(body) = box(text(dir: ltr, lang: "en", body))

#if logo != none { image(logo, width: 40mm) }

#table(
  columns: (auto, 1fr, 1fr, auto),
  table.header([\#], ar[الوصف], en[Description], en[Total]),
  ..data.lines.map(l => (l.n, ar(l.ar), en(l.en), en(l.total))).flatten(),
)
#en[SUBTOTAL=#data.subtotal DISCOUNT=#data.discount]
#if data.tax != none [#en[TAX=#data.tax]]
#en[TOTAL=#data.total]

#if data.isolation [
  // MIX: one RTL paragraph, nothing isolated (the probe-1 failure).
  #align(right, ar[MIX التاريخ: #data.dateAr / #data.dateEn — الإجمالي #data.total KWD])
  // ISO: the same content, every LTR run in its own isolated box.
  #align(right, ar[ISO التاريخ: #data.dateAr / #iso(data.dateEn) — الإجمالي #iso[#data.total KWD]])
  // CELLS: one language per cell.
  #table(columns: (1fr, 1fr),
    ar[التاريخ: #data.dateAr], en[Date: #data.dateEn],
    ar[الإجمالي], en[Total: #data.total KWD],
  )
]
