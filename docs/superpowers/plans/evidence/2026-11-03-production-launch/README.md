# أدلة دفعة بدء إقفال الإطلاق — 2026-11-03

الحالة: بدء التنفيذ، وليست شهادة إطلاق. الأساس `7009e4972c8ec3ce1ea1fe6dfd29ff270ab4e6b9`.

## قرارات المالك

- اعتماد Amiri وإضافة qpdf وتثبيت نسخ أدوات استخراج النص في CI، كما طلبت مواصفة PDF §7.
- الاختبارات الآلية المعزولة كافية لتغطية الأدوار والشهور المتعددة مع توثيق حدود staging صراحةً.
- التفويض بتنفيذ خطة الإقفال حتى إطلاق الإنتاج لا يلغي بوابات المراجعة والعزل والتحقق.

## تحقق محلي منفذ

البيئة: Node `v24.21.0`، pnpm `12.5.1`، PostgreSQL `18.6` محلي منفصل، وRedis محلي منفصل؛ لا استخدام لقاعدة إنتاج في الاختبارات.

| الأمر                                                                                                                                                                                                                                                                                                                                                                                          | النتيجة                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `pnpm --filter @eyadex/api test -- src/modules/billing/__tests__/report-range.spec.ts src/modules/billing/__tests__/report-scope.spec.ts src/modules/billing/__tests__/report-export-admission.spec.ts`                                                                                                                                                                                        | 3 ملفات، 36 اختبارًا ناجحًا               |
| `pnpm --filter @eyadex/web test -- src/shared/api/mock/mock-reports-access.test.ts src/shared/api/mock/mock-reports-days.test.ts src/shared/api/mock/mock-report-export-run-access.test.ts src/shared/api/mock/mock-report-exports-access.test.ts`                                                                                                                                             | 4 ملفات، 68 اختبارًا ناجحًا               |
| `pnpm --filter '@eyadex/api^...' --filter '@eyadex/worker...' build`                                                                                                                                                                                                                                                                                                                           | نجح بناء الاعتمادات والـworker            |
| `pnpm --filter @eyadex/api test:db -- src/modules/billing/__tests__/report-months.db.spec.ts src/modules/billing/__tests__/report-analytics.db.spec.ts src/modules/billing/__tests__/report-takings.db.spec.ts src/modules/billing/__tests__/report-branch-options.db.spec.ts src/modules/billing/__tests__/report-own.db.spec.ts src/modules/billing/__tests__/report-export-flow.db.spec.ts` | 6 ملفات، 47 اختبارًا ناجحًا، 177.47 ثانية |

أضيف `report-months.db.spec.ts`: بيانات صناعية عبر HTTP في قاعدة الاختبار فقط؛ timestamps تضبط داخل fixture محلية فقط. يثبت فصل R1/R2 لشهري يونيو ويوليو، استبعاد الفرع غير الممنوح، ونقل فاتورة عند `2026-06-30T21:00:00Z` إلى يوليو بتوقيت الكويت، مع بقاء آخر ثانية قبلها في يونيو. لا تعديل لتواريخ staging أو الإنتاج.

اختبارات DB القائمة أثبتت صلاحيات analytics/own/branch وخيارات الفروع ومسار طلب التصدير والـworker وسحب الوصول. لا تعد الأدلة تجربة كل شخصية فعلية في staging.

## تحقق تشغيل للقراءة فقط

بوابات الدفعة المحلية اكتملت أيضًا: `pnpm typecheck` ناجح (15 مهمة)، `pnpm lint` ناجح بلا أخطاء ومع 11 تحذيرًا في ملفات واجهة لم تعدلها الدفعة، و`NITRO_PRESET=node-server pnpm build:all` ناجح (9 مهام). Prettier و`git diff --check` ناجحان. مراجعة Codex المحلية للدفعة لم تجد عيبًا؛ ليست بديلًا عن مراجعة رأس PR.

اختبارات الوحدة شغلت بالتتابع لكل حزمة: observability 690، db 247، api 832، web 2179، auth 25، ids 12 (3 Node و9 Vitest)، secrets 50، contracts 583، worker 790؛ المجموع 5,408 ناجحًا. اختبارات DB الـ47 إضافية؛ الاختبارات المختارة أعلاه تتداخل مع اختبارات الوحدة ولا تجمع مرتين.

من داخل حاويتي PostgreSQL الخاصتين بـEyadex فقط، نفذت `SELECT count(*) FROM icd10_codes` و`SELECT count(*) FROM schema_migrations`:

| البيئة     | صفوف ICD-10-CM | migrations مسجلة |
| ---------- | -------------- | ---------------- |
| staging    | 98,403         | 71               |
| production | 98,403         | 71               |

العدد يثبت وجود المرجع؛ لا يثبت محتوى كل كود أو تنفيذ `medical-release-catch-up.sql`. لم ينفذ reload أو migration أو تعديل إعدادات أو كتابة بيانات عيادة.

محاولة فحص catch-up اللاحقة لم تنفذ: موصل التشغيل أعاد `The connector is unavailable, changed, disabled, or requires authentication. Inspect the hub and refresh tools.`؛ يظل الفحص مفتوحًا، ولا نستنتج نتيجته من عدادات المرجع.

## تجهيز تجربة PDF منفصلة

خارج المستودع في `F:/Dev/Temp/eyadex-launch-pdf-20261103`: أعيد تنزيل Typst 0.15.1 والخطين Amiri Regular/Bold، وبصمات SHA256 تطابق المثبتة في أدلة 2026-10-15. بنيت صورة تجربة محلية بـqpdf 12.3.2 ومحول C++ يستعمل `processMemoryFile` و`createFromJSON` من libqpdf، دون ملف PDF كمدخل على القرص. تجربة صناعية من 40 كلمة، دون شبكة ومع جذر للقراءة فقط، نجحت في مسار Typst ثم JSON ثم PDF (21,077 بايت أصلي، 54,787 JSON، 21,694 بعد roundtrip). تحفظ مخرجات التجربة الصناعية فقط كأدلة مؤقتة. هذا ليس اختبار استخراج النص أو إثبات سلامة الرسم أو قياس staging، ولا كود إنتاج.

## المتبقي

- إعادة إنتاج تجربة استخراج PDF؛ مجلد probe5 القديم موجود لكن تقريره وملفاته غير متاحة؛ لا نعلن نجاح R2 منه.
- قياس PDF على staging قبل حسم API مقابل worker.
- اختبار ضريبة staging يتطلب جلسة منصة آمنة وTOTP.
- فحص catch-up الطبي والنسخ الاحتياطي والاستعادة ودورة العيادة.
- حساب الإنتاج المحدد وفحص صلاحياته، والتصدير الحقيقي النهائي، وإيصال إطلاق نهائي.
