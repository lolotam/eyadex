/**
 * كل فشل جاي من PostgreSQL بيتغلّف في `DatabaseError` قبل ما يوصل لوجهة الـ API.
 *
 * ليه التحويل ده مطلوب أصلاً: Drizzle بيرمي `DrizzleQueryError` ورسالته فيها الـ SQL كله والـ
 * parameters، واللي تحتها `PostgresError` بيحمل `detail` زيه `Failing row contains (...)` —
 * يعني بيانات مراجع في نص الخطأ. الخطأ ده بيوصل لوجهة الـ API ولسجل الأخطاء، فاللي جواه لازم
 * يبقى معرّفات بس (SQLSTATE واسم القيد والجدول والعمود) وصفر بيانات.
 *
 * وليه التحويل بيتقصر على **فشل الـ driver الحقيقي**: `DrizzleQueryError` (أو `PostgresError` لو
 * طلع لوحده من غير غلاف). خطأ `fn` بيحمل `code` على شكل SQLSTATE — مثل `{ code: "23505" }` من
 * validation أو استنساخ exception عنده الحقل ده — بيرجع **زي ما هو**، لأنه مش فشل قاعدة بيانات
 * وتحويله بيبعت كود غلط لوجهة الـ API. عشان كده الفحص بالـ class الحقيقي اللي رماه الـ driver
 * مش بالموديل، و**مش** بنمشي في سلسلة `cause` بتاع error أي واحد: سلسلة `cause` عند الـ driver
 * نفسه معروفة (`DrizzleQueryError.cause` = `PostgresError`)، وعند أي حد تاني الـ `cause` ممكن
 * يكون أي حاجة.
 */
import { DrizzleQueryError } from "drizzle-orm";
import postgres from "postgres";

/**
 * postgres.js بيلصق صنف الخطأ بتاعه على الـ factory نفسها
 * (`Object.assign(Postgres, { PostgresError })` في `src/index.js`)، بس الـ types المرفقة
 * بتمرّر الستاتيك على الـ **instance** بس (`Sql.PostgresError`) — فبنقراه من هنا. الحقل موجود في
 * النسخة مثبّتة (`3.4.9`) و`database-error.spec.ts` بيتأكد إن `typeof === "function"`.
 */
const postgresErrorClass = (postgres as unknown as { readonly PostgresError?: unknown })
  .PostgresError;

/** ctor الـ `PostgresError` الحقيقي، أو undefined لو النسخة المثبّتة ماعندهاش. */
type PostgresErrorClass = new (fields: Record<string, unknown>) => Error;

/**
 * `instanceof` على class حقيقية، مش على اسم: حد يكتب `class PostgresError extends Error` مش
 * هيمرّ من الفحص ده.
 *
 * @returns الـ ctor لو متاح، أو undefined
 */
const postgresErrorCtor = (): PostgresErrorClass | undefined =>
  typeof postgresErrorClass === "function"
    ? (postgresErrorClass as unknown as PostgresErrorClass)
    : undefined;

/** shape الـ driver: معرّفات جداول وأعمدة وقواعد، مش بيانات صفوف. */
type DriverFailure = {
  readonly code?: unknown;
  readonly constraint_name?: unknown;
  readonly schema_name?: unknown;
  readonly table_name?: unknown;
  readonly column_name?: unknown;
};

/** اللي بيتقوله `DatabaseError`: كود SQLSTATE والمعرّفات الموجودة، وبس. */
export type DatabaseFailureFacts = {
  readonly code: string;
  readonly constraint?: string;
  readonly schema?: string;
  readonly table?: string;
  readonly column?: string;
};

/**
 * بيحوّل الـ SQLSTATE لشكله النهائي (أو `undefined` لو مش SQLSTATE) مع المعرّفات اللي
 * PostgreSQL سماها. الـ `cause` بتاع `DrizzleQueryError` هو `PostgresError` الحقيقي، وده اللي
 * بيقرأ منه الكود والقيود.
 *
 * @param error الـ failure بعد التأكد إنها من الـ driver
 * @returns المعرّفات أو undefined
 */
const driverFacts = (error: unknown): DatabaseFailureFacts | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const shaped = error as DriverFailure;
  const code = shaped.code;
  if (typeof code !== "string") return undefined;
  const facts: {
    code: string;
    constraint?: string;
    schema?: string;
    table?: string;
    column?: string;
  } = { code };
  const constraint = shaped.constraint_name;
  const schema = shaped.schema_name;
  const table = shaped.table_name;
  const column = shaped.column_name;
  if (typeof constraint === "string" && constraint !== "") facts.constraint = constraint;
  if (typeof schema === "string" && schema !== "") facts.schema = schema;
  if (typeof table === "string" && table !== "") facts.table = table;
  if (typeof column === "string" && column !== "") facts.column = column;
  return facts;
};

/**
 * الـ failure الحقيقي من الـ driver: `DrizzleQueryError` (نفحص الـ `cause` بتاعه بس — مستوى
 * واحد، وده الشكل اللي Drizzle بيرميه) أو `PostgresError` لو طلع من غير غلاف. أي error تاني
 * بيرجع `undefined` من غير ما نلمس `cause` بتاعه.
 *
 * @param error الخطأ اللي طلع من الـ transaction
 * @returns معرّفات الـ SQLSTATE أو undefined لو مش failure حقيقي
 */
const findDriverFailure = (error: unknown): DatabaseFailureFacts | undefined => {
  const ctor = postgresErrorCtor();
  if (ctor === undefined) return undefined;
  if (error instanceof DrizzleQueryError) {
    // سبب الـ DrizzleQueryError هو PostgresError (postgres.js). أي حاجة تانية فيه — حتى لو
    // shape بتاعها SQLSTATE — مش failure قاعدة بيانات، فمش بنحوّلها.
    const cause = (error as { readonly cause?: unknown }).cause;
    return cause instanceof ctor ? driverFacts(cause) : undefined;
  }
  return error instanceof ctor ? driverFacts(error) : undefined;
};

/**
 * خطأ قاعدة البيانات بعد التنضيف: `name` و`code` والمعرّفات، ورسالة `database error <code>`.
 * مفيش `cause` ولا SQL ولا parameters ولا `detail` — والمكدس بتاعه جديد بالكامل.
 */
export class DatabaseError extends Error {
  override readonly name = "DatabaseError";
  /** SQLSTATE: `23505` تعارض تكرار، `42501` منع صلاحية، `57014` انتهاء المهلة. */
  readonly code: string;
  /** اسم القيد اللي اتخالف، لو PostgreSQL قاله. */
  readonly constraint?: string;
  /** اسم السكيما، لو PostgreSQL قاله. */
  readonly schema?: string;
  /** اسم الجدول، لو PostgreSQL قاله. */
  readonly table?: string;
  /** اسم العمود، لو PostgreSQL قاله. */
  readonly column?: string;

  constructor(facts: DatabaseFailureFacts) {
    super(
      facts.constraint === undefined
        ? `database error ${facts.code}`
        : `database error ${facts.code} (constraint ${facts.constraint})`,
    );
    this.code = facts.code;
    if (facts.constraint !== undefined) this.constraint = facts.constraint;
    if (facts.schema !== undefined) this.schema = facts.schema;
    if (facts.table !== undefined) this.table = facts.table;
    if (facts.column !== undefined) this.column = facts.column;
  }
}

/** أقصى عمق بندوّر فيه في سلسلة الـ `cause` — سلسلة أطول من كده مش خطأ حقيقي، وبنقفل عليها. */
const MAX_CAUSE_DEPTH = 8;

/** الأماكن اللي خطأ بيشيل فيها أخطاء تانية: `cause` و`errors` بتاع `AggregateError`. */
type ErrorContainer = { cause?: unknown; errors?: unknown };

/**
 * بيمسح أي فشل driver حقيقي **جوه** خطأ `fn` نفسه، ويحطّ مكانه `DatabaseError` معرّفات بس.
 *
 * ليه: `fn` ممكن يمسك `PostgresError` ويرميه ملفوف (`new Error("…", { cause })`). الخطأ اللي برّه
 * بتاع `fn` ومش بيتحوّل — بس الـ `cause` جواه فيه `detail` بتاع PostgreSQL، وده ممكن يبقى الصف
 * كله اللي فشل (بيانات مراجع)، و`DrizzleQueryError` فيه الـ query والـ params كمان. (Codex على
 * PR #22، P1.) الخطأ الخارجي بيفضل هو نفسه (نفس الـ object ونفس الرسالة)؛ اللي بيتشال هو بيانات
 * الـ driver بس. السلسلة محدودة بعمق ومحمية من الدوائر.
 *
 * @param error خطأ `fn` كما هو
 * @returns الـ facts بتاعة أول فشل driver اتساب لو ماقدرناش نستبدله (object متجمّد)، وإلا `undefined`
 */
const scrubDriverCauses = (error: unknown): DatabaseFailureFacts | undefined => {
  const seen = new Set<unknown>();
  const visit = (node: unknown, depth: number): DatabaseFailureFacts | undefined => {
    if (typeof node !== "object" || node === null || seen.has(node)) return undefined;
    if (depth > MAX_CAUSE_DEPTH) return undefined;
    seen.add(node);
    const container = node as ErrorContainer;
    const children: Array<[holder: object, key: PropertyKey, value: unknown]> = [];
    if ("cause" in container) children.push([container, "cause", container.cause]);
    if (Array.isArray(container.errors)) {
      container.errors.forEach((value, index) =>
        children.push([container.errors as object, index, value]),
      );
    }
    for (const [holder, key, value] of children) {
      const facts = value instanceof DatabaseError ? undefined : findDriverFailure(value);
      if (facts !== undefined) {
        if (!Reflect.set(holder, key, new DatabaseError(facts))) return facts;
        continue;
      }
      const left = visit(value, depth + 1);
      if (left !== undefined) return left;
    }
    return undefined;
  };
  return visit(error, 0);
};

/**
 * بيحوّل فشل الـ driver الحقيقي لـ `DatabaseError` معرّفات بس. أي حاجة تانية — خطأ من `fn`
 * نفسه، أو خطأ اتصال من غير SQLSTATE، أو خطأ من wrapper — بترجع **نفسها** زي ما هي، حتى لو
 * كان شكلها SQLSTATE؛ بس أي فشل driver حقيقي **جواها** (`cause`، `AggregateError.errors`)
 * بيتشال بيانات قبل ما يعدّي (شوف `scrubDriverCauses`). لو ماقدرناش نشيله (object متجمّد)،
 * بنقفل: الخطأ كله بيبقى `DatabaseError`.
 *
 * @param error الخطأ اللي اترمي من الـ transaction
 * @returns `DatabaseError` لو ده فشل PostgreSQL حقيقي، غير كده نفس الـ error منضّف
 */
export function asDatabaseError(error: unknown): unknown {
  if (error instanceof DatabaseError) return error;
  const facts = findDriverFailure(error);
  if (facts !== undefined) return new DatabaseError(facts);
  const stuck = scrubDriverCauses(error);
  return stuck === undefined ? error : new DatabaseError(stuck);
}
