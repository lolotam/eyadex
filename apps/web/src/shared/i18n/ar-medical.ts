// نصوص الموديول الطبي (P2): أكواد الأخطاء المتجمدة مع العقود (R1-11) وأسماء سجل التدقيق (R3-4).
// نصوص الشاشات نفسها بتيجي مع خطة الويب (P2 Task 13).
export const arMedicalErrors = {
  appointment_not_arrived: "لا تبدأ الزيارة إلا بعد تسجيل وصول المراجع للموعد",
  visit_exists: "توجد زيارة لهذا الموعد بالفعل",
  visit_signed: "الزيارة موقّعة ولا يمكن تعديلها؛ أضف ملحقًا بدلًا من ذلك",
  visit_not_signed: "لا يمكن إضافة ملحق قبل توقيع الزيارة",
  visit_not_provider: "مقدّم الخدمة في الزيارة فقط يمكنه تعديلها أو توقيعها",
  visit_empty: "اكتب شيئًا في ملاحظة الزيارة قبل توقيعها",
  icd10_unknown: "رمز ICD-10-CM غير موجود في القائمة",
  medicine_name_taken: "يوجد دواء آخر في قائمة العيادة بهذا الاسم",
  attachment_too_large: "الملف أكبر من 20 ميجابايت",
  attachment_type: "نوع الملف غير مدعوم؛ ارفع صورة JPEG أو PNG أو WebP أو ملف PDF",
  attachment_patient_mismatch: "هذه الزيارة لا تخص ملف هذا المراجع",
  role_self_change: "لا يمكنك تغيير دورك بنفسك",
};

export const arMedicalAuditEntities = {
  visit: "زيارة",
  visit_addendum: "ملحق زيارة",
  diagnosis: "تشخيص",
  prescription: "وصفة طبية",
  medical_profile: "الملف الطبي",
  attachment: "مرفق",
  medicine: "دواء",
};

export const arMedicalAuditActions = {
  visit: {
    started: "بدء زيارة",
    opened: "فتح زيارة",
    note_saved: "حفظ ملاحظة الزيارة",
    signed: "توقيع زيارة",
    cancelled: "إلغاء زيارة",
    addendum_added: "إضافة ملحق",
    diagnoses_saved: "حفظ التشخيصات",
    prescription_saved: "حفظ الوصفة",
    prescription_printed: "طباعة الوصفة",
    searched: "بحث في ملاحظات الزيارات",
    walk_in_searched: "بحث عن مراجع لزيارة بدون موعد",
    previews_listed: "عرض ملخصات الزيارات",
  },
  medical_profile: { opened: "فتح الملف الطبي", saved: "حفظ الملف الطبي" },
  attachment: {
    uploaded: "رفع مرفق",
    downloaded: "تنزيل مرفق",
    archived: "أرشفة مرفق",
    listed: "عرض قائمة المرفقات",
  },
  medicine: {
    created: "إضافة دواء",
    updated: "تعديل دواء",
    deactivated: "تعطيل دواء",
    reactivated: "إعادة تفعيل دواء",
  },
};
