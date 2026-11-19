/**
 * العلامة اللي بترجع في `details.code` مع 503 لما راسم الـ PDF الافتراضي مش مفعّل بعد، فالواجهة تفرّق بينها
 * وبين 503 عادي (Redis واقع مثلًا) من غير كود خطأ جديد في العقود.
 */
export const PDF_UNAVAILABLE = "pdf_unavailable";
