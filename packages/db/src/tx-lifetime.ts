import type { TenantContextBreach } from "./context-violation.ts";

/**
 * عمر الـ `Tx` الواحد — ومين من شغله `fn` ماشافش نتيجته.
 *
 * الـ `revoke()` بتاع الـ Proxy بيقفل **القراءة** من الـ proxy بس: دالة اتاخدت منه قبل كده
 * (`const execute = tx.execute`) كانت بتفضل شغّالة بعد ما الـ transaction خلصت. فكل دالة بنرجّعها
 * بتسأل العمر ده **في كل نداء**، والعمر بيتقفل **أول ما `fn` يرجع** — قبل الـ closing check —
 * عشان دالة محفوظة في timer ماتلحقش تبعت كتابة بين الفحص والـ COMMIT.
 *
 * وكل جملة (`execute`) وكل savepoint بيتسجّل، ومعاه: هل الـ caller **شاف** الـ promise اللي رجعتله
 * (`await` أو `then`/`catch` أو `Promise.all`)؟ مش "خلصت ولا لأ" — savepoint اترمى من غير `await`
 * وفشل بدري بيكون خلص، بس `fn` عمره ما عرف إنه فشل، والـ COMMIT كان هيعدّي باقي الشغل. فأي شغل
 * `fn` ماشافوش — خلص أو لسه، نجح أو فشل — معناه رفض ورجوع كل حاجة. (Codex على PR #22، P1 ×4.)
 */
export interface Lifetime {
  live: boolean;
  /** الـ transaction (أو الـ savepoint) اللي الـ `Tx` ده جواها: لما تخلص، هو كمان خلص. */
  readonly parent?: Lifetime;
  /** الجمل اللي اتبعتت من الـ `Tx` ده. */
  readonly statements: Set<Tracked>;
  /** الـ savepoints اللي اتبدأت من الـ `Tx` ده. */
  readonly savepoints: Set<Tracked>;
}

/** شغل واحد: الـ promise الداخلية، وهل خلصت، وهل الـ caller شاف اللي رجعله. */
interface Tracked {
  readonly work: Promise<unknown>;
  settled: boolean;
  observed: boolean;
}

const REVOKED =
  "tx is no longer valid: its transaction (or savepoint) has ended, and a method kept from it ends " +
  "with it — run the work inside the callback that received tx (ADR-0002)";

/**
 * Promise بتعرف إنها اتشافت. الـ `await` على subclass (مش `Promise` نفسها) بيعدّي على `then`،
 * وكذلك `catch` و`finally` و`Promise.all`/`allSettled`/`race` — فأي طريقة الـ caller يستهلك بيها
 * النتيجة بتعلّم عليها. الـ promises المشتقة `Promise` عادية (`Symbol.species`)، فمفيش علامة غلط.
 */
class ObservedPromise<T> extends Promise<T> {
  static override get [Symbol.species](): PromiseConstructor {
    return Promise;
  }

  /** بيتحط بعد البناء — الـ executor بيشتغل قبل ما الحقل يتعرف. */
  entry: Tracked | undefined;

  override then<R1 = T, R2 = never>(
    onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    if (this.entry !== undefined) this.entry.observed = true;
    return super.then(onFulfilled, onRejected);
  }
}

/**
 * @param parent عمر الأب لو ده savepoint
 * @returns عمر جديد شغّال
 */
export const newLifetime = (parent?: Lifetime): Lifetime =>
  parent === undefined
    ? { live: true, statements: new Set(), savepoints: new Set() }
    : { live: true, parent, statements: new Set(), savepoints: new Set() };

/**
 * @param lifetime عمر الـ `Tx` اللي الدالة اتاخدت منه
 * @throws TypeError لو الـ transaction أو الـ savepoint (أو أي أب ليها) خلصت
 */
export const assertLive = (lifetime: Lifetime): void => {
  for (let current: Lifetime | undefined = lifetime; current; current = current.parent) {
    if (!current.live) throw new TypeError(REVOKED);
  }
};

/** بيتجاهل الرفض: الـ wrapper بيبلّغ عن الشغل المتساب بخطأ تاني، من غير أي بيانات. */
const ignore = (): undefined => undefined;

/** الـ `then` الأصلي — للتسجيل الداخلي، عشان مايتحسبش إن الـ caller شاف. */
const nativeThen = Promise.prototype.then;

/**
 * بيسجّل شغل ويرجّع للـ caller promise بتعرف لو اتشافت. الرفض متعلّق عليه handler داخلي من
 * الأول، فشغل اتساب وفشل عمره ما يبقى unhandled rejection يوقع Node — والـ wrapper هو اللي بيبلّغ.
 *
 * @param set الجمل أو الـ savepoints
 * @param work الشغل نفسه
 * @returns promise بنفس النتيجة، بتعلّم إنها اتشافت
 */
export const track = <T>(set: Set<Tracked>, work: Promise<T>): Promise<T> => {
  const entry: Tracked = { work, settled: false, observed: false };
  set.add(entry);
  const settle = (): void => {
    entry.settled = true;
  };
  nativeThen.call(work, settle, settle);
  const returned = new ObservedPromise<T>((resolve, reject) => {
    nativeThen.call(work, resolve, reject);
  });
  returned.entry = entry;
  nativeThen.call(returned, undefined, ignore);
  return returned;
};

/**
 * بيقفل العمر أول ما `fn` يرجع. الجمل اللي لسه شغّالة بنستناها تخلص (كل واحدة محدودة بـ
 * `statement_timeout` على السيرفر)، والـ savepoints لأ (ممكن تستنى أي حاجة في JS).
 *
 * @param lifetime عمر الـ `Tx`
 * @returns سبب الرفض لو فيه شغل `fn` ماشافوش، وإلا `undefined`
 */
export async function closeLifetime(lifetime: Lifetime): Promise<TenantContextBreach | undefined> {
  lifetime.live = false;
  const savepoints = [...lifetime.savepoints];
  const statements = [...lifetime.statements];
  const unseen = (entry: Tracked): boolean => !entry.observed || !entry.settled;
  const savepointBreach = savepoints.some(unseen);
  const statementBreach = statements.some(unseen);
  await Promise.allSettled(statements.map((entry) => entry.work));
  if (savepointBreach) return "unfinished-savepoint";
  return statementBreach ? "unfinished-statement" : undefined;
}

/**
 * لما `fn` يرمي: نفس القفل من غير استنى — الـ rollback جاي على أي حال، والرفض الداخلي متعلّق
 * عليه handler من وقت `track`.
 *
 * @param lifetime عمر الـ `Tx`
 */
export const abandonLifetime = (lifetime: Lifetime): void => {
  lifetime.live = false;
};
