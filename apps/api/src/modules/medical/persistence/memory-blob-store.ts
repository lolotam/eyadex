import type { BlobStore } from "../ports/blob-store.ts";

/**
 * The blob store the API tests bind instead of Openinary: a map in memory, copies in and out so a caller
 * can never change what is stored. Never bound outside tests.
 */
export class MemoryBlobStore implements BlobStore {
  readonly #blobs = new Map<string, Buffer>();

  /** Every stored key and its bytes, for assertions on what left the API. */
  get stored(): ReadonlyMap<string, Buffer> {
    return this.#blobs;
  }

  put(key: string, bytes: Buffer): Promise<void> {
    this.#blobs.set(key, Buffer.from(bytes));
    return Promise.resolve();
  }

  get(key: string): Promise<Buffer> {
    const bytes = this.#blobs.get(key);
    if (bytes === undefined) return Promise.reject(new Error("blob not found"));
    return Promise.resolve(Buffer.from(bytes));
  }
}
