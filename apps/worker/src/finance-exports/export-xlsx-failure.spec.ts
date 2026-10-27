import { describe, expect, it } from "vitest";
import { ExportXlsxStream } from "./export-xlsx-stream.ts";

async function deadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("xlsx_operation_stalled")), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("incremental workbook failure cleanup", () => {
  it("rejects a pending sheet write and disposes after the encrypted destination fails", async () => {
    const failure = new Error("sample_destination_full");
    const control = new AbortController();
    let writes = 0;
    const writer = new ExportXlsxStream(
      async () => {
        writes++;
        throw failure;
      },
      control.signal,
      ["Count"],
      false,
    );
    try {
      await expect(deadline(writer.write([{ kind: "count", value: 1n }]))).rejects.toBe(failure);
      expect(writes).toBe(1);
    } finally {
      control.abort();
      await deadline(writer.dispose());
    }
  });
});
