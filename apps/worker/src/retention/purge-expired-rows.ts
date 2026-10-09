import type { RetentionTarget } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";

import { PeriodicJob } from "../shared/periodic-job.ts";
import {
  MAX_BATCHES_PER_RUN,
  PURGE_BATCH_SIZE,
  RETENTION_TARGETS,
} from "./domain/retention-batches.ts";
import type { RetentionPurger } from "./ports/retention-purger.ts";

export interface RetentionJobDeps {
  readonly purger: RetentionPurger;
  readonly logger: Logger;
  /** بين نهاية تشغيل وبداية اللي بعده. */
  readonly intervalMs: number;
  readonly batchSize?: number;
  readonly maxBatches?: number;
}

/** نتيجة تشغيل: أعداد بس، مفيش صف ولا id. */
export interface RetentionRun {
  readonly purged: Record<RetentionTarget, number>;
  /** دفاتر وصلت لحد الدفعات وفاضل فيها صفوف: التشغيل الجاي بيكمل. */
  readonly backlog: RetentionTarget[];
  /** دفاتر وقفت بخطأ؛ الباقيين بيكملوا عادي. */
  readonly failed: RetentionTarget[];
}

/**
 * التنضيف الدوري (ADR-0022): مفاتيح الـ idempotency في الدفترين بعد 30 يوم، أحداث الـ outbox اللي اتبعتت بعد
 * 30 يوم، واللي فشلت نهائي بعد 90 يوم. كل دفعة transaction لوحدها ومحدودة، والتكرار آمن: صف اتمسح
 * مابيرجعش، والتشغيل الجاي بيلاقي اللي فاضل بس. السطر المسجّل فيه أعداد بس.
 */
export class RetentionPurgeJob {
  readonly #deps: RetentionJobDeps;
  readonly #job: PeriodicJob;
  #stopped = false;

  constructor(deps: RetentionJobDeps) {
    this.#deps = deps;
    this.#job = new PeriodicJob(() => this.#tick(), deps.intervalMs);
  }

  /**
   * تشغيل واحد على الدفاتر كلها. دفتر فشل مابيوقفش الباقي، و`stop()` بيوقف قبل الدفعة الجاية.
   *
   * @returns الأعداد لكل دفتر واللي فاضل فيه واللي فشل
   */
  async runOnce(): Promise<RetentionRun> {
    const run: RetentionRun = {
      purged: { outbox: 0, platformLedger: 0, clinicLedger: 0 },
      backlog: [],
      failed: [],
    };
    for (const target of RETENTION_TARGETS) {
      if (this.#stopped) break;
      try {
        const { deleted, more } = await this.#drain(target);
        run.purged[target] = deleted;
        if (more) run.backlog.push(target);
      } catch (error) {
        run.failed.push(target);
        this.#deps.logger.error({ err: error, retention: { target } }, "retention purge failed");
      }
    }
    return run;
  }

  start(): void {
    this.#job.start();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#job.stop();
  }

  /** دفعات لحد ما دفعة ترجع ناقصة أو الحد يخلص؛ `more` لو الحد خلص والدفتر لسه ممكن يكون فيه. */
  async #drain(target: RetentionTarget): Promise<{ deleted: number; more: boolean }> {
    const size = this.#deps.batchSize ?? PURGE_BATCH_SIZE;
    const max = this.#deps.maxBatches ?? MAX_BATCHES_PER_RUN;
    let deleted = 0;
    for (let batch = 0; batch < max; batch += 1) {
      if (this.#stopped) return { deleted, more: false };
      const batchDeleted = await this.#deps.purger.purgeExpired(target, size);
      deleted += batchDeleted;
      if (batchDeleted < size) return { deleted, more: false };
    }
    return { deleted, more: true };
  }

  async #tick(): Promise<void> {
    const run = await this.runOnce();
    this.#deps.logger.info({ retention: run }, "retention purge completed");
  }
}
