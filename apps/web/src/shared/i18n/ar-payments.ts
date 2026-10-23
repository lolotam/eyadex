import type { enPayments } from "./en-payments";

type Strings<T> = { [K in keyof T]: T[K] extends string ? string : Strings<T[K]> };

export const arPayments: Strings<typeof enPayments> = {
  payments: {
    panel: {
      title: "الدفع",
      paid: "المدفوع",
      owed: "المتبقي",
      credit: "رصيد المراجع",
      movements: "الحركات",
      noMovements: "لا توجد مدفوعات بعد",
      loadError: "تعذر تحميل المدفوعات",
      settingsError: "تعذر تحميل طرق الدفع المفعّلة",
      record: "تسجيل دفعة",
      useCredit: "استخدام الرصيد",
    },
    state: { unpaid: "غير مدفوعة", partly_paid: "مدفوعة جزئيًا", paid: "مدفوعة" },
    movement: {
      payment: "إيصال {number}",
      credit_applied: "استخدام رصيد",
      credit_released: "تحويل إلى رصيد — {cause}",
      refund: "استرداد {number}",
    },
    cause: {
      invoice_edited: "تعديل الفاتورة",
      invoice_voided: "إلغاء الفاتورة",
      refund: "استرداد",
    },
    method: { cash: "نقدًا", knet: "كي نت", bank_transfer: "تحويل بنكي", other: "أخرى" },
    dialog: {
      recordTitle: "تسجيل دفعة على {number}",
      creditTitle: "استخدام رصيد المراجع على {number}",
      method: "طريقة الدفع",
      amount: "المبلغ ({currency})",
      reference: "رقم الموافقة أو التحويل",
      optional: "اختياري",
      amountInvalid: "اكتب مبلغًا صحيحًا",
      submit: "تسجيل",
      apply: "استخدام",
      recorded: "تم تسجيل الدفعة — إيصال {number}",
      applied: "تم استخدام الرصيد",
      available: "الرصيد المتاح: {amount}",
      noMethods: "لا توجد طريقة دفع مفعّلة",
    },
    releaseWarning: "سيتحول المبلغ الزائد إلى رصيد للمراجع",
    paidChangedNotice:
      "المبلغ المدفوع على هذه الفاتورة تغيّر بعد محاولتك السابقة؛ راجع الحركات قبل الإرسال",
    list: { settlement: "الدفع", allSettlements: "الكل" },
    methods: {
      title: "طرق الدفع",
      subtitle: "الطرق المفعّلة تظهر عند تسجيل دفعة.",
      lastOn: "يجب أن تبقى طريقة واحدة على الأقل مفعّلة",
      save: "حفظ",
      saved: "تم حفظ طرق الدفع",
      readOnly: "يغيّرها فقط من يملك صلاحية تعديل إعدادات العيادة.",
    },
    audit: { on: "مفعّل", off: "موقوف" },
  },
};
