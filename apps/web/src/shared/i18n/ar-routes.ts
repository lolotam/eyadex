// Navigation labels and each page's head (browser tab title and description, ADR-0025).
// The people a clinic serves are "المراجعون" here, never "المرضى"; the brand stays `Eyadex`.
export const arRoutes = {
  nav: {
    platformArea: "المنصة",
    clinicArea: "العيادة",
    overview: "نظرة عامة",
    clinics: "العيادات",
    team: "فريق المنصة",
    audit: "سجل التدقيق",
    settings: "الإعدادات",
    branches: "الفروع",
    users: "المستخدمون",
    roles: "الأدوار والصلاحيات",
    patients: "المراجعون",
    appointments: "المواعيد",
    visits: "الزيارات",
    account: "حسابي",
    menu: "القائمة",
  },
  routes: {
    login: { title: "تسجيل الدخول", description: "سجّل الدخول إلى Eyadex." },
    forbidden: { title: "غير مسموح", description: "ليست لديك صلاحية الوصول إلى هذه الصفحة." },
    invite: { title: "قبول الدعوة", description: "انضم إلى عيادتك على Eyadex." },
    clinic: { title: "العيادة", description: "مساحة عمل العيادة." },
    clinicOverview: {
      title: "نظرة عامة على العيادة",
      description: "الأعداد والاشتراك والاستخدام في عيادتك.",
    },
    clinicAccount: { title: "حسابي", description: "ملفك الشخصي ولغتك." },
    clinicAppointments: {
      title: "المواعيد",
      description: "يوم الفرع: حجز المواعيد وتغييرها ومتابعتها.",
    },
    clinicAudit: { title: "سجل التدقيق", description: "كل تغيير داخل العيادة." },
    clinicBranches: {
      title: "فروع العيادة",
      description: "إدارة مواقع العيادة وبيانات التواصل وحالة التشغيل.",
    },
    clinicPatients: { title: "المراجعون", description: "ملفات المراجعين وتسجيلهم." },
    clinicVisits: {
      title: "الزيارات",
      description: "ابدأ زيارة مباشرة لمراجع ليس لديه موعد.",
    },
    clinicVisit: {
      title: "زيارة",
      description: "ملاحظات الطبيب والتشخيص والروشتة والمرفقات لزيارة.",
    },
    clinicSettingsNotifications: {
      title: "الإشعارات",
      description: "الرسائل التي ترسلها العيادة للمراجعين.",
    },
    clinicSettingsWhatsapp: {
      title: "واتساب",
      description: "ربط رقم واتساب العيادة لرسائل المراجعين.",
    },
    clinicSettingsEmail: {
      title: "مرسلو البريد",
      description: "مرسل بريد العيادة الأساسي والاحتياطي.",
    },
    clinicSettingsMedicines: {
      title: "الأدوية",
      description: "قائمة الأدوية المتكررة في العيادة.",
    },
    clinicPatientFile: {
      title: "ملف المراجع",
      description: "ملف مراجع؛ كل فتح له يُسجَّل في سجل التدقيق.",
    },
    clinicRoles: {
      title: "الأدوار والصلاحيات",
      description: "حدّد من يستطيع فعل ماذا في العيادة.",
    },
    clinicSettings: { title: "إعدادات العيادة", description: "تفضيلات العيادة." },
    clinicSettingsServices: { title: "الخدمات", description: "خدمات العيادة ومدة كل خدمة." },
    clinicSettingsSchedules: {
      title: "جداول العمل",
      description: "ساعات العمل الأسبوعية والإجازات لكل مقدّم خدمة.",
    },
    clinicUsers: { title: "المستخدمون", description: "ادعُ مستخدمي العيادة وأدِرهم." },
    platform: { title: "المنصة", description: "إدارة منصة Eyadex." },
    platformOverview: {
      title: "نظرة عامة على المنصة",
      description: "العيادات حسب الحالة والاشتراكات التي تقترب من الانتهاء.",
    },
    platformAudit: { title: "سجل تدقيق المنصة", description: "كل تغيير على مستوى المنصة." },
    platformClinics: {
      title: "العيادات",
      description: "ابحث عن أي عيادة على المنصة وأدِرها.",
    },
    platformClinic: {
      title: "العيادة",
      description: "تفاصيل العيادة واشتراكها ووحداتها ومستخدموها وفروعها.",
    },
    platformNewClinic: {
      title: "عيادة جديدة",
      description: "أنشئ عيادة مع أول مدير لها.",
    },
    platformSettings: { title: "إعدادات المنصة", description: "إعدادات على مستوى المنصة كلها." },
    platformTeam: { title: "فريق المنصة", description: "حسابات فريق المنصة." },
  },
};
