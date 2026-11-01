import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { FieldCipher } from "./field-cipher.ts";
import { SealedFile } from "./sealed-file.ts";

const signal = new AbortController().signal;
const clinic = randomUUID();
const ref = { table: "finance_report_exports", column: "blob", rowId: `${randomUUID()}:1` };
const cipher = new FieldCipher(
  new Map([
    [1, randomBytes(32)],
    [2, randomBytes(32)],
  ]),
  2,
);
const collect = async (source: AsyncIterable<Uint8Array>) => {
  const chunks = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};
async function stored(bytes: Buffer) {
  const file = await SealedFile.create(cipher, clinic, ref);
  try {
    await file.append(bytes, signal);
    await file.finish();
    return await collect(file.ciphertext());
  } finally {
    await file.dispose();
  }
}
async function receive(
  bytes: Buffer,
  targetClinic = clinic,
  targetRef = ref,
  targetCipher = cipher,
) {
  return SealedFile.receive(
    Readable.from(
      (async function* () {
        // Split the magic/header and cross record boundaries without thousands of tiny disk writes.
        const sizes = [1, 3, 137, 4093];
        for (let offset = 0, index = 0; offset < bytes.length; index++) {
          const size = sizes[Math.min(index, sizes.length - 1)]!;
          yield bytes.subarray(offset, offset + size);
          offset += size;
        }
      })(),
    ),
    targetCipher,
    targetClinic,
    targetRef,
    signal,
  );
}
function records(bytes: Buffer) {
  const rows = [];
  for (let position = 8; position < bytes.length;) {
    const size = bytes.readUInt32BE(position) + 4;
    rows.push(bytes.subarray(position, position + size));
    position += size;
  }
  return rows;
}

describe("bounded encrypted temporary files", () => {
  it("aborts a source stalled after one chunk and removes its encrypted temporary file", async () => {
    const directories = async () =>
      (await readdir(tmpdir())).filter((name) => name.startsWith("eyadex-sealed-")).sort();
    const before = await directories();
    let stalled = () => {};
    const waiting = new Promise<void>((resolve) => {
      stalled = resolve;
    });
    let sent = false;
    const source = new Readable({
      read() {
        if (!sent) {
          sent = true;
          this.push(randomBytes(100));
        } else stalled();
      },
    });
    const stop = new AbortController();
    const work = SealedFile.receive(source, cipher, clinic, ref, stop.signal);
    await waiting;
    stop.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(
        Promise.race([
          work,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("source remained stuck after abort")), 500);
          }),
        ]),
      ).rejects.not.toThrow("source remained stuck after abort");
      expect(source.destroyed).toBe(true);
    } finally {
      clearTimeout(timer);
      source.destroy();
      await work.catch(() => undefined);
    }
    expect(await directories()).toEqual(before);
  });
  it("destroys a source immediately for a pre-aborted receive without creating a file", async () => {
    const source = new Readable({ read() {} });
    const stop = new AbortController();
    stop.abort();
    await expect(SealedFile.receive(source, cipher, clinic, ref, stop.signal)).rejects.toThrow();
    expect(source.destroyed).toBe(true);
  });
  it.each([0, 1, 65_536, 196_613])(
    "round-trips %i bytes only after complete verification",
    async (length) => {
      const plain = randomBytes(length);
      const bytes = await stored(plain);
      const file = await receive(bytes);
      try {
        expect(file.storedLength).toBe(bytes.length);
        await expect(collect(file.plaintext(signal))).rejects.toThrow("sealed_file_unverified");
        expect(await file.verify(signal)).toBe(length);
        expect(await collect(file.plaintext(signal))).toEqual(plain);
      } finally {
        await file.dispose();
      }
    },
  );
  it("never writes patient plaintext to the temporary file", async () => {
    const marker = `synthetic-private-row-${randomUUID()}`;
    const bytes = await stored(Buffer.from(marker.repeat(2_000)));
    expect(bytes.includes(Buffer.from(marker))).toBe(false);
    expect(bytes.toString()).toContain("f1.2.");
  });
  it.each(["clinic", "export", "attempt", "key"])(
    "refuses a substituted %s before exposing bytes",
    async (kind) => {
      const bytes = await stored(randomBytes(140_000));
      const file = await receive(
        bytes,
        kind === "clinic" ? randomUUID() : clinic,
        kind === "export"
          ? { ...ref, rowId: `${randomUUID()}:1` }
          : kind === "attempt"
            ? { ...ref, rowId: ref.rowId.replace(/:1$/, ":2") }
            : ref,
        kind === "key" ? new FieldCipher(new Map([[2, randomBytes(32)]]), 2) : cipher,
      );
      try {
        await expect(file.verify(signal)).rejects.toThrow();
        await expect(collect(file.plaintext(signal))).rejects.toThrow("sealed_file_unverified");
      } finally {
        await file.dispose();
      }
    },
  );
  it.each([
    "missing-final",
    "truncated",
    "trailing",
    "reordered",
    "corrupt-body",
    "corrupt-final",
    "oversized-record",
  ])("rejects %s including failures late in the object", async (kind) => {
    const valid = await stored(randomBytes(140_000));
    const parts = records(valid);
    let bytes = Buffer.from(valid);
    if (kind === "missing-final")
      bytes = Buffer.concat([valid.subarray(0, 8), ...parts.slice(0, -1)]);
    if (kind === "truncated") bytes = valid.subarray(0, valid.length - 1);
    if (kind === "trailing") bytes = Buffer.concat([valid, Buffer.from([0])]);
    if (kind === "reordered")
      bytes = Buffer.concat([valid.subarray(0, 8), parts[1]!, parts[0]!, ...parts.slice(2)]);
    if (kind === "corrupt-body") bytes[40] = bytes[40]! ^ 1;
    if (kind === "corrupt-final") bytes[bytes.length - 5] = bytes[bytes.length - 5]! ^ 1;
    if (kind === "oversized-record") bytes.writeUInt32BE(0xffff_ffff, 8);
    const file = await receive(bytes);
    try {
      await expect(file.verify(signal)).rejects.toThrow();
      await expect(collect(file.plaintext(signal))).rejects.toThrow("sealed_file_unverified");
    } finally {
      await file.dispose();
    }
  });
  it("refuses aborted writes and supports idempotent disposal", async () => {
    const file = await SealedFile.create(cipher, clinic, ref);
    const stop = new AbortController();
    stop.abort();
    try {
      await expect(file.append(randomBytes(100_000), stop.signal)).rejects.toThrow();
    } finally {
      await file.dispose();
      await file.dispose();
    }
    await expect(file.append(Buffer.from("sample"), signal)).rejects.toThrow("sealed_file_closed");
  });
});
