import { AsyncLocalStorage } from "node:async_hooks";

/**
 * علامة بتتحط طول ما wrapper شغّال. أي wrapper تاني أو `ping` بيتلاقيها بيرفض قبل ما ياخد
 * connection: من غيرها `withTenant` جوّه `withTenant` بيستنى على نفس الـ connection اللي
 * جوه، فـ pool بحجم 1 بيموت بــ idle timeout والـ transaction جوّه بتموت معاه.
 *
 * العلامة object بيتقفل لما الـ transaction تخلص، مش `true` ثابتة: أي callback اتعمل جوّه `fn`
 * (timer، event، promise متسابة) بيورث نفس الـ store، ولو العلامة ثابتة كان هيترفض كـ "nested"
 * للأبد حتى بعد ما الـ transaction تقفل.
 *
 * `AsyncLocalStorage` من `node:async_hooks` — مفيش dependency جديدة.
 */
interface ActiveWork {
  active: boolean;
}
const insideWork = new AsyncLocalStorage<ActiveWork>();

/**
 * بيرفض أي شغل متداخل. thrown كـ `TypeError` جوه wrapper async = rejected promise، زي أي
 * فشل تاني.
 *
 * @param name اسم الـ wrapper أو `ping` اللي اتنادى جوّه شغل تاني
 * @throws TypeError لو في transaction لسه شغّالة في نفس الـ async chain
 */
export function assertNotNested(name: string): void {
  if (insideWork.getStore()?.active === true) {
    throw new TypeError(
      `nested database work is refused: ${name} was called from inside another transaction — ` +
        "one transaction at a time, or the inner call waits for a connection it already holds (ADR-0002)",
    );
  }
}

/**
 * بيشغّل `work` والعلامة مفعّلة جوه كل الـ async chain بتاعه، وبيقفلها أول ما `work` تخلص
 * (نجحت أو فشلت)، فشغل اتجدول جوّه وبيشتغل بعدها مش بيترفض.
 *
 * @param work الشغل جوه الـ transaction
 * @returns نفس نتيجة `work`
 */
export async function insideTransaction<T>(work: () => Promise<T>): Promise<T> {
  const marker: ActiveWork = { active: true };
  try {
    return await insideWork.run(marker, work);
  } finally {
    marker.active = false;
  }
}
