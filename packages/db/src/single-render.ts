/**
 *Rendering واحد بس، ومجمّد: `tx.execute` بيقرا نص الجملة **مرة واحدة** جوه الباكاج، بيفحص النص
 * ده، وبعدين بيبعته للـ driver زي ما هو.
 *
 * ليه ده مهم: قبل كده الفحص كان بيقرا `dialect.sqlToQuery(query)` وDrizzle كان بيرسم **تاني**
 * وقت الإرسال. أي حاجة جوه الـ `SQL` ترجّع نص مختلف في الاستدعاء التاني — `SQLWrapper` متطبوع
 * جوه query حقيقي — كانت بتهبط على نص *مختلف* عن اللي اتفحص. ده كان بينسى حارس الـ statement
 * بالكامل (`SELECT` بتهبط على `set_config`) من غير أي كلام forbidden في النتيجة.
 *
 * فبقى: `is(query, SQL)` الأول (مش أي حاجة فيها `toQuery`)، بعدين render واحد، بعدين guard،
 * بعدين `unsafe` على الـ transaction handle بتاع Drizzle — وده **نفس** الـ call اللي Drizzle
 * نفسه كان بيعمله (`client.unsafe(query, params)` في `postgres-js/session.js`)، فالنتيجة اللي
 * `fn` شايفاها زي ما هي: صفوف PostgreSQL في array عادي.
 *
 * الـ handle ده (`tx.session.client`) جوّه الباكاج بس. `fn` مالوش طريق ليه — الـ `Tx` المحمي
 * بيخفي `session` (شوف `guarded-tx.ts`).
 */

import { is, SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * الـ transaction الحقيقية من Drizzle — دي اللي الـ wrapper بيمسكها في الـ closure بس، ومش
 * بتوصل لـ `fn` أبدًا. `fn` بياخد `Tx`: proxy مسموح عليه بأسماء معدودة.
 */
export type RawTx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];

/** dialect بتاع PostgreSQL — بيحوّل `SQL` لنص و parameters. `protected` في Drizzle، فبيتقرا من هنا. */
type PgDialectLike = {
  sqlToQuery(query: SQL): { readonly sql: string; readonly params: unknown[] };
};

/** الـ postgres.js handle بتاع الـ transaction: هو اللي بيبعت الـ Query، وبس. */
type PgDriverLike = { unsafe(text: string, params: readonly unknown[]): PromiseLike<unknown> };

/** جملة اتقرت مرة واحدة ومجمّدة — دي اللي اتفحصت ودي اللي هتتّبعت. */
export interface RenderedQuery {
  /** نص الجملة زي ما PostgreSQL هيشوفها. */
  readonly text: string;
  /** الـ parameters بالترتيب — نفس اللي اتقرا، مرّة واحدة ومقفول. */
  readonly params: readonly unknown[];
}

const NOT_DRIZZLE_SQL =
  "tx.execute() takes a real Drizzle SQL object (sql`…` or sql.raw(…)) and nothing else: anything " +
  "we do not recognise gets rendered by us once and by the driver another time, which is a way " +
  "past the statement guard (ADR-0002)";

/**
 * بيرسم جملة `SQL` **مرة واحدة** ويتأكد إنها `SQL` حقيقية من Drizzle أولاً.
 *
 * `is(query, SQL)` مش duck typing على `toQuery`: `SQL` عندها brand داخلي، والـ check
 * `constructor.name` لوحده بيعدّي object بيتظاهر بيه. والـ `params` بيننسخوا في array جديدة
 * مقفولة، فاللي بعد كده ما يقدرش يغيّر اللي اتفحص.
 *
 * @param raw الـ transaction الحقيقية (داخل الباكاج)
 * @param query اللي مرّ من `tx.execute`
 * @returns النص والـ parameters المجمّدين
 * @throws TypeError لو `query` مش `SQL` من Drizzle
 */
export function renderOnce(raw: RawTx, query: unknown): RenderedQuery {
  if (!is(query, SQL)) throw new TypeError(NOT_DRIZZLE_SQL);
  const dialect = (raw as unknown as { readonly dialect: PgDialectLike }).dialect;
  const rendered = dialect.sqlToQuery(query);
  return { text: rendered.sql, params: Object.freeze([...rendered.params]) };
}

/**
 * بيبعت النص المجمّد ده — وبس — للـ connection بتاع الـ transaction.
 *
 * `unsafe(text, params)` هو نفس الكال بتاع Drizzle لـ `execute` على builder من غير
 * fields/customResultMapper (`postgres-js/session.js`): نفس الـ connection المحجوزة للـ
 * transaction، ونفس اختيار الـ protocol (parameters = 0 ⇒ simple). مفيش إعادة رسم هنا ولا في
 * أي نداء تاني، لأن الدالة دي مالهاش غير `unsafe`.
 *
 * @param raw الـ transaction الحقيقية
 * @param rendered الناتج بتاع `renderOnce`
 * @returns صفوف PostgreSQL
 */
export async function sendRendered<TRow>(raw: RawTx, rendered: RenderedQuery): Promise<TRow[]> {
  const driver = (raw as unknown as { readonly session: { readonly client: PgDriverLike } }).session
    .client;
  return (await driver.unsafe(rendered.text, rendered.params)) as TRow[];
}
