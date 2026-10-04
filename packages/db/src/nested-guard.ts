import { AsyncLocalStorage } from "node:async_hooks";

/**
 * علامة بتتحط طول ما wrapper شغّال. أي wrapper تاني أو `ping` **بنفس الـ `Database`** بيتلاقيها
 * بيرفض قبل ما ياخد connection: من غيرها `withTenant` جوّه `withTenant` بيستنى على نفس الـ
 * connection اللي جوه، فـ pool بحجم 1 بيموت بــ idle timeout والـ transaction جوّه بتموت معاه.
 *
 * العلامة واحدة **لكل `Database`** مش لكل عملية: `withTenant` من app جوّه `withTenant` من app
 * هو deadlock حقيقي (نفس الـ pool)، بس `platform.withNoTenant` جوّه `app.withTenant` استخدام
 * شرعي لعيادتين وConnections مختلفة، ومنعّه معناه إن الـ API مش هيقدر ينفّذ onboarding جوه
 * transaction تانية. عشان كده الـ store بيحفظ **token لكل instance** مش boolean، والرفض بيحصل
 * بس لو الـ instance هي هي اللي شغّالة.
 *
 * الـ token object بيتقفل لما الـ transaction تخلص، مش `true` ثابتة: أي callback اتعمل جوّه `fn`
 * (timer، event، promise متسابة) بيورث نفس الـ store، ولو العلامة ثابتة كان هيترفض كـ "nested"
 * للأبد حتى بعد ما الـ transaction تقفل.
 *
 * `AsyncLocalStorage` من `node:async_hooks` — مفيش dependency جديدة.
 */
interface WorkToken {
  /** الـ **instance** من `Database` اللي شغّال، مش الـ class. */
  readonly instance: object;
  /** بيتقفل مع نهاية الـ transaction بتاعه. */
  active: boolean;
}
const insideWork = new AsyncLocalStorage<ReadonlySet<WorkToken>>();

/**
 * بيرفض أي شغل متداخل **على نفس الـ `Database`**. thrown كـ `TypeError` جوه wrapper async =
 * rejected promise، زي أي فشل تاني.
 *
 * @param name اسم الـ wrapper أو `ping` اللي اتنادى جوّه شغل تاني
 * @param instance الـ `Database` اللي بيتنفّذ (token لكل `createDatabase` call)
 * @throws TypeError لو في transaction لسه شغّالة على نفس الـ instance في نفس الـ async chain
 */
export function assertNotNested(name: string, instance: object): void {
  for (const token of insideWork.getStore() ?? []) {
    if (token.instance === instance && token.active) {
      throw new TypeError(
        `nested database work is refused: ${name} was called from inside another transaction on the ` +
          "same Database — one transaction at a time per instance, or the inner call waits for a " +
          "connection it already holds (ADR-0002)",
      );
    }
  }
}

/**
 * بيشغّل `work` والعلامة مفعّلة جوه كل الـ async chain بتاعه، وبيقفلها أول ما الـ `work` تخلص
 * (نجحت أو فشلت)، فشغل اتجدول جوّه وبيشتغل بعدها مش بيترفض.
 *
 * @param instance الـ `Database` اللي شغّال دلوقتي
 * @param work الشغل جوه الـ transaction
 * @returns نفس نتيجة `work`
 */
export async function insideTransaction<T>(instance: object, work: () => Promise<T>): Promise<T> {
  // Set جديد لكل مستوى: انتهاء المستوى ده بيحذف الـ token بتاعه من الـ set بتاعه هو بس، والـ
  // sets اللي فوقه (في الـ async chains التانية) شايفاه بـ active=false وبتفضل زي ما هي.
  const tokens = new Set<WorkToken>(insideWork.getStore());
  const token: WorkToken = { instance, active: true };
  tokens.add(token);
  try {
    return await insideWork.run(tokens, work);
  } finally {
    token.active = false;
    tokens.delete(token);
  }
}
