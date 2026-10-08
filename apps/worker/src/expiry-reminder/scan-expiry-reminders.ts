import type { Logger } from "@eyadex/observability";

import type { DueClinicFinder, ReminderLedger } from "./ports/reminder-store.ts";

export interface ScannerDeps {
  readonly finder: DueClinicFinder;
  readonly ledger: ReminderLedger;
  readonly clock: { now(): Date };
  readonly logger: Logger;
  /** بين كل فحص والتاني. */
  readonly intervalMs: number;
}

/**
 * الشغلانة اليومية (PRD §4.9، story 79، ADR-0020): بتلاقي العيادات اللي في نافذة التنبيه وبتسجّل لكل
 * واحدة تنبيه واحد بالحدث بتاعه. الدفتر الفريد `(clinic_id, expires_at)` هو اللي بيضمن "مرة لكل
 * عيادة لكل تاريخ انتهاء" مهما اتكرر الفحص أو كتر عدد الـ workers؛ الدخول نفسه عمره ما بيعتمد عليها.
 */
export class ExpiryReminderScanner {
  readonly #deps: ScannerDeps;
  #stopped = false;
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;

  constructor(deps: ScannerDeps) {
    this.#deps = deps;
  }

  /**
   * فحص واحد. عيادة فشلت مابتوقفش الباقي؛ السطر المسجّل فيه أعداد بس.
   *
   * @returns عدد العيادات المستحقة وعدد التنبيهات الجديدة
   */
  async runOnce(): Promise<{ due: number; queued: number; failed: number }> {
    const { finder, ledger, clock } = this.#deps;
    const due = await finder.dueClinics(clock.now());
    let queued = 0;
    let failed = 0;
    for (const clinicId of due) {
      if (this.#stopped) break;
      try {
        if (await ledger.queue(clinicId, () => clock.now())) queued += 1;
      } catch {
        failed += 1;
      }
    }
    return { due: due.length, queued, failed };
  }

  start(): void {
    if (this.#timer !== undefined || this.#stopped) return;
    const tick = () => {
      this.#running = this.#tick().finally(() => {
        this.#running = undefined;
        if (!this.#stopped) this.#timer = setTimeout(tick, this.#deps.intervalMs);
      });
    };
    // The first scan runs at start, so a restart never waits a whole interval.
    this.#timer = setTimeout(tick, 0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    await this.#running;
  }

  async #tick(): Promise<void> {
    try {
      const result = await this.runOnce();
      this.#deps.logger.info({ reminder: result }, "expiry reminder scan completed");
    } catch (error) {
      this.#deps.logger.error({ err: error }, "expiry reminder scan failed");
    }
  }
}
