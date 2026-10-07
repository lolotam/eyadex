import type { ClaimedEvent, DispatchOutcome, DispatcherOutbox } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";

export interface PollerDeps {
  readonly outbox: DispatcherOutbox;
  readonly types: readonly string[];
  readonly handle: (event: ClaimedEvent) => Promise<DispatchOutcome>;
  readonly now: () => Date;
  readonly intervalMs: number;
  readonly logger: Logger;
}

/**
 * الحلقة: claim واحد، ولو لقى حدث يكمل على طول، ولو ما لقاش ينام `intervalMs`. `stop()` بيوقف أي
 * claim جديد وبيستنى الحدث اللي شغال يكتب نتيجته — الـ shutdown بيقفل الـ pools بعده بس.
 */
export class OutboxPoller {
  readonly #deps: PollerDeps;
  #stopped = false;
  #loop: Promise<void> | undefined;
  #wake: (() => void) | undefined;

  constructor(deps: PollerDeps) {
    this.#deps = deps;
  }

  /** حدث واحد بالظبط (أو ولا حاجة). `true` لو اتمسك حدث. */
  async runOnce(): Promise<boolean> {
    const { outbox, types, handle, now } = this.#deps;
    return (await outbox.claimNext(types, now(), handle)) !== null;
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
        // The transaction rolled back: the event is untouched and is claimed again on the next tick.
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
