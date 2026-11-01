import type { ClaimedEvent, DispatchOutcome, DispatcherOutbox } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";

export interface PollerDeps {
  readonly outbox: DispatcherOutbox;
  readonly types: readonly string[];
  readonly handle: (event: ClaimedEvent) => Promise<DispatchOutcome>;
  readonly now: () => Date;
  readonly intervalMs: number;
  readonly logger: Logger;
  /**
   * قبل `claimNext`. لو راجع `false` مفيش claim: لا الساعة ولا الـ handler ولا `afterClaim`،
   * و`runOnce` بيرجع `false`. حلقة الخلفية بتنام `intervalMs` بدل ما تلف. غيابه = السلوك القديم.
   * متزامن ومن غير I/O — سؤال عن عدّاد في الذاكرة، مش بناء.
   *
   * @returns `false` يمنع الـ claim؛ غير كده الـ claim يكمل
   */
  readonly canClaim?: () => boolean;
  /**
   * بعد ما `claimNext` يخلّص، يعني بعد الـ COMMIT، حتى لو النتيجة `null`. ما بيتناداش والـ claim
   * لسه فاتح، ولا جوه الـ handler، ولا لو `claimNext` رمى، ولا لو `canClaim` منع الـ claim.
   * غيابه = السلوك القديم. متزامن ومن غير انتظار: صحيان طابور في الذاكرة، مش بناء ومش SQL.
   */
  readonly afterClaim?: () => void;
}

/**
 * الحلقة: claim واحد، ولو لقى حدث يكمل على طول، ولو ما لقاش ينام `intervalMs`. `canClaim` الاختياري
 * يمنع الـ claim قبل ما يبدأ، و`afterClaim` الاختياري بيصحى بعد الـ COMMIT. `stop()` بيوقف أي claim
 * جديد وبيستنى الحدث اللي شغال يكتب نتيجته — الـ shutdown بيقفل الـ pools بعده بس.
 */
export class OutboxPoller {
  readonly #deps: PollerDeps;
  #stopped = false;
  #loop: Promise<void> | undefined;
  #wake: (() => void) | undefined;

  constructor(deps: PollerDeps) {
    this.#deps = deps;
  }

  /**
   * حدث واحد بالظبط (أو ولا حاجة). `canClaim` لو راجع `false` بيخرج قبل أي claim. `afterClaim` لو
   * موجود بيتنادى بعد ما الـ claim يخلّص، ومش بيغيّر القيمة الراجعة.
   *
   * @returns `true` لو `claimNext` رجّع حدث؛ `false` لو رجّع `null` أو الـ backpressure منع الـ claim
   */
  async runOnce(): Promise<boolean> {
    const { outbox, types, handle, now, canClaim, afterClaim } = this.#deps;
    if (canClaim?.() === false) return false;
    const claimed = await outbox.claimNext(types, now(), handle);
    afterClaim?.();
    return claimed !== null;
  }

  start(): void {
    if (this.#loop !== undefined) return;
    this.#loop = this.#run();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#wake?.();
    await this.#loop;
  }

  async #run(): Promise<void> {
    while (!this.#stopped) {
      let claimed = false;
      try {
        claimed = await this.runOnce();
      } catch (error) {
        // A claim rejection rolls the transaction back: the event is untouched and is claimed again
        // on the next tick. A post-commit hook failure can also land here, after that claim committed.
        this.#deps.logger.error({ err: error }, "outbox poll failed");
      }
      if (!claimed && !this.#stopped) await this.#sleep();
    }
  }

  #sleep(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, this.#deps.intervalMs);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.#wake = done;
    });
  }
}
