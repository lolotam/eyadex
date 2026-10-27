import { ZipWriter } from "@zip.js/zip.js";
import {
  ReadableStream,
  TransformStream,
  WritableStream,
  type WritableStreamDefaultWriter,
} from "node:stream/web";
import type { PreparedField } from "./domain/export-cells.ts";
import {
  ROOT_RELATIONSHIP,
  WORKBOOK_STYLES,
  sheetRowXml,
  sheetStartXml,
  workbookXml,
} from "./domain/export-sheet-xml.ts";

// Excel's worksheet format limit, not a report row cap. The next row starts a new sheet.
export const XLSX_DATA_ROWS_PER_SHEET = 1_048_575;

/** Incremental ZIP64 writer: one active sheet, inline strings, sequential ZIP entries, no entry buffer. */
export class ExportXlsxStream {
  readonly #zip: ZipWriter<unknown>;
  #sheet: WritableStreamDefaultWriter<Uint8Array> | undefined;
  #added: Promise<unknown> | undefined;
  #sheetNumber = 0;
  #rows = 0;

  constructor(
    append: (bytes: Uint8Array) => Promise<void>,
    private readonly signal: AbortSignal,
    private readonly header: readonly string[],
    private readonly rtl: boolean,
  ) {
    this.#zip = new ZipWriter(new WritableStream<Uint8Array>({ write: append }), {
      zip64: true,
      bufferedWrite: false,
      keepOrder: true,
      useWebWorkers: false,
      useCompressionStream: true,
      level: 1,
      signal,
    });
  }

  async #startSheet(): Promise<void> {
    this.signal.throwIfAborted();
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    this.#sheet = stream.writable.getWriter();
    this.#added = this.#zip.add(`xl/worksheets/sheet${++this.#sheetNumber}.xml`, stream.readable);
    // A failing ZIP must reject writes too; the pending add is always awaited on completion/disposal.
    void this.#added.catch(() => undefined);
    this.#rows = 0;
    await this.#sheet.write(Buffer.from(sheetStartXml(this.rtl)));
    await this.#sheet.write(
      Buffer.from(
        sheetRowXml(
          this.header.map((value) => ({ kind: "text", value })),
          1,
        ),
      ),
    );
  }

  async write(fields: readonly PreparedField[]): Promise<void> {
    this.signal.throwIfAborted();
    if (this.#sheet === undefined) await this.#startSheet();
    if (this.#rows === XLSX_DATA_ROWS_PER_SHEET) {
      await this.#closeSheet();
      await this.#startSheet();
    }
    await this.#sheet!.write(Buffer.from(sheetRowXml(fields, ++this.#rows + 1)));
  }

  async #closeSheet(): Promise<void> {
    if (this.#sheet === undefined) return;
    await this.#sheet.write(Buffer.from("</sheetData></worksheet>"));
    await this.#sheet.close();
    await this.#added;
    this.#sheet = undefined;
  }

  async #add(name: string, chunks: Iterable<string>): Promise<void> {
    const iterator = chunks[Symbol.iterator]();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = iterator.next();
        if (chunk.done) controller.close();
        else controller.enqueue(Buffer.from(chunk.value));
      },
    });
    await this.#zip.add(name, stream);
  }

  async finish(): Promise<void> {
    this.signal.throwIfAborted();
    if (this.#sheet === undefined) await this.#startSheet();
    await this.#closeSheet();
    await this.#add("[Content_Types].xml", workbookXml("types", this.#sheetNumber));
    await this.#add("_rels/.rels", [ROOT_RELATIONSHIP]);
    await this.#add("xl/workbook.xml", workbookXml("workbook", this.#sheetNumber));
    await this.#add("xl/_rels/workbook.xml.rels", workbookXml("relations", this.#sheetNumber));
    await this.#add("xl/styles.xml", [WORKBOOK_STYLES]);
    await this.#zip.close();
  }

  async dispose(): Promise<void> {
    await this.#sheet?.abort().catch(() => undefined);
    await this.#added?.catch(() => undefined);
  }
}
