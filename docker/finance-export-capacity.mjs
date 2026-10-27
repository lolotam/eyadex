// Local synthetic artifact diagnostic; not full API/SQL/S3 deployment acceptance.
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
const { ExportFileWriter } = await import("file:///app/dist/finance-exports/export-file-writer.js");
const { FieldCipher, SealedFile } =
  await import("file:///app/node_modules/@eyadex/secrets/dist/index.js");
const { REPORT_EXPORT_COLUMNS } =
  await import("file:///app/node_modules/@eyadex/contracts/dist/finance-reports.js");
const format = process.argv[2],
  count = Number(process.argv[3]),
  concurrent = Number(process.argv[4] ?? 2);
if (
  !["csv", "xlsx"].includes(format) ||
  !Number.isSafeInteger(count) ||
  count < 1 ||
  !Number.isSafeInteger(concurrent) ||
  concurrent < 1 ||
  concurrent > 32
)
  throw new Error("invalid_capacity_arguments");
const cipher = new FieldCipher(new Map([[1, randomBytes(32)]]), 1);
const signal = new AbortController().signal;
const started = performance.now();
async function run() {
  const fence = {
    clinicId: randomUUID(),
    exportId: randomUUID(),
    attempt: 1,
    leaseOwner: "sample-capacity",
  };
  const ref = { table: "finance_report_exports", column: "blob", rowId: `${fence.exportId}:1` };
  const job = {
    report: "outstanding",
    scope: "clinic",
    format,
    requestedBy: randomUUID(),
    userId: randomUUID(),
    params: { from: "2026-01-01", to: "2026-12-31", language: "en", branchIds: [] },
  };
  const writer = await ExportFileWriter.create(fence, job, cipher, signal);
  let received;
  try {
    for (let i = 0; i < count; i++) {
      const label = "Synthetic " + createHash("sha256").update(String(i)).digest("hex");
      const row = Object.fromEntries(
        REPORT_EXPORT_COLUMNS.outstanding.map((c) => [
          c.key,
          c.kind === "money"
            ? { kind: "money", minor: "12500", exponent: 3 }
            : c.kind === "count"
              ? { kind: "count", value: "1" }
              : c.kind === "date"
                ? { kind: "date", value: "2026-10-27" }
                : { kind: "text", value: c.key === "currency" ? "KWD" : label },
        ]),
      );
      await writer.write(row);
    }
    await writer.finish();
    received = await SealedFile.receive(
      writer.file.ciphertext(),
      cipher,
      fence.clinicId,
      ref,
      signal,
      writer.file.storedLength,
    );
    const plain = await received.verify(signal);
    let delivered = 0;
    for await (const chunk of received.plaintext(signal)) delivered += chunk.length;
    if (delivered !== plain || writer.rowCount !== count)
      throw new Error("capacity_count_mismatch");
    return { rows: writer.rowCount, storedBytes: writer.file.storedLength, plainBytes: plain };
  } finally {
    await received?.dispose();
    await writer.dispose();
  }
}
const files = await Promise.all(Array.from({ length: concurrent }, run));
console.log(
  JSON.stringify({
    format,
    count,
    concurrent,
    files,
    seconds: Math.round((performance.now() - started) / 10) / 100,
    maxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    cgroupPeakMiB: Math.round(
      Number(await readFile("/sys/fs/cgroup/memory.peak", "utf8")) / 1024 / 1024,
    ),
  }),
);
