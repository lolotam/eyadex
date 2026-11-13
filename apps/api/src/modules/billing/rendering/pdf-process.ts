import { spawn } from "node:child_process";
import { pdfProcessGroupGone } from "./pdf-process-group.ts";

/** Fixed errors never include document bytes, child stderr, paths or native exception text. */
export class PdfProcessError extends Error {
  constructor(
    readonly code: "pdf_busy" | "pdf_render_failed",
    readonly exitCode?: number,
  ) {
    super(code);
    this.name = "PdfProcessError";
  }
}

type Limits = { executionMs: number; queueMs: number; outputBytes: number };
const maximum: Limits = { executionMs: 5000, queueMs: 2000, outputBytes: 5 * 1024 * 1024 };
type Waiter = { grant: () => void; refuse: () => void; timer: ReturnType<typeof setTimeout> };

/** One instance belongs to one renderer: at most two complete process pipelines can run. */
export class MemoryPdfProcess {
  private active = 0;
  private unavailable = false;
  private readonly queue: Waiter[] = [];
  private readonly limits: Limits;

  constructor(limits: Partial<Limits> = {}) {
    this.limits = { ...maximum, ...limits };
    for (const key of Object.keys(maximum) as (keyof Limits)[]) {
      if (
        !Number.isInteger(this.limits[key]) ||
        this.limits[key] < 1 ||
        this.limits[key] > maximum[key]
      ) {
        throw new PdfProcessError("pdf_render_failed");
      }
    }
  }

  async run(
    binary: string,
    args: readonly string[],
    input: Uint8Array | (() => Uint8Array),
  ): Promise<Uint8Array> {
    await this.acquire();
    try {
      const bytes = typeof input === "function" ? input() : input;
      if (bytes.byteLength > 32 * 1024 * 1024) throw new PdfProcessError("pdf_render_failed");
      return await this.execute(binary, args, bytes);
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.unavailable) return Promise.reject(new PdfProcessError("pdf_render_failed"));
    if (this.active < 2) {
      this.active++;
      return Promise.resolve();
    }
    // Waiting requests retain their models; cap them as well as active children.
    if (this.queue.length >= 2) return Promise.reject(new PdfProcessError("pdf_busy"));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        grant: resolve,
        refuse: () => reject(new PdfProcessError("pdf_render_failed")),
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index !== -1) this.queue.splice(index, 1);
          reject(new PdfProcessError("pdf_busy"));
        }, this.limits.queueMs),
      };
      this.queue.push(waiter);
    });
  }

  private release(): void {
    if (this.unavailable) {
      this.active--;
      for (const waiter of this.queue.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.refuse();
      }
      return;
    }
    const waiter = this.queue.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.grant();
    } else this.active--;
  }

  private execute(binary: string, args: readonly string[], input: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      // A Linux process group lets one kill cover the Node bridge, Typst and libqpdf helpers.
      const grouped = process.platform === "linux";
      const child = spawn(binary, [...args], {
        env: {},
        cwd: "/",
        detached: grouped,
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let failed = false;
      const terminateGroup = () => {
        if (child.pid === undefined) return;
        try {
          if (grouped) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          // Group disappearance is confirmed after the bridge's close event.
        }
      };
      const stop = () => {
        failed = true;
        chunks.length = 0;
        terminateGroup();
      };
      const timer = setTimeout(stop, this.limits.executionMs);
      child.once("error", stop);
      // EPIPE is an ordinary failed render, not an unhandled stream error.
      child.stdin.on("error", stop);
      child.stdout.on("error", stop);
      child.stdout.on("data", (chunk: Buffer) => {
        if (failed) return;
        size += chunk.length;
        if (size > this.limits.outputBytes) stop();
        else chunks.push(chunk);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        // A crashed bridge may leave helpers whose stdout is closed or ignored.
        // A close event reaps the bridge only, so always terminate its group too.
        terminateGroup();
        const cleanup =
          grouped && child.pid !== undefined
            ? pdfProcessGroupGone(child.pid)
            : Promise.resolve(true);
        void cleanup.then((gone) => {
          // A collector/init that does not reap must not permit more native work.
          if (!gone) this.unavailable = true;
          if (failed || code !== 0 || this.unavailable) {
            chunks.length = 0;
            reject(new PdfProcessError("pdf_render_failed", code ?? undefined));
          } else resolve(Buffer.concat(chunks, size));
        });
      });
      child.stdin.end(input);
    });
  }
}
