import type { TenantContextBreach } from "./context-violation.ts";

/**
 * عمر الـ `Tx` الواحد — ومين لسه شغّال منه.
 *
 * الـ `revoke()` بتاع الـ Proxy بيقفل **القراءة** من الـ proxy بس: دالة اتاخدت منه قبل كده
 * (`const execute = tx.execute`) كانت بتفضل شغّالة بعد ما الـ transaction خلصت. فكل دالة بنرجّعها
 * بتسأل العمر ده **في كل نداء**، والعمر بيتقفل **أول ما `fn` يرجع** — قبل الـ closing check، مش
 * بعده — عشان دالة محفوظة في timer ماتلحقش تبعت كتابة بين الفحص والـ COMMIT.
 *
 * وكل شغل اتبدأ من الـ `Tx` ولسه ماخلصش بيتسجّل: جملة (`execute`) أو savepoint. لو `fn` رجع وفيه
 * حاجة لسه شغّالة — يعني اتبدأت من غير `await` — الـ wrapper بيرفض ويرجّع كل حاجة بدل ما يعمل
 * COMMIT لشغل `fn` ماشافش نتيجته. (Codex على PR #22، P1 ×3.)
 */
export interface Lifetime {
  live: boolean;
  /** الـ transaction (أو الـ savepoint) اللي الـ `Tx` ده جواها: لما تخلص، هو كمان خلص. */
  readonly parent?: Lifetime;
  /** جمل اتبعتت من الـ `Tx` ده ولسه مارجعتش. */
  readonly statements: Set<Promise<unknown>>;
  /** savepoints اتبدأت من الـ `Tx` ده ولسه ماخلصتش. */
  readonly savepoints: Set<Promise<unknown>>;
}

const REVOKED =
  "tx is no longer valid: its transaction (or savepoint) has ended, and a method kept from it ends " +
  "with it — run the work inside the callback that received tx (ADR-0002)";

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

/**
 * بيسجّل شغل لحد ما يخلص. الـ `then(remove, remove)` (مش `finally`) عشان الـ promise المشتقة
 * ماترفضش هي كمان وتبقى unhandled rejection تانية.
 *
 * @param set الجمل أو الـ savepoints
 * @param work الشغل نفسه — نفس الـ promise بترجع للـ caller
 * @returns `work` زي ما هي
 */
export const track = <T>(set: Set<Promise<unknown>>, work: Promise<T>): Promise<T> => {
  set.add(work);
  const remove = (): void => {
    set.delete(work);
  };
  void work.then(remove, remove);
  return work;
};

/**
 * بيقفل العمر أول ما `fn` يرجع. الجمل الشغّالة بنستناها تخلص (كل واحدة محدودة بـ
 * `statement_timeout` على السيرفر) والـ savepoints لأ (ممكن تستنى أي حاجة في JS) — والاتنين
 * بيتعلّق عليهم handler، عشان رفضهم المتأخر مايبقاش unhandled rejection يوقع Node.
 *
 * @param lifetime عمر الـ `Tx`
 * @returns سبب الرفض لو كان فيه شغل متساب، وإلا `undefined`
 */
export async function closeLifetime(lifetime: Lifetime): Promise<TenantContextBreach | undefined> {
  lifetime.live = false;
  const statements = [...lifetime.statements];
  const savepoints = [...lifetime.savepoints];
  for (const work of savepoints) void work.catch(ignore);
  await Promise.allSettled(statements);
  if (savepoints.length > 0) return "unfinished-savepoint";
  return statements.length > 0 ? "unfinished-statement" : undefined;
}

/**
 * لما `fn` يرمي: نفس القفل من غير استنى — الـ rollback جاي على أي حال، والـ handlers بس عشان
 * مفيش رفض متأخر يبقى unhandled.
 *
 * @param lifetime عمر الـ `Tx`
 */
export const abandonLifetime = (lifetime: Lifetime): void => {
  lifetime.live = false;
  for (const work of [...lifetime.statements, ...lifetime.savepoints]) void work.catch(ignore);
};
