import { describe, expect, it } from "vitest";
import { MemoryPdfProcess, PdfProcessError } from "../rendering/pdf-process.ts";
import { pdfDumpPolicyAllows } from "../rendering/pdf-dump-policy.ts";

const node = (runner: MemoryPdfProcess, code: string, input = new Uint8Array()) =>
  runner.run(process.execPath, ["-e", code], input);

describe("memory-only PDF process boundary", () => {
  it.each([
    ["Max core file size        0        0        bytes", "core", true],
    ["Max core file size        0        0        bytes", "|collector %p", false],
    ["Max core file size        0        unlimited        bytes", "core", false],
    ["Max core file size        unlimited        unlimited        bytes", "core", false],
    ["", "", false],
  ] as const)(
    "requires zero core limits and no piped collector: %s / %s",
    (limits, pattern, allowed) => {
      expect(pdfDumpPolicyAllows(limits, pattern)).toBe(allowed);
    },
  );
  it("pipes bytes without copying the API environment into the child", async () => {
    const runner = new MemoryPdfProcess();
    process.env["EYADEX_SYNTHETIC_TEST_MARKER"] = "synthetic-environment";
    try {
      const output = await node(
        runner,
        "if(process.env.EYADEX_SYNTHETIC_TEST_MARKER)process.exit(9);process.stdin.pipe(process.stdout)",
        Buffer.from("synthetic-document"),
      );
      expect(Buffer.from(output).toString()).toBe("synthetic-document");
    } finally {
      delete process.env["EYADEX_SYNTHETIC_TEST_MARKER"];
    }
  });

  it("reports only a fixed code and numeric exit status, discarding stderr", async () => {
    const runner = new MemoryPdfProcess();
    await expect(
      node(runner, "process.stderr.write('synthetic-private-text');process.exit(7)"),
    ).rejects.toMatchObject({ message: "pdf_render_failed", exitCode: 7 });
    expect(Buffer.from(await node(runner, "process.stdout.write('ok')")).toString()).toBe("ok");
  });

  it("handles a missing executable without leaking the native exception", async () => {
    await expect(
      new MemoryPdfProcess().run("/synthetic/missing-binary", [], new Uint8Array()),
    ).rejects.toBeInstanceOf(PdfProcessError);
  });

  it("kills a stalled child, discards its partial output, and releases the slot", async () => {
    const runner = new MemoryPdfProcess({ executionMs: 1000 });
    await expect(
      node(
        runner,
        "process.on('SIGTERM',()=>{});process.stdout.write('partial');setInterval(()=>{},1000)",
      ),
    ).rejects.toMatchObject({ code: "pdf_render_failed" });
    expect(Buffer.from(await node(runner, "process.stdout.write('next')")).toString()).toBe("next");
  });

  it("kills a child when its output exceeds the bound", async () => {
    const runner = new MemoryPdfProcess({ outputBytes: 1024 });
    await expect(
      node(runner, "process.stdout.write(Buffer.alloc(2048));setInterval(()=>{},1000)"),
    ).rejects.toMatchObject({ code: "pdf_render_failed" });
  });

  it("handles a child that exits before reading its input", async () => {
    await expect(
      node(new MemoryPdfProcess(), "process.exit(8)", new Uint8Array(1024 * 1024)),
    ).rejects.toMatchObject({ code: "pdf_render_failed" });
  });

  it("admits only two pipelines and refuses a queued request at its wait limit", async () => {
    const runner = new MemoryPdfProcess({ queueMs: 100 });
    const script = "setTimeout(()=>process.stdout.write('ok'),350)";
    const running = [node(runner, script), node(runner, script)];
    await expect(node(runner, script)).rejects.toMatchObject({ code: "pdf_busy" });
    expect(await Promise.all(running)).toHaveLength(2);
    expect(Buffer.from(await node(runner, "process.stdout.write('free')")).toString()).toBe("free");
  });

  it("refuses oversized input and attempts to relax production limits", async () => {
    await expect(
      node(new MemoryPdfProcess(), "", new Uint8Array(32 * 1024 * 1024 + 1)),
    ).rejects.toMatchObject({ code: "pdf_render_failed" });
    expect(() => new MemoryPdfProcess({ executionMs: 5001 })).toThrow("pdf_render_failed");
  });

  it("bounds waiting models during a burst of already serialized requests", async () => {
    const runner = new MemoryPdfProcess();
    const requests = Array.from({ length: 8 }, () =>
      node(runner, "setTimeout(()=>process.stdout.write('ok'),100)"),
    );
    const settled = await Promise.allSettled(requests);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(4);
    expect(
      settled.filter((result) => result.status === "rejected").map((result) => result.reason.code),
    ).toEqual(["pdf_busy", "pdf_busy", "pdf_busy", "pdf_busy"]);
  });

  it("serializes only after receiving an execution slot", async () => {
    const runner = new MemoryPdfProcess();
    let serialized = 0;
    let started!: () => void;
    const firstTwoStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const requests = Array.from({ length: 8 }, () =>
      runner.run(process.execPath, ["-e", "setTimeout(()=>process.stdout.write('ok'),100)"], () => {
        serialized++;
        if (serialized === 2) started();
        return new Uint8Array();
      }),
    );
    const results = Promise.allSettled(requests);
    await firstTwoStarted;
    expect(serialized).toBe(2);
    const settled = await results;
    expect(serialized).toBe(4);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(4);
    expect(
      settled.filter((result) => result.status === "rejected").map((result) => result.reason.code),
    ).toEqual(["pdf_busy", "pdf_busy", "pdf_busy", "pdf_busy"]);
  });
});
