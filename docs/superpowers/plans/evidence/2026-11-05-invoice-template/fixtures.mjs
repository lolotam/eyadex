const names = {
  KWD: ["دينار كويتي", "Kuwaiti dinar"],
  BHD: ["دينار بحريني", "Bahraini dinar"],
  OMR: ["ريال عماني", "Omani rial"],
  SAR: ["ريال سعودي", "Saudi riyal"],
  AED: ["درهم إماراتي", "UAE dirham"],
  QAR: ["ريال قطري", "Qatari riyal"],
};
function base(name, currency = "KWD") {
  return {
    name,
    currency,
    currencyAr: names[currency][0],
    currencyEn: names[currency][1],
    version: "7",
    clinicAr: "عيادة تجريبية متعددة التخصصات",
    clinicEn: "Synthetic Multispecialty Clinic",
    header: [
      { ar: "الفرع التجريبي", en: "Synthetic Branch" },
      { ar: "عنوان صناعي للاختبار", en: "Synthetic test address" },
      { ar: "هاتف الاختبار", en: "TEST-PHONE" },
      { ar: "رقم التسجيل التجاري", en: "CR-SYNTHETIC" },
    ],
    number: `SYN-${name}-2026-000001`,
    dateAr: "٥ نوفمبر ٢٠٢٦",
    dateEn: "05 November 2026",
    statusAr: "صادرة",
    statusEn: "Issued",
    patientName: "مُحَمَّد عَلِيّ تجريبي",
    lines: [],
    totals: [],
  };
}
function line(position, total, unitPrice = total, discount = "0.000") {
  return {
    position: String(position),
    descriptionAr: "مُراجَعَة طبية",
    descriptionEn: "Clinical follow-up",
    quantity: "1",
    unitPrice,
    discount,
    total,
  };
}
function totals(subtotal, discount, tax, total) {
  return [
    { ar: "المجموع الفرعي", en: "Subtotal", value: subtotal },
    { ar: "الخصم", en: "Discount", value: discount },
    ...(tax === "0.000" ? [] : [{ ar: "الضريبة", en: "Tax", value: tax }]),
    { ar: "الإجمالي", en: "Total", value: total },
  ];
}
// Values transcribed from finance-design §8b.1. These fixtures do not compute money.
export function fixtures(logoBytes) {
  const e1 = {
    ...base("E1"),
    invoiceDiscountReason: "خصم تجريبي",
    lines: [line(1, "0.499", "0.500"), line(2, "0.500")],
    totals: totals("1.000", "0.001", "0.000", "0.999"),
    logoBytes,
  };
  const e2 = {
    ...base("E2"),
    lines: [line(1, "0.000"), line(2, "0.000", "0.001"), line(3, "0.001")],
    totals: totals("0.002", "0.001", "0.000", "0.001"),
    header: base("E2").header.slice(0, 3),
    invoiceDiscountReason: "تسوية بسيطة",
  };
  const e3 = {
    ...base("E3"),
    lines: [
      {
        ...line(1, "0.000", "12.500", "12.500"),
        discountReasonAr: "خصم كامل",
        discountReasonEn: "Full discount",
      },
    ],
    totals: totals("12.500", "12.500", "0.000", "0.000"),
  };
  const e4 = {
    ...base("E4"),
    invoiceDiscountReason: "خصم التقريب",
    lines: [line(1, "0.002", "0.003"), line(2, "0.004")],
    totals: totals("0.007", "0.001", "0.001", "0.007"),
  };
  const e5 = {
    ...base("E5"),
    lines: [
      {
        ...line(1, "11.110", "12.345", "1.235"),
        discountReasonAr: "خصم تجريبي",
        discountReasonEn: "Synthetic discount",
      },
    ],
    totals: totals("12.345", "1.235", "0.000", "11.110"),
  };
  const long = {
    ...base("FIFTY"),
    lines: Array.from({ length: 50 }, (_, i) => line(i + 1, "15.000")),
    totals: totals("750.000", "0.000", "0.000", "750.000"),
  };
  const voided = {
    ...long,
    name: "VOID",
    number: "SYN-VOID-000001",
    statusAr: "ملغاة",
    statusEn: "Void",
    voidReason: "إلغاء تجريبي",
    voidDate: "06 November 2026",
  };
  const currencies = Object.keys(names)
    .filter((c) => c !== "KWD")
    .map((currency) => ({
      ...base(currency, currency),
      lines: [line(1, currency === "BHD" || currency === "OMR" ? "1.000" : "1.00")],
      totals: [
        {
          ar: "الإجمالي",
          en: "Total",
          value: currency === "BHD" || currency === "OMR" ? "1.000" : "1.00",
        },
      ],
    }));
  const mixedWords = [
    "مبنى12",
    "12مبنى",
    "مُحَمَّد-test",
    "test-مُحَمَّد",
    "مُحَمَّدAB12",
    "مبنى12.50",
    "فاتورة2026/11/05",
    "(مبنى12)",
    "مبنى١٢",
    "مبنى١٢٫٥٠",
    "عَلِيّ،",
    "شارع:12",
    "مبنىA&B",
    "شارع12:30",
    "مبنىcafe\u0301",
    "عَلِيّ!",
    "مبنى[12]",
    "مبنى$12",
    "مبنى€12",
    "مبنى12%",
    "مبنى—12",
    "مبنى–12",
    "مبنى؟!",
    "مبنىA[B]",
  ];
  const mixed = {
    ...base("MIXED"),
    lines: mixedWords.map((word, index) => ({
      ...line(index + 1, "1.000"),
      descriptionAr: word,
      descriptionEn: "Mixed token " + (index + 1),
    })),
    totals: totals("24.000", "0.000", "0.000", "24.000"),
  };
  const longWord = {
    ...base("LONGWORD"),
    lines: [
      {
        ...line(1, "1.000"),
        descriptionEn: "W".repeat(45),
        descriptionAr: "مراجعة".repeat(33),
        discountReasonAr: "سبب تجريبي",
        discountReasonEn: "W".repeat(300),
      },
    ],
    totals: totals("1.000", "0.000", "0.000", "1.000"),
  };
  const maximum = {
    ...long,
    name: "MAXCONTENT",
    number: "SYN-MAXCONTENT-000001",
    lines: long.lines.map((line) => ({
      ...line,
      descriptionAr: "وصف طبي تجريبي طويل ".repeat(11).slice(0, 200),
      descriptionEn: "A long synthetic clinical description ".repeat(6).slice(0, 200),
      discountReasonAr: "سبب خصم تجريبي ".repeat(20).slice(0, 300),
      discountReasonEn: "Synthetic discount reason ".repeat(12).slice(0, 300),
    })),
  };
  const injection = {
    ...e3,
    name: "INJECTION",
    number: "SYN-INJECTION-000001",
    patientName: 'Synthetic #panic("must stay text")',
    lines: [
      {
        ...line(1, "1.000"),
        descriptionAr: 'نص #include("test")',
        descriptionEn: "Literal [brackets] and \\ slashes",
      },
    ],
    totals: totals("1.000", "0.000", "0.000", "1.000"),
  };
  return [e1, e2, e3, e4, e5, long, voided, mixed, longWord, ...currencies, maximum, injection];
}
