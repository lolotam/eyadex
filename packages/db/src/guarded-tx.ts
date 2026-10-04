import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SQL } from "drizzle-orm";

import { assertStatementAllowed } from "./statement-guard.ts";

/**
 * الـ transaction الحقيقية من Drizzle — دي اللي الـ wrapper بيمسكها في الـ closure بس، ومش
 * بتوصل لـ `fn` أبدًا. `fn` بياخد `Tx`: proxy مسموح عليه بأسماء معدودة.
 */
export type RawTx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];

/** dialect بتاع PostgreSQL — بيحوّل `SQL` لنص. `protected` في تعريف Drizzle، فبيتقرا من هنا. */
type PgDialectLike = { sqlToQuery(query: SQL): { readonly sql: string } };

/**
 * الأسماء المسموح بيها على الـ `Tx`. التلاتة دول هم الـ surface كله:
 *
 * - `execute` — raw SQL مربوطة، وهي **باب الـ SQL الوحيد**. كل جملة بتعدّي على حارس الـ statement
 *   (`statement-guard.ts`) قبل ما تتبعت.
 * - `transaction` — savepoints، وبياخد من جوه `fn` تاني محمي بنفس القايمة. Drizzle نفسها بتبلّش
 *   الـ savepoints، فمش بيعدّوا على الحارس.
 * - `rollback` — لو الشغل وقف، ارمي وشيل.
 *
 * **مفيش بانيهات استعلام**. `tx.select()` و`tx.insert()` و`tx.$count()` بيرجعوا بانيهات Drizzle
 * حقيقية، و`builder.session.client` هو الـ client الخام بتاع postgres.js — من him
 * `set_config('app.clinic_id', <عيادة تانية>, false)` وقراءة صفوفها بره كل check وكل timeout.
 * الباكاج ده مالوش schema أصلاً، فمفيش حاجة بتستخدمهم: هي هتيرجع في B3b بس ورا غلاف يفحص
 * **كل** قيمة بترجع منه.
 *
 * أي اسم تاني — `session` و`_` و`dialect` و`$client` و`query` و`constructor` و`select` — بيرمي
 * `TypeError`.
 */
export const TX_MEMBERS = ["execute", "rollback", "transaction"] as const;

export type TxMember = (typeof TX_MEMBERS)[number];

const ALLOWED = new Set<string>(TX_MEMBERS);

const REACHED_DRIVER =
  "tx is a guarded transaction: only execute() (statement-guarded), transaction() and rollback() " +
  "are reachable, the driver behind them is not — tx.execute() is the way to run SQL (ADR-0002)";

const REACHED_MUTATION =
  "tx is a guarded transaction: it is read-only from the outside, the wrapper owns its lifetime " +
  "(ADR-0002)";

/** اسم العقار في الرسالة — من غير أي محتوى من الرموز اللي مبعوتة. */
const askedFor = (property: string | symbol): string =>
  typeof property === "string" ? property : property.toString();

/**
 * الـ transaction زي ما الـ use case بيشوفها: باب SQL واحد محروس، وsavepoints، وrollback.
 * `tx.session` و`tx.$client` و`tx.select` مش بيتجمّعوا أصلاً.
 *
 * `execute` و`rollback` هما نفس توقيع Drizzle بالحرف (`Pick` من الـ transaction الحقيقية)،
 * عشان `await tx.execute<Row>()` يفضل زي ما Drizzle عامله: بيدّي صفوف PostgreSQL.
 *
 * الـ `transaction` هنا savepoint جوه نفس الـ transaction، والـ callback بياخد `Tx` تاني مش
 * الـ Drizzle الأصلي. Drizzle نفسها بتبلّش savepoints من غير options — والـ savepoints دي مش
 * بتعدّي على حارس الـ statement، والسبب إن Drizzle بتبلّشها على الـ session مش على `tx`.
 */
export type Tx = Pick<RawTx, "execute" | "rollback"> & {
  /** Savepoint جوه نفس الـ transaction، والـ callback بياخد `Tx` محمي تاني. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
};

/** الـ `transaction` بتاع Drizzle، بس بيغلّف الـ callback الداخلي بـ proxy تاني. */
const guardedSavepoints =
  (raw: RawTx) =>
  async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
    await raw.transaction(async (inner: RawTx) => {
      const guarded = guardTransaction(inner);
      try {
        return await fn(guarded.tx);
      } finally {
        guarded.revoke();
      }
    });

/**
 * `execute` المحروس: بيقرا نص الجملة **من dialect الـ transaction نفسها** (نفس الدالة اللي
 * Drizzle هتبعت بيها النص)، بيتحقق، وبعدين يبعت. الـ dialect ما بيوصلش لـ `fn` — القراءة دي
 * جوه الباكاج بس.
 */
const guardedExecute = (raw: RawTx) => {
  const execute = async (query: SQL): Promise<unknown> => {
    const dialect = (raw as unknown as { readonly dialect: PgDialectLike }).dialect;
    assertStatementAllowed(dialect.sqlToQuery(query).sql);
    return await raw.execute(query);
  };
  return execute;
};

/**
 * الـ proxy نفسه: allow-list على القراءة، ورفض صريح على الكتابة والـ prototype والـ
 * introspection. الـ methods متربوطة بالـ transaction الحقيقية عشان `this` يبقى صحيح.
 */
const handler: ProxyHandler<RawTx> = {
  get(target, property) {
    if (typeof property !== "string" || !ALLOWED.has(property)) {
      throw new TypeError(`${REACHED_DRIVER} (asked for ${askedFor(property)})`);
    }
    if (property === "execute") {
      return guardedExecute(target) as unknown as Tx["execute"];
    }
    if (property === "transaction") return guardedSavepoints(target);
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  },
  has(_target, property) {
    return typeof property === "string" && ALLOWED.has(property);
  },
  ownKeys() {
    return [...TX_MEMBERS];
  },
  getOwnPropertyDescriptor(_target, property) {
    if (typeof property !== "string" || !ALLOWED.has(property)) return undefined;
    return { value: property, configurable: true, enumerable: false, writable: false };
  },
  getPrototypeOf() {
    return null;
  },
  set() {
    throw new TypeError(REACHED_MUTATION);
  },
  defineProperty() {
    throw new TypeError(REACHED_MUTATION);
  },
  deleteProperty() {
    throw new TypeError(REACHED_MUTATION);
  },
};

/** الـ proxy ده مع `revoke()` — استخدمها لما الـ transaction يخلص. */
export interface GuardedTx {
  /** اللي بيتسلّم لـ `fn`. */
  readonly tx: Tx;
  /** بعد COMMIT أو ROLLBACK، أي استخدام بيرمي `TypeError`. */
  revoke(): void;
}

/**
 * بيغلّف transaction حقيقية في `Tx` محمي، وبينهي صلاحيته لما الـ wrapper يخلص.
 *
 * @param raw الـ transaction الحقيقية من Drizzle
 * @returns الـ `Tx` المحمي وطريقة إبطال صلاحيته
 */
export function guardTransaction(raw: RawTx): GuardedTx {
  const revocable = Proxy.revocable(raw, handler);
  return {
    tx: revocable.proxy as unknown as Tx,
    revoke: () => {
      revocable.revoke();
    },
  };
}
