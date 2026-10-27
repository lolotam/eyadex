import { SealedFile, type FieldCipher } from "@eyadex/secrets";
import { prepareReportExport, type ExportCsvRow } from "./domain/export-cells.ts";
import { writeReportCsv } from "./domain/export-csv.ts";
import type { ExportFence, PreparedExportJob } from "./ports/export-store.ts";
import { ExportXlsxStream } from "./export-xlsx-stream.ts";

/** Writes each row once, directly into a bounded encrypted artifact, without a whole-file buffer. */
export class ExportFileWriter {
  #rowCount = 0;
  #finished = false;
  #xlsx: ExportXlsxStream | undefined;

  private constructor(
    readonly file: SealedFile,
    private readonly job: PreparedExportJob,
    private readonly signal: AbortSignal,
    private readonly csvHeaderBytes: number,
  ) {}

  static async create(
    fence: ExportFence,
    job: PreparedExportJob,
    cipher: FieldCipher,
    signal: AbortSignal,
  ): Promise<ExportFileWriter> {
    signal.throwIfAborted();
    const empty = { report: job.report, language: job.params.language, rows: [] };
    const prepared = prepareReportExport(empty);
    const header = writeReportCsv(empty);
    if (!prepared.ok || !header.ok) throw new Error("export_value_invalid");
    const file = await SealedFile.create(cipher, fence.clinicId, {
      table: "finance_report_exports",
      column: "blob",
      rowId: `${fence.exportId}:${fence.attempt}`,
    });
    try {
      const writer = new ExportFileWriter(file, job, signal, header.bytes.length);
      if (job.format === "csv") await file.append(header.bytes, signal);
      else
        writer.#xlsx = new ExportXlsxStream(
          (bytes) => file.append(bytes, signal),
          signal,
          prepared.header,
          job.params.language === "ar",
        );
      return writer;
    } catch (error) {
      await file.dispose();
      throw error;
    }
  }

  async write(row: ExportCsvRow): Promise<void> {
    this.signal.throwIfAborted();
    if (this.#finished) throw new Error("export_writer_finished");
    const input = { report: this.job.report, language: this.job.params.language, rows: [row] };
    if (this.#xlsx !== undefined) {
      const prepared = prepareReportExport(input);
      if (!prepared.ok) throw new Error(prepared.code);
      await this.#xlsx.write(prepared.rows[0]!);
    } else {
      const written = writeReportCsv(input);
      if (!written.ok) throw new Error(written.code);
      // Reuse the reviewed precision/escaping rules without retaining a growing prepared-row array.
      await this.file.append(written.bytes.subarray(this.csvHeaderBytes), this.signal);
    }
    this.#rowCount++;
  }

  async finish(): Promise<void> {
    this.signal.throwIfAborted();
    if (this.#finished) throw new Error("export_writer_finished");
    await this.#xlsx?.finish();
    await this.file.finish();
    this.#finished = true;
  }

  get rowCount(): number {
    return this.#rowCount;
  }

  async dispose(): Promise<void> {
    try {
      await this.#xlsx?.dispose();
    } finally {
      await this.file.dispose();
    }
  }
}
