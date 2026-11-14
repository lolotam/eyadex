import { describe, expect, it, vi } from "vitest";
import { collectPaymentPrintPages } from "./collect-payment-print-pages";

describe("collectPaymentPrintPages", () => {
  it("returns every row in cursor order, including after an empty page", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ items: [1], nextCursor: "a" })
      .mockResolvedValueOnce({ items: [], nextCursor: "b" })
      .mockResolvedValueOnce({ items: [2], nextCursor: null });

    await expect(collectPaymentPrintPages(read, () => true)).resolves.toEqual([1, 2]);
    expect(read.mock.calls).toEqual([[undefined], ["a"], ["b"]]);
  });

  it("rejects a later-page failure and retries from the first page", async () => {
    const failure = new Error("network");
    const read = vi
      .fn()
      .mockResolvedValueOnce({ items: [1], nextCursor: "a" })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ items: [2], nextCursor: null });

    await expect(collectPaymentPrintPages(read, () => true)).rejects.toBe(failure);
    await expect(collectPaymentPrintPages(read, () => true)).resolves.toEqual([2]);
    expect(read.mock.calls.at(-1)).toEqual([undefined]);
  });

  it("does not read when the print run is already invalid", async () => {
    const read = vi.fn();
    await expect(collectPaymentPrintPages(read, () => false)).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("discards a response that arrives after invalidation", async () => {
    let resolve!: (page: { items: number[]; nextCursor: string }) => void;
    let current = true;
    const read = vi.fn(
      () =>
        new Promise<{ items: number[]; nextCursor: string }>((done) => {
          resolve = done;
        }),
    );
    const pending = collectPaymentPrintPages(read, () => current);
    current = false;
    resolve({ items: [1], nextCursor: "never-read" });

    await expect(pending).resolves.toBeNull();
    expect(read).toHaveBeenCalledOnce();
  });

  it("rejects a repeated cursor instead of looping forever", async () => {
    const read = vi.fn().mockResolvedValue({ items: [1], nextCursor: "same" });
    await expect(collectPaymentPrintPages(read, () => true)).rejects.toThrow(
      "Repeated payment print cursor",
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("returns an empty terminal result without printing partial state", async () => {
    const read = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    await expect(collectPaymentPrintPages(read, () => true)).resolves.toEqual([]);
  });
});
