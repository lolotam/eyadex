import type { Logger } from "@eyadex/observability";

import { PeriodicJob } from "../shared/periodic-job.ts";
import type { ReminderClinicFinder, ReminderQueue } from "./ports/reminder-queue.ts";

export interface ReminderScannerDeps {
  readonly finder: ReminderClinicFinder;
  readonly queue: ReminderQueue;
  readonly clock: { now(): Date };
  readonly logger: Logger;
  /** بين كل فحص والتاني (`REMINDER_SCAN_INTERVAL_MS`). */
  readonly intervalMs: number;
}

/**
 * فحص تذكيرات المواعيد (spec §3.2): بيلاقي العيادات النشطة على pool المنصة، وبيسجّل لكل عيادة جوه سياقها
 * التذكيرات المستحقة. القيد الفريد في الدفتر هو اللي بيضمن "مرة لكل بداية موعد" مهما اتكرر الفحص.
 */
export class AppointmentReminderScanner {
  readonly #deps: ReminderScannerDeps;
  readonly #job: PeriodicJob;
  #stopped = false;

  constructor(deps: ReminderScannerDeps) {
    this.#deps = deps;
    this.#job = new PeriodicJob(() => this.#tick(), deps.intervalMs);
  }

  /**
   * فحص واحد. عيادة فشلت مابتوقفش الباقي؛ السطر المسجّل فيه أعداد بس.
   *
   * @returns عدد العيادات اللي اتفحصت، والتذكيرات الجديدة، والعيادات اللي فشلت
   */
  async runOnce(): Promise<{ clinics: number; queued: number; failed: number }> {
    const { finder, queue, clock } = this.#deps;
    const clinics = await finder.activeClinics(clock.now());
    let queued = 0;
    let failed = 0;
    for (const clinicId of clinics) {
      if (this.#stopped) break;
      try {
        queued += await queue.queue(clinicId, () => clock.now());
      } catch {
        failed += 1;
      }
    }
    return { clinics: clinics.length, queued, failed };
  }

  start(): void {
    this.#job.start();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#job.stop();
  }

  async #tick(): Promise<void> {
    try {
      const result = await this.runOnce();
      this.#deps.logger.info({ reminder: result }, "appointment reminder scan completed");
    } catch (error) {
      this.#deps.logger.error({ err: error }, "appointment reminder scan failed");
    }
  }
}
