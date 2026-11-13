export function receiptFixtures() {
  const base = {
    clinicAr: "عيادة تجريبية",
    clinicEn: "Synthetic Clinic",
    header: [{ ar: "فرع تجريبي", en: "Synthetic Branch" }],
    number: "SYN-R-2026-000001",
    invoiceNumber: "SYN-I-2026-000001",
    patientName: "مُحَمَّد تجريبي",
    dateAr: "٢ يناير ٢٠٢٦",
    dateEn: "2 January 2026",
    time: "01:30",
    methodAr: "نقدًا",
    methodEn: "Cash",
    reference: null,
    amount: "1.234",
    currencyAr: "دينار كويتي",
    currencyEn: "KWD",
  };
  return [
    { name: "cash", model: base },
    {
      name: "reference",
      model: { ...base, methodAr: "كي نت", methodEn: "KNET", reference: "R".repeat(60) },
    },
    {
      name: "large",
      model: { ...base, amount: "9223372036854775.807", reference: "مرجع تجريبي طويل" },
    },
    {
      name: "literal",
      model: {
        ...base,
        patientName: 'Synthetic #panic("literal")',
        currencyEn: "SAR",
        currencyAr: "ريال سعودي",
        amount: "12.34",
      },
    },
  ];
}
