/**
 * سقف من ناحية JS على **بداية** الـ transaction (connection + BEGIN)، مستقل عن الـ driver.
 *
 * ليه: postgres.js 3.4.9 فيه bug مفتوح (porsager/postgres#1193): لو السيرفر قفل الـ socket بشكل
 * نضيف وفيه query أولية مستنية، الـ driver بيعيد الاتصال على طول من غير delay ومن غير ما الـ
 * `connect_timeout` يوقفه — والـ query عمرها ما بتخلص. يعني نداء الـ wrapper كان ممكن يفضل مستني
 * للأبد وقت عطل في الداتابيز أو في proxy قدامها. السقف هنا بيخلّي النداء **يفشل** في وقت محدود؛
 * الـ loop نفسه جوه الـ driver متابَع كـ follow-up (patch للـ driver). (Codex على PR #22، P1.)
 *
 * السقف = `connect_timeout` + سقف الـ transaction: الأول لفتح الـ connection، والتاني كاستنى معقول
 * لـ slot في الـ pool وهو مشغول (كل transaction محدودة بالسقف ده على السيرفر). لو الـ transaction
 * بدأت **بعد** ما السقف عدّى، `began()` بيرمي فهي بترجع قبل ما `fn` يشتغل — والـ caller كان خد
 * الخطأ خلاص.
 */

const START_TIMED_OUT =
  "could not start a database transaction in time: the connection could not be set up, or the pool " +
  "stayed busy — the call fails instead of waiting without bound (ADR-0002)";

const START_ABANDONED =
  "this transaction started after its caller had already been told it timed out — rolled back " +
  "before any work (ADR-0002)";

/**
 * @param deadlineMs السقف بالـ ms
 * @param run بيبدأ الـ transaction، ولازم ينادي `began()` أول حاجة جوه الـ callback بتاعها
 * @returns نتيجة `run`
 * @throws Error لو الـ transaction ما بدأتش قبل السقف — من غير host ولا port ولا رابط
 */
export async function withStartDeadline<T>(
  deadlineMs: number,
  run: (began: () => void) => Promise<T>,
): Promise<T> {
  let state: "waiting" | "started" | "abandoned" = "waiting";
  const began = (): void => {
    if (state === "abandoned") throw new Error(START_ABANDONED);
    state = "started";
  };
  const work = run(began);
  // If the deadline wins, the work may still reject later; nobody awaits it any more.
  work.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      if (state !== "waiting") return;
      state = "abandoned";
      reject(new Error(START_TIMED_OUT));
    }, deadlineMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
