import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import type { FieldCipher, FieldRef } from "./field-cipher.ts";

export const FILE_MAGIC = Buffer.from("EYADEXE1");
export const PLAIN_CHUNK_BYTES = 65_536;
const MAX_RECORD_BYTES = 90_000;
export type FileCipher = Pick<FieldCipher, "sealBytes" | "openBytes">;

function chunkRef(ref: FieldRef, index: number): FieldRef {
  return { ...ref, rowId: `${ref.rowId}:chunk:${index}` };
}

export function sealRecord(
  cipher: FileCipher,
  clinicId: string,
  ref: FieldRef,
  index: number,
  plain: Buffer,
): Buffer {
  const envelope = Buffer.from(cipher.sealBytes(clinicId, chunkRef(ref, index), plain), "utf8");
  if (envelope.length > MAX_RECORD_BYTES) throw new Error("sealed_file_record_invalid");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(envelope.length);
  return Buffer.concat([length, envelope]);
}

async function readExact(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const read = await file.read(bytes, offset, length - offset, position + offset);
    if (read.bytesRead === 0) throw new Error("sealed_file_truncated");
    offset += read.bytesRead;
  }
  return bytes;
}

/** Complete ordered authentication: a mandatory final record commits the byte length and digest. */
export async function* openFileRecords(
  file: FileHandle,
  cipher: FileCipher,
  clinicId: string,
  ref: FieldRef,
  signal: AbortSignal,
): AsyncGenerator<Buffer> {
  const magic = await readExact(file, 0, FILE_MAGIC.length);
  if (!magic.equals(FILE_MAGIC)) throw new Error("sealed_file_invalid");
  let position = FILE_MAGIC.length;
  let index = 0;
  let total = 0;
  const hash = createHash("sha256");
  for (;;) {
    signal.throwIfAborted();
    const length = (await readExact(file, position, 4)).readUInt32BE();
    if (length < 1 || length > MAX_RECORD_BYTES) throw new Error("sealed_file_record_invalid");
    position += 4;
    const envelope = await readExact(file, position, length);
    position += length;
    const plain = cipher.openBytes(clinicId, chunkRef(ref, index++), envelope.toString("utf8"));
    if (plain[0] === 1) {
      const trailing = Buffer.alloc(1);
      if (
        plain.length !== 41 ||
        plain.readBigUInt64BE(1) !== BigInt(total) ||
        !plain.subarray(9).equals(hash.digest()) ||
        (await file.read(trailing, 0, 1, position)).bytesRead !== 0
      ) {
        throw new Error("sealed_file_integrity_failed");
      }
      return;
    }
    if (plain[0] !== 0 || plain.length < 2 || plain.length > PLAIN_CHUNK_BYTES + 1)
      throw new Error("sealed_file_record_invalid");
    const body = plain.subarray(1);
    total += body.length;
    if (!Number.isSafeInteger(total)) throw new Error("sealed_file_size_invalid");
    hash.update(body);
    yield body;
  }
}
