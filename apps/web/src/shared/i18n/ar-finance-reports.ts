import type { enFinanceReports } from "./en-finance-reports";

type Strings<T> = { [K in keyof T]: T[K] extends string ? string : Strings<T[K]> };

// تقارير F3 على الشاشة (المواصفة §3–§6).
export const arFinanceReports: Strings<typeof enFinanceReports> = {
  financeReports: {
    available: {
      title: "التقارير المتاحة",
      subtitle: "التقارير التي تسمح لك صلاحياتك بفتحها.",
      open: "فتح التقرير",
    },
    names: { daily_takings: "الإيراد اليومي", period_summary: "ملخص الفترة" },
    descriptions: {
      daily_takings: "المقبوض والمصروف لكل يوم أو شهر وفرع وطريقة دفع.",
      period_summary: "المفوتر والمحصّل والمسترد والرصيد المستخدم لكل فترة وفرع.",
    },
    note: "الفترات أيام عمل العيادة. المقبوض في شهر بتقرير الإيراد اليومي يساوي المحصّل في نفس الشهر بتقرير ملخص الفترة.",
    creditHelp: "الرصيد المستخدم للمعلومية فقط، وليس مبلغًا محصّلًا.",
    filters: {
      title: "عوامل التصفية",
      from: "من",
      to: "إلى",
      zoneHint: "الأيام حسب توقيت العيادة ({zone}).",
      branch: "الفرع",
      allBranches: "كل الفروع المتاحة لك",
      inactive: "{name} (غير نشط)",
      branchesError: "تعذّر تحميل قائمة الفروع.",
      groupBy: "التجميع حسب",
      group: { day: "اليوم", month: "الشهر" },
    },
    issues: {
      required: "أدخل التاريخ.",
      date: "أدخل تاريخًا صحيحًا.",
      dateOrder: "يجب أن يكون تاريخ النهاية في يوم البداية أو بعده.",
      rangeTooLong: "التقرير على الشاشة يغطي 366 يومًا على الأكثر.",
    },
    states: {
      loading: "جارٍ تحميل التقرير…",
      empty: "لا توجد بيانات في هذه الفترة",
      error: "تعذّر تحميل التقرير.",
      retry: "إعادة المحاولة",
    },
    actions: {
      export: "تصدير هذا التقرير",
      print: "طباعة",
      back: "كل التقارير",
    },
    exportTitle: "تصدير هذا التقرير",
    total: "الإجمالي",
    columns: {
      period: "الفترة",
      branch: "الفرع",
      method: "طريقة الدفع",
      in: "المقبوض",
      out: "المصروف",
      net: "الصافي",
      invoiced: "المفوتر",
      discount: "الخصم",
      tax: "الضريبة",
      collected: "المحصّل",
      refunded: "المسترد",
      creditApplied: "الرصيد المستخدم",
      voidCount: "الفواتير الملغاة",
    },
  },
};
