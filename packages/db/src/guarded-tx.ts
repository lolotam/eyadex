import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * الـ transaction الحقيقية من Drizzle — دي اللي الـ wrapper بيمسكها في الـ closure بس، ومش
 * بتوصل لـ `fn` أبدًا. `fn` بياخد `Tx`: proxy مسموح عليه بأسماء معدودة.
 */
export type RawTx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];

/**
 * الأسماء المسموح بيها على الـ `Tx`. القائمة دي هي الـ surface كله:
 *
 * - بانيهات الاستعلام: `select` و`insert` و`update` و`delete` و`with` و`$with` و`$count`
 *   والـ `selectDistinct`/`selectDistinctOn`.
 * - `execute` —raw SQL مربوطة، دي اللي B3a بتستخدمها لحد ما الـ schema ييجي في B3b.
 * - `transaction` — savepoints، وبياخد من جوه `fn` تاني محمي بنفس القايمة.
 * - `rollback` — لو الشغل وقف، ارمي وشيل.
 *
 * أي اسم تاني — `session` و`_` و`dialect` و`$client` و`query` و`constructor` و`prototype`
 * — بيرمي `TypeError`. من غيرها كان `tx.session.client` هيفتح الـ driver الخام، ومنه
 * `set_config('app.clinic_id', <عيادة تانية>, false)` وقراءة صفوفها بره كل check.
 */
export const TX_MEMBERS = [
  "$count",
  "$with",
  "delete",
  "execute",
  "insert",
  "rollback",
  "select",
  "selectDistinct",
  "selectDistinctOn",
  "transaction",
  "update",
  "with",
] as const;

export type TxMember = (typeof TX_MEMBERS)[number];

const ALLOWED = new Set<string>(TX_MEMBERS);

const REACHED_DRIVER =
  "tx is a guarded transaction: the query builders are reachable, the driver behind them is not — " +
  "tx.execute() is the way to run SQL (ADR-0002)";

const REACHED_MUTATION =
  "tx is a guarded transaction: it is read-only from the outside, the wrapper owns its lifetime " +
  "(ADR-0002)";

/** اسم العقار في الرسالة — من غير أي محتوى من الرموز اللي مبعوتة. */
const askedFor = (property: string | symbol): string =>
  typeof property === "string" ? property : property.toString();

/**
 * الـ transaction زي ما الـ use case بيشوفه: بانيهات الاستعلام والـ `execute`، ومفيش حاجة
 * غيرها بتتجمّع في الـ type — `tx.session` و`tx.$client` مش بيتجمّعوا أصلاً.
 *
 * الـ `transaction` هنا savepoint جوه نفس الـ transaction، والـ callback بياخد `Tx` تاني مش
 * الـ Drizzle الأصلي. Drizzle نفسها بتبلّش savepoints من غير options.
 */
export type Tx = Omit<Pick<RawTx, TxMember>, "transaction"> & {
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
 * الـ proxy نفسه: allow-list على القراءة، ورفض صريح على الكتابة والـ prototype والـ
 * introspection. الـ methods متربوطة بالـ transaction الحقيقية عشان `this` يبقى صحيح.
 */
const handler: ProxyHandler<RawTx> = {
  get(target, property) {
    if (typeof property !== "string" || !ALLOWED.has(property)) {
      throw new TypeError(`${REACHED_DRIVER} (asked for ${askedFor(property)})`);
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
