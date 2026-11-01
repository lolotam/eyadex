import type { ExportFence, ExportStore } from "./ports/export-store.ts";

/** النبضات متسلسلة؛ وقف النبض يستنى آخر جواب قبل قرار حذف أي ملف. */
export class ExportHeartbeat {
  #timer: ReturnType<typeof setTimeout> | null = null;
  #pending: Promise<void> = Promise.resolve();
  #stopped = false;
  #outcome: "own_success" | "lost_lease" | "db_error" | null = null;

  constructor(
    private readonly store: ExportStore,
    private readonly fence: ExportFence,
    private readonly controller: AbortController,
    private readonly intervalMs = 20_000,
  ) {
    this.#schedule();
  }

  get outcome() {
    return this.#outcome;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    await this.#pending;
  }

  #schedule(): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#pending = this.#beat();
    }, this.intervalMs);
    this.#timer.unref();
  }

  async #beat(): Promise<void> {
    try {
      const result = await this.store.heartbeat(this.fence);
      if (result.kind !== "applied") this.#outcome = result.kind;
    } catch {
      this.#outcome = "db_error";
    }
    if (this.#outcome !== null) {
      this.#stopped = true;
      this.controller.abort();
    } else this.#schedule();
  }
}
