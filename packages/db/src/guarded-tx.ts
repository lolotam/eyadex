import type { SQL } from "drizzle-orm";

import { TenantContextViolationError } from "./context-violation.ts";
import { renderOnce, sendRendered, type RawTx } from "./single-render.ts";
import { assertStatementAllowed } from "./statement-guard.ts";

export type { RawTx } from "./single-render.ts";

/**
 * الأسماء المسموح بيها على الـ `Tx`. التلاتة دول هم الـ surface كله:
 *
 * - `execute` — raw SQL مربوطة، وهي **باب الـ SQL الوحيد**. كل جملة بتترسم مرة واحدة، بتعدّي على
 *   حارس الـ statement (`statement-guard.ts`)، وبعدها **نفس النص** ده اللي بيتبعت (شوف
 *   `single-render.ts` — الفرق بين نص اللي اتفحص ونص اللي بيتبعت كان فجوة مفتوحة).
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
  "tx is a guarded transaction: only execute() (statement-guarded, rendered once), transaction() " +
  "and rollback() are reachable, the driver behind them is not — tx.execute() is the way to run " +
  "SQL (ADR-0002)";

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
 * `execute` بياخد **`SQL` من Drizzle بس** (`is(query, SQL)` جوه الباكاج): أي حاجة تانية —
 * string، builder، object فيه `toQuery` — بترمي `TypeError` قبل أي رسم. السبب إن أي حاجة
 * مش معروفة لنا ممكن ترسم مرتين، والنداء اللي بيتبعت بعد الفحص هو اللي بتنزلق فيه.
 *
 * والنتيجة هي زي ما كانت: صفوف PostgreSQL في array عادي، `TRow` هي الـ shape اللي الـ caller
 * يحدده.
 *
 * الـ `transaction` هنا savepoint جوه نفس الـ transaction، والـ callback بياخد `Tx` تاني مش
 * الـ Drizzle الأصلي. Drizzle نفسها بتبلّش savepoints من غير options — والـ savepoints دي مش
 * بتعدّي على حارس الـ statement، والسبب إن Drizzle بتبلّشها على الـ session مش على `tx`.
 */
export type Tx = {
  execute<TRow = unknown>(query: SQL): Promise<TRow[]>;
  rollback: RawTx["rollback"];
  /** Savepoint جوه نفس الـ transaction، والـ callback بياخد `Tx` محمي تاني. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
};

const REVOKED =
  "tx is no longer valid: its transaction (or savepoint) has ended, and a method kept from it ends " +
  "with it — run the work inside the callback that received tx (ADR-0002)";

/**
 * عمر الـ `Tx` الواحد. الـ `revoke()` بتاع الـ Proxy بيقفل **القراءة** من الـ proxy بس — دالة اتاخدت
 * منه قبل كده (`const execute = tx.execute`) كانت بتفضل شغّالة على الـ transaction الحقيقية بعد ما
 * خلصت، أو على savepoint اتقفل والـ transaction اللي برّه لسه شغالة. فكل دالة بنرجّعها بتسأل العمر
 * ده **في كل نداء**. (Codex على PR #22، P1.)
 */
type Lifetime = {
  live: boolean;
  /** الـ transaction (أو الـ savepoint) اللي الـ savepoint ده جواها: لما تخلص، هو كمان خلص. */
  readonly parent?: Lifetime;
  /** savepoints اتبدأت من الـ `Tx` ده ولسه ماخلصتش. */
  pending: number;
};

/**
 * @param lifetime عمر الـ `Tx` اللي الدالة اتاخدت منه
 * @throws TypeError لو الـ transaction أو الـ savepoint خلصت
 */
const assertLive = (lifetime: Lifetime): void => {
  for (
    let current: Lifetime | undefined = lifetime;
    current !== undefined;
    current = current.parent
  ) {
    if (!current.live) throw new TypeError(REVOKED);
  }
};

/**
 * الـ `transaction` بتاع Drizzle، بس بيغلّف الـ callback الداخلي بـ proxy تاني عمره مربوط بعمر
 * الأب. وكل savepoint بيتعدّ لحد ما يخلص: لو `fn` (أو savepoint أب) رجع وفيه savepoint ماخلصش —
 * يعني اتبدأ من غير `await` — الـ wrapper بيرفض قبل الـ COMMIT بدل ما الـ savepoint يكمّل بعده.
 * (Codex على PR #22، P1.)
 */
const guardedSavepoints =
  (raw: RawTx, lifetime: Lifetime) =>
  async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
    assertLive(lifetime);
    lifetime.pending += 1;
    try {
      return await raw.transaction(async (inner: RawTx) => {
        const guarded = guardTransaction(inner, lifetime);
        try {
          const result = await fn(guarded.tx);
          if (guarded.pending() > 0) throw new TenantContextViolationError("unfinished-savepoint");
          return result;
        } finally {
          guarded.revoke();
        }
      });
    } finally {
      lifetime.pending -= 1;
    }
  };

/**
 * `execute` المحروس: **رسم واحد، فحص واحد، إرسال واحد**.
 *
 * 1. `renderOnce` بيتأكد إن اللي جاي `SQL` حقيقية من Drizzle (`TypeError` قبل أي رسم)،
 *    ويبني `{ sql, params }` بالـ dialect بتاع الـ transaction نفسها — نفس الدالة اللي Drizzle
 *    كان بيرسم بيها.
 * 2. الحارس بيفحص **النص ده بالذات** (النص الخام، زي ما الـ driver هيشوفه).
 * 3. `sendRendered` بيبعته للـ connection بـ `unsafe(text, params)` — يعني النص اللي اتفحص هو
 *    النص اللي اتبعت بالحرف. مفيش نداء تاني بيرسم، عشان مفيش `getSQL()` تاني ينادي.
 *
 * النتيجة صفوف PostgreSQL، زي ما Drizzle كان بيرجّعها.
 */
const guardedExecute = (raw: RawTx, lifetime: Lifetime) => {
  const execute = async <TRow = unknown>(query: SQL): Promise<TRow[]> => {
    assertLive(lifetime);
    const rendered = renderOnce(raw, query);
    assertStatementAllowed(rendered.text);
    return await sendRendered<TRow>(raw, rendered);
  };
  return execute;
};

/**
 * الـ proxy نفسه: allow-list على القراءة، ورفض صريح على الكتابة والـ prototype والـ
 * introspection. الـ methods متربوطة بالـ transaction الحقيقية عشان `this` يبقى صحيح.
 */
const makeHandler = (lifetime: Lifetime): ProxyHandler<RawTx> => ({
  get(target, property) {
    if (typeof property !== "string" || !ALLOWED.has(property)) {
      throw new TypeError(`${REACHED_DRIVER} (asked for ${askedFor(property)})`);
    }
    if (property === "execute") {
      return guardedExecute(target, lifetime) as unknown as Tx["execute"];
    }
    if (property === "transaction") return guardedSavepoints(target, lifetime);
    const member: unknown = Reflect.get(target, property, target);
    if (typeof member !== "function") return member;
    return (...args: unknown[]): unknown => {
      assertLive(lifetime);
      return (member as (...rest: unknown[]) => unknown).apply(target, args);
    };
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
});

/** الـ proxy ده مع `revoke()` — استخدمها لما الـ transaction يخلص. */
export interface GuardedTx {
  /** اللي بيتسلّم لـ `fn`. */
  readonly tx: Tx;
  /** بعد COMMIT أو ROLLBACK، أي استخدام بيرمي `TypeError` — هنا وفي كل savepoint جواه. */
  revoke(): void;
  /** عدد الـ savepoints اللي اتبدأت من الـ `Tx` ده ولسه شغّالة. */
  pending(): number;
}

/**
 * بيغلّف transaction حقيقية في `Tx` محمي، وبينهي صلاحيته لما الـ wrapper يخلص.
 *
 * @param raw الـ transaction الحقيقية من Drizzle
 * @param parent عمر الـ `Tx` الأب لو ده savepoint — لما الأب يخلص، ده كمان خلص
 * @returns الـ `Tx` المحمي وطريقة إبطال صلاحيته وعدد الـ savepoints الشغّالة
 */
export function guardTransaction(raw: RawTx, parent?: Lifetime): GuardedTx {
  const lifetime: Lifetime =
    parent === undefined ? { live: true, pending: 0 } : { live: true, parent, pending: 0 };
  const revocable = Proxy.revocable(raw, makeHandler(lifetime));
  return {
    tx: revocable.proxy as unknown as Tx,
    revoke: () => {
      lifetime.live = false;
      revocable.revoke();
    },
    pending: () => lifetime.pending,
  };
}
