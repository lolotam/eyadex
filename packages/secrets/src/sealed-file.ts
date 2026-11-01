import { createHash } from "node:crypto";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { join } from "node:path";
import type { FieldRef } from "./field-cipher.ts";
import {
  FILE_MAGIC,
  openFileRecords,
  PLAIN_CHUNK_BYTES,
  sealRecord,
  type FileCipher,
} from "./sealed-file-records.ts";

/** A bounded encrypted spool. Only ciphertext reaches disk; dispose is required in finally. */
export class SealedFile {
  readonly #hash = createHash("sha256");
  readonly #pending = Buffer.alloc(PLAIN_CHUNK_BYTES);
  #pendingLength = 0;
  #index = 0;
  #length = 0;
  #stored = 0;
  #closed = false;
  #finished = false;
  #verified = false;

  private constructor(
    private readonly directory: string,
    private readonly file: FileHandle,
    private readonly cipher: FileCipher,
    private readonly clinicId: string,
    private readonly ref: FieldRef,
  ) {}

  static async create(cipher: FileCipher, clinicId: string, ref: FieldRef): Promise<SealedFile> {
    const directory = await mkdtemp(join(tmpdir(), "eyadex-sealed-"));
    try {
      const file = await open(join(directory, "content"), "wx+", 0o600);
      return new SealedFile(directory, file, cipher, clinicId, ref);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  /** Copy an existing encrypted object without decrypting or collecting it in memory. */
  static async receive(
    source: Readable,
    cipher: FileCipher,
    clinicId: string,
    ref: FieldRef,
    signal: AbortSignal,
  ): Promise<SealedFile> {
    if (!(source instanceof Readable)) throw new TypeError("sealed_file_source_not_cancellable");
    const cancel = () => {
      source.destroy();
    };
    if (signal.aborted) {
      cancel();
      signal.throwIfAborted();
    }
    // Protect the stream while asynchronous file creation runs, before for-await installs its handler.
    const ignoreError = () => {};
    source.on("error", ignoreError);
    signal.addEventListener("abort", cancel, { once: true });
    let result: SealedFile | undefined;
    try {
      result = await SealedFile.create(cipher, clinicId, ref);
      signal.throwIfAborted();
      for await (const chunk of source) {
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array)) throw new TypeError("sealed_file_source_invalid");
        await result.#write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      }
      signal.throwIfAborted();
      result.#finished = true;
      return result;
    } catch (error) {
      await result?.dispose();
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
      source.destroy();
      source.off("error", ignoreError);
    }
  }

  async #write(bytes: Buffer): Promise<void> {
    let offset = 0;
    while (offset < bytes.length) {
      const wrote = await this.file.write(bytes, offset, bytes.length - offset, this.#stored);
      if (wrote.bytesWritten === 0) throw new Error("sealed_file_write_failed");
      offset += wrote.bytesWritten;
      this.#stored += wrote.bytesWritten;
    }
  }

  /** Backpressure is the awaited write; callers must not append concurrently. */
  async append(bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    if (this.#finished || this.#closed) throw new Error("sealed_file_closed");
    if (this.#index === 0 && this.#stored === 0) await this.#write(FILE_MAGIC);
    let offset = 0;
    while (offset < bytes.length) {
      signal.throwIfAborted();
      const length = Math.min(bytes.length - offset, PLAIN_CHUNK_BYTES - this.#pendingLength);
      this.#pending.set(bytes.subarray(offset, offset + length), this.#pendingLength);
      this.#pendingLength += length;
      offset += length;
      if (this.#pendingLength === PLAIN_CHUNK_BYTES) await this.#flush();
    }
  }

  async #flush(): Promise<void> {
    if (this.#pendingLength === 0) return;
    const body = this.#pending.subarray(0, this.#pendingLength);
    await this.#write(
      sealRecord(
        this.cipher,
        this.clinicId,
        this.ref,
        this.#index++,
        Buffer.concat([Buffer.from([0]), body]),
      ),
    );
    this.#hash.update(body);
    this.#length += body.length;
    this.#pending.fill(0);
    this.#pendingLength = 0;
  }

  async finish(): Promise<void> {
    if (this.#finished || this.#closed) throw new Error("sealed_file_closed");
    if (this.#stored === 0) await this.#write(FILE_MAGIC);
    await this.#flush();
    const final = Buffer.alloc(41);
    final[0] = 1;
    final.writeBigUInt64BE(BigInt(this.#length), 1);
    this.#hash.digest().copy(final, 9);
    await this.#write(sealRecord(this.cipher, this.clinicId, this.ref, this.#index++, final));
    this.#finished = true;
  }

  get storedLength(): number {
    return this.#stored;
  }
  get plainLength(): number {
    return this.#length;
  }

  /** No plaintext is exposed by this pass, including when the final record is corrupt or absent. */
  async verify(signal: AbortSignal): Promise<number> {
    if (!this.#finished || this.#closed) throw new Error("sealed_file_closed");
    this.#verified = false;
    let length = 0;
    for await (const bytes of openFileRecords(
      this.file,
      this.cipher,
      this.clinicId,
      this.ref,
      signal,
    ))
      length += bytes.length;
    this.#length = length;
    this.#verified = true;
    return length;
  }

  async *plaintext(signal: AbortSignal): AsyncGenerator<Buffer> {
    if (!this.#verified || this.#closed) throw new Error("sealed_file_unverified");
    yield* openFileRecords(this.file, this.cipher, this.clinicId, this.ref, signal);
  }

  ciphertext() {
    if (!this.#finished || this.#closed) throw new Error("sealed_file_closed");
    return this.file.createReadStream({ start: 0, autoClose: false });
  }

  async dispose(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#pending.fill(0);
    try {
      await this.file.close();
    } finally {
      await rm(this.directory, { recursive: true, force: true });
    }
  }
}
