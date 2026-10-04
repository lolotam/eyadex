import { describe, expect, it } from "vitest";

import { createUuidV7, systemUuidV7, type UuidV7Sources } from "../index.js";

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sources = (times: number[], fill = 0x00): UuidV7Sources => {
  let call = 0;
  return {
    now: () => times[Math.min(call++, times.length - 1)] ?? 0,
    fillRandom: (bytes) => bytes.fill(fill),
  };
};

const timestampOf = (id: string): number =>
  Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);

describe("createUuidV7", () => {
  it("encodes the injected time in the first 48 bits and sets version 7 and the RFC variant", () => {
    const id = createUuidV7(sources([1_727_000_000_000], 0xff)).newId();
    expect(id).toMatch(V7);
    expect(timestampOf(id)).toBe(1_727_000_000_000);
  });

  it("is deterministic for the same sources", () => {
    const a = createUuidV7(sources([5, 5, 6], 0x42));
    const b = createUuidV7(sources([5, 5, 6], 0x42));
    expect([a.newId(), a.newId(), a.newId()]).toEqual([b.newId(), b.newId(), b.newId()]);
  });

  it("stays strictly increasing within one millisecond and when the clock goes back", () => {
    const generator = createUuidV7(sources([100, 100, 100, 99, 50, 101]));
    const ids = Array.from({ length: 6 }, () => generator.newId());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(6);
  });

  it("moves to the next millisecond when the 12-bit counter is exhausted", () => {
    const generator = createUuidV7(sources([7], 0xff));
    const ids = Array.from({ length: 4097 }, () => generator.newId());
    expect([...ids].sort()).toEqual(ids);
    expect(timestampOf(ids.at(-1) ?? "")).toBe(8);
  });

  it.each([-1, 1.5, Number.NaN, 2 ** 48])("rejects the timestamp %s", (ms) => {
    expect(() => createUuidV7(sources([ms])).newId()).toThrow(RangeError);
  });
});

describe("systemUuidV7", () => {
  it("produces distinct, sortable v7 ids from the system clock and Web Crypto", () => {
    const generator = systemUuidV7();
    const ids = Array.from({ length: 1000 }, () => generator.newId());
    for (const id of ids) expect(id).toMatch(V7);
    expect(new Set(ids).size).toBe(1000);
    expect([...ids].sort()).toEqual(ids);
  });
});
