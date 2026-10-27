import { strFromU8, Unzip, UnzipInflate } from "fflate";
import { expect, it } from "vitest";
import { ExportXlsxStream, XLSX_DATA_ROWS_PER_SHEET } from "./export-xlsx-stream.ts";

it("continues beyond Excel's worksheet limit with repeated headers and complete ZIP64 output", async () => {
  const counts = new Map<string, { rows: number; last: number; final: boolean }>();
  let zipError: Error | null = null;
  const unzip = new Unzip((entry) => {
    if (!entry.name.startsWith("xl/worksheets/")) return;
    const state = { rows: 0, last: 0, final: false };
    counts.set(entry.name, state);
    let tail = "";
    entry.ondata = (error, bytes, final) => {
      if (error) {
        zipError = error;
        return;
      }
      const text = tail + strFromU8(bytes);
      let consumed = 0;
      for (const match of text.matchAll(/<row r="([0-9]+)"/g)) {
        state.rows++;
        state.last = Number(match[1]);
        consumed = match.index + match[0].length;
      }
      tail = text.slice(Math.max(consumed, text.length - 64));
      state.final = final;
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  const writer = new ExportXlsxStream(
    async (bytes) => {
      unzip.push(bytes);
    },
    new AbortController().signal,
    ["Count"],
    false,
  );
  try {
    for (let row = 0; row < XLSX_DATA_ROWS_PER_SHEET + 1; row++)
      await writer.write([{ kind: "count", value: 1n }]);
    await writer.finish();
    unzip.push(new Uint8Array(), true);
    expect(zipError).toBeNull();
    expect(counts.get("xl/worksheets/sheet1.xml")).toEqual({
      rows: 1_048_576,
      last: 1_048_576,
      final: true,
    });
    expect(counts.get("xl/worksheets/sheet2.xml")).toEqual({ rows: 2, last: 2, final: true });
  } finally {
    await writer.dispose();
  }
}, 120_000);
