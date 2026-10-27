import type { Logger } from "@eyadex/observability";

import type { ExportLeaseHandoff, LeasedExportIdentity } from "./ports/export-lease-handoff.ts";

/**
 * تنفيذ المحاولة بعد الالتزام. الهوية المسجّلة مش إذن تقرا صفوف مراجع:
 * الـ callback هو اللي يعيد قراءة السور ويكمل دورة المحاولة. الطابور نفسه
 * ما بيقراش تقرير، وما بيعملش heartbeat ولا بناء ولا رفع ولا حذف ولا كتابة تأجير.
 */
export type ExportHandoffExecute = (
  identity: LeasedExportIdentity,
  signal: AbortSignal,
) => Promise<void>;

/** اعتمادات الطابور. الـ callback دالة عادية، مش منفذ إنتاج وهمي. */
export interface ExportHandoffQueueDeps {
  readonly execute: ExportHandoffExecute;
  readonly logger: Logger;
  /** تزامن البناء المحلي. الغياب = 2، زي `EXPORT_CONCURRENCY`. */
  readonly concurrency?: number;
}

interface ClaimFrame {
  identity: LeasedExportIdentity | null;
}

interface LocalJob {
  readonly key: string;
  readonly identity: LeasedExportIdentity;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  finish(): void;
  skip: boolean;
  released: boolean;
}

const FAILED = "failed";
const DROPPED = "dropped";
const EXECUTION_FAILED = "execution_failed";

/**
 * طابور ذاكرة بعد الالتزام، لـ poller واحد تسلسلي. `canClaim` بيفتح إطار الـ claim
 * الحالي، و`record` بيحتفظ فيه بالهوية بس، و`afterClaim` بينقل الإطار ده للشغل المحلي
 * بعد ما `claimNext` يخلّص. لو الـ claim رمى، الـ poller ما بيناديش `afterClaim`؛
 * النداء الجاي لـ `canClaim` بيرمي الإطار اليتيم وما بيشغّلوش. مفيش heartbeat للإطار
 * ده: تأجير القاعدة بيخلص والحدث المعلّق بيتعاد. `stop` ما بيحرّرش التأجير الدائم.
 */
export class ExportHandoffQueue implements ExportLeaseHandoff {
  readonly #execute: ExportHandoffExecute;
  readonly #logger: Logger;
  readonly #concurrency: number;
  readonly #jobs = new Map<string, LocalJob>();
  #frame: ClaimFrame | null = null;
  #stopping = false;
  #stopped: Promise<void> | null = null;

  constructor(deps: ExportHandoffQueueDeps) {
    if (typeof deps?.execute !== "function") throw new Error("export_handoff_execute_required");
    if (deps.logger == null || typeof deps.logger.error !== "function") {
      throw new Error("export_handoff_logger_required");
    }
    const concurrency = deps.concurrency ?? 2;
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new Error("export_handoff_concurrency_invalid");
    }
    this.#execute = deps.execute;
    this.#logger = deps.logger;
    this.#concurrency = concurrency;
  }

  /**
   * يفتح إطار الـ claim الحالي لو لسه بنقبل وفيه سعة. السعة كل الشغل الملتزم،
   * بما فيه اللي اتجدول ولسه ما اشتغلش. `false` ما بيفتحش إطار.
   *
   * @returns `false` لو الإيقاف أو السعة تمنع الـ claim
   */
  readonly canClaim = (): boolean => {
    this.#frame = null;
    if (this.#stopping || this.#jobs.size >= this.#concurrency) return false;
    this.#frame = { identity: null };
    return true;
  };

  /**
   * ينسخ الأربع بدائيات جوه الإطار المفتوح. ما بيشغّلش الـ callback ولا بيعمل I/O.
   *
   * @param identity العيادة والتصدير والمحاولة والمالك، من غير تقرير ولا مفتاح
   */
  readonly record = (identity: LeasedExportIdentity): void => {
    const frame = this.#frame;
    if (frame === null) throw new Error("export_handoff_no_frame");
    if (frame.identity !== null) throw new Error("export_handoff_already_recorded");
    frame.identity = copyIdentity(identity);
  };

  /**
   * ينقل سجل الإطار الناجح للشغل المحلي ويصحى التنفيذ بـ microtask. ما يستناش
   * الشغل، وclaim فاضي ما يعملش job. النداء المتكرر ما يبدّأش نفس الهوية تاني.
   */
  readonly afterClaim = (): void => {
    const identity = this.#frame?.identity ?? null;
    this.#frame = null;
    if (identity === null || this.#stopping) return;
    const key = identityKey(identity);
    if (this.#jobs.has(key) || this.#jobs.size >= this.#concurrency) {
      this.#safeLog(identity, DROPPED, this.#jobs.has(key) ? "duplicate_active" : "capacity_full");
      return;
    }
    const job = this.#admit(identity, key);
    queueMicrotask(() => {
      this.#begin(job);
    });
  };

  /**
   * يرفض قبول جديد، يرمي السجلات غير الملتزمة، ويوقف إشارات الشغل الجاري،
   * ويستنى الملتزم يخلّص. التكرار آمن. ما بيكتبش تحرير تأجير.
   *
   * @returns وعد بيخلّص لما الشغل الملتزم يخلّص
   */
  readonly stop = (): Promise<void> => {
    if (this.#stopped !== null) return this.#stopped;
    this.#stopping = true;
    this.#frame = null;
    for (const job of this.#jobs.values()) {
      job.skip = true;
      job.controller.abort();
    }
    const pending = [...this.#jobs.values()].map((job) => job.settled);
    this.#stopped = Promise.all(pending).then(() => undefined);
    return this.#stopped;
  };

  #admit(identity: LeasedExportIdentity, key: string): LocalJob {
    let finish = (): void => undefined;
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const job: LocalJob = {
      key,
      identity,
      controller: new AbortController(),
      settled,
      finish,
      skip: false,
      released: false,
    };
    this.#jobs.set(key, job);
    return job;
  }

  #begin(job: LocalJob): void {
    if (job.skip || this.#stopping || job.controller.signal.aborted) {
      this.#release(job);
      return;
    }
    void this.#executeJob(job).catch(() => {
      this.#release(job);
    });
  }

  async #executeJob(job: LocalJob): Promise<void> {
    try {
      await this.#execute(copyIdentity(job.identity), job.controller.signal);
    } catch {
      this.#safeLog(job.identity, FAILED, EXECUTION_FAILED);
    } finally {
      this.#release(job);
    }
  }

  #release(job: LocalJob): void {
    if (job.released) return;
    job.released = true;
    this.#jobs.delete(job.key);
    try {
      job.finish();
    } catch {
      // Settlement must not leak the slot if a waiter throws.
    }
  }

  // "error" is a base catalogue event. This increment does not extend the worker catalogue.
  #safeLog(
    identity: LeasedExportIdentity,
    outcome: typeof FAILED | typeof DROPPED,
    code: string,
  ): void {
    try {
      this.#logger.error(
        {
          exportHandoff: {
            clinicId: identity.clinicId,
            exportId: identity.exportId,
            attempt: identity.attempt,
            outcome,
            code,
          },
        },
        "error",
      );
    } catch {
      // Diagnostic failure must not leak capacity or reject the hook.
    }
  }
}

function copyIdentity(identity: LeasedExportIdentity): LeasedExportIdentity {
  let clinicId: unknown;
  let exportId: unknown;
  let attempt: unknown;
  let leaseOwner: unknown;
  try {
    clinicId = identity.clinicId;
    exportId = identity.exportId;
    attempt = identity.attempt;
    leaseOwner = identity.leaseOwner;
  } catch {
    throw new Error("export_handoff_record_invalid");
  }
  if (
    typeof clinicId !== "string" ||
    typeof exportId !== "string" ||
    typeof leaseOwner !== "string" ||
    typeof attempt !== "number" ||
    !Number.isSafeInteger(attempt)
  ) {
    throw new Error("export_handoff_record_invalid");
  }
  return { clinicId, exportId, attempt, leaseOwner };
}

function identityKey(identity: LeasedExportIdentity): string {
  return JSON.stringify([
    identity.clinicId,
    identity.exportId,
    identity.attempt,
    identity.leaseOwner,
  ]);
}
