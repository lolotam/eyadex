import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldCipher } from "./field-cipher.ts";
import { SealedFile } from "./sealed-file.ts";
import { FILE_MAGIC, PLAIN_CHUNK_BYTES } from "./sealed-file-records.ts";

const hooks = vi.hoisted(() => ({
  read: undefined as (() => void) | undefined,
  write: undefined as (() => void) | undefined,
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    // The existing cleanup suite inventories eyadex-sealed-*; keep concurrent fixtures separate.
    mkdtemp: (prefix: string) =>
      fs.mkdtemp(prefix.replace("eyadex-sealed-", "eyadex-cancellation-")),
    open: async (...args: Parameters<typeof fs.open>) => {
      const file = await fs.open(...args);
      return new Proxy(file, {
        get(target, property) {
          const method: unknown = Reflect.get(target, property);
          if (typeof method !== "function") return method;
          if (property !== "read" && property !== "write") return method.bind(target);
          return async (...input: unknown[]) => {
            const result: unknown = await Reflect.apply(method, target, input);
            hooks[property]?.();
            return result;
          };
        },
      });
    },
  };
});

afterEach(() => {
  hooks.read = undefined;
  hooks.write = undefined;
});
const cipher = new FieldCipher(new Map([[1, randomBytes(32)]]), 1);
const clinic = randomUUID();
const ref = { table: "finance_report_exports", column: "blob", rowId: `${randomUUID()}:1` };
const signal = new AbortController().signal;

describe("sealed file cancellation at I/O boundaries", () => {
  it("rejects a pre-aborted empty append before writing magic", async () => {
    const file = await SealedFile.create(cipher, clinic, ref);
    const stop = new AbortController();
    stop.abort(new Error("cancelled before append"));
    try {
      await expect(file.append(Buffer.alloc(0), stop.signal)).rejects.toThrow(
        "cancelled before append",
      );
      expect(file.storedLength).toBe(0);
    } finally {
      await file.dispose();
    }
  });

  it.each(["magic", "final-full-chunk"])(
    "rejects cancellation during %s write",
    async (boundary) => {
      const file = await SealedFile.create(cipher, clinic, ref);
      const stop = new AbortController();
      try {
        if (boundary === "final-full-chunk") {
          await file.append(Buffer.alloc(0), signal);
          expect(file.storedLength).toBe(FILE_MAGIC.length);
        }
        hooks.write = () => stop.abort(new Error("cancelled during write"));
        await expect(
          file.append(Buffer.alloc(boundary === "magic" ? 0 : PLAIN_CHUNK_BYTES), stop.signal),
        ).rejects.toThrow("cancelled during write");
      } finally {
        await file.dispose();
      }
    },
  );

  it.each(["magic", "body", "footer"])(
    "does not yield or finish after an abort during %s read",
    async (boundary) => {
      const file = await SealedFile.create(cipher, clinic, ref);
      const stop = new AbortController();
      try {
        await file.append(Buffer.from("sample"), signal);
        await file.finish();
        await file.verify(signal);
        let reads = 0;
        // magic, body length, body, footer length, footer, trailing byte check.
        const abortAt = boundary === "magic" ? 1 : boundary === "body" ? 3 : 6;
        hooks.read = () => {
          if (++reads === abortAt) stop.abort(new Error("cancelled during read"));
        };
        const reader = file.plaintext(stop.signal);
        if (boundary === "footer") expect((await reader.next()).value?.toString()).toBe("sample");
        await expect(reader.next()).rejects.toThrow("cancelled during read");
      } finally {
        await file.dispose();
      }
    },
  );
});
