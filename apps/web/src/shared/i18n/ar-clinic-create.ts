import type { enClinicCreate } from "./en-clinic-create";

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

// The create-clinic form (platform area): its sections and fields, pre-filled limits included.
export const arClinicCreate: Shape<typeof enClinicCreate> = {
  createTitle: "إنشاء عيادة",
  createSubtitle: "تبدأ العيادة بالفترة التجريبية الافتراضية للمنصة، ويصل لمديرها الأول دعوة.",
  sectionClinic: "العيادة",
  sectionAdmin: "مدير العيادة الأول",
  sectionLimits: "الحدود والموديولات",
  limitsHint: "معبّأة من إعدادات المنصة، ويمكن تغييرها لهذه العيادة.",
  fields: {
    nameAr: "الاسم (عربي)",
    nameEn: "الاسم (إنجليزي)",
    slug: "المعرّف",
    slugHint: "حروف إنجليزية صغيرة وأرقام وشرطات.",
    slugPreview: "العنوان المستقبلي: {address}",
    specialty: "التخصص",
    defaultLanguage: "اللغة الافتراضية",
    timezone: "المنطقة الزمنية",
    adminName: "اسم المدير الكامل",
    adminEmail: "بريد المدير",
  },
};
