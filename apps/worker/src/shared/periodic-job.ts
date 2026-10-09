/**
 * شغلانة دورية: أول تشغيل فور `start()`، وبعد كل تشغيل بيخلص بتستنى `intervalMs` قبل اللي بعده، فتشغيلين
 * عمرهم ما بيتداخلوا. `stop()` بيلغي الجاي وبيستنى اللي شغال يخلص — الـ shutdown بيقفل الـ pools بعده بس.
 */
export class PeriodicJob {
  readonly #run: () => Promise<void>;
  readonly #intervalMs: number;
  #stopped = false;
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;

  /**
   * @param run التشغيل الواحد؛ لازم يمسك أخطاءه ويسجّلها بنفسه وعمره ما يرمي
   * @param intervalMs بين نهاية تشغيل وبداية اللي بعده
   */
  constructor(run: () => Promise<void>, intervalMs: number) {
    this.#run = run;
    this.#intervalMs = intervalMs;
  }

  start(): void {
    if (this.#timer !== undefined || this.#stopped) return;
    const tick = () => {
      this.#running = this.#run().finally(() => {
        this.#running = undefined;
        if (!this.#stopped) this.#timer = setTimeout(tick, this.#intervalMs);
      });
    };
    // The first run starts at once, so a restart never waits a whole interval.
    this.#timer = setTimeout(tick, 0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    await this.#running;
  }
}
