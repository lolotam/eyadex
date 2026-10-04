/**
 * كل فشل جاي من PostgreSQL بيتغلّف في `DatabaseError` قبل ما يوصل لوجهة الـ API.
 *
 * ليه: Drizzle بيرمي `DrizzleQueryError` ورسالته فيها الـ SQL كله والـ parameters، واللي تحتها
 * `PostgresError` بيحمل `detail` زيه `Failing row contains (...)` — يعني بيانات مراجع في نص
 * الخطأ. الخطأ ده بيوصل لوجهة الـ API ولسجل الأخطاء، فاللي جواه لازم يبقى معرّفات بس
 * (SQLSTATE واسم القيد والجدول والعمود) وصفر بيانات.
 */

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** كام مستوى `cause` بنفحص: `DrizzleQueryError` فوق `PostgresError` فوق أي غلاف تاني. */
const MAX_CAUSE_DEPTH = 6;

/** شكل خطأ الـ driver: معرّفات جداول وأعمدة وقواعد، مش بيانات صفوف. */
type DriverFailure = {
  readonly code?: unknown;
  readonly constraint_name?: unknown;
  readonly schema_name?: unknown;
  readonly table_name?: unknown;
  readonly column_name?: unknown;
  readonly cause?: unknown;
};

/** اللي بيتقوله `DatabaseError`: كود SQLSTATE والمعرّفات الموجودة، وبس. */
export type DatabaseFailureFacts = {
  readonly code: string;
  readonly constraint?: string;
  readonly schema?: string;
  readonly table?: string;
  readonly column?: string;
};

const identifier = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** بيدوّر على أول error في سلسلة `cause` اللي معاه SQLSTATE حقيقي. */
const findDriverFailure = (error: unknown): DatabaseFailureFacts | undefined => {
  let candidate: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const shaped = candidate as DriverFailure;
    if (typeof shaped.code === "string" && SQLSTATE.test(shaped.code)) {
      const facts: {
        code: string;
        constraint?: string;
        schema?: string;
        table?: string;
        column?: string;
      } = { code: shaped.code };
      const constraint = identifier(shaped.constraint_name);
      const schema = identifier(shaped.schema_name);
      const table = identifier(shaped.table_name);
      const column = identifier(shaped.column_name);
      if (constraint !== undefined) facts.constraint = constraint;
      if (schema !== undefined) facts.schema = schema;
      if (table !== undefined) facts.table = table;
      if (column !== undefined) facts.column = column;
      return facts;
    }
    candidate = shaped.cause;
  }
  return undefined;
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

/**
 * بيحوّل أي خطأ طالع من الـ driver لـ `DatabaseError` معرّفات بس. أي حاجة تانية — خطأ من
 * `fn` نفسه، أو خطأ اتصال من غير SQLSTATE، أو خطأ من wrapper — بترجع **نفسها** زي ما هي.
 *
 * @param error الخطأ اللي اترمي من الـ transaction
 * @returns `DatabaseError` لو فيه SQLSTATE، غير كده نفس الـ error
 */
export function asDatabaseError(error: unknown): unknown {
  if (error instanceof DatabaseError) return error;
  const facts = findDriverFailure(error);
  return facts === undefined ? error : new DatabaseError(facts);
}
