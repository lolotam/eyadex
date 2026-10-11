import { describe, expect, it } from "vitest";
import { SectionSaves } from "./visit-section-saves";

/** A save the test settles by hand. */
function pending() {
  let resolve: () => void = () => undefined;
  let reject: () => void = () => undefined;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = () => fail(new Error("save failed"));
  });
  return { promise, resolve, reject };
}

const nothingToFlush = () => Promise.resolve();

describe("the visit's section saves", () => {
  it("settle waits for every running save, and for a save started while it waits", async () => {
    const saves = new SectionSaves();
    const first = pending();
    const late = pending();
    void saves.track(first.promise);
    let settled = false;
    const waiting = saves.settle(nothingToFlush).then(() => (settled = true));
    void saves.track(late.promise);
    first.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    late.resolve();
    await waiting;
    expect(settled).toBe(true);
  });

  it("settle rejects when a save fails while it waits, even one started during the flush", async () => {
    const saves = new SectionSaves();
    const started = pending();
    const waiting = saves.settle(async () => {
      saves.track(started.promise).catch(() => undefined);
      started.reject();
      await Promise.resolve();
    });
    await expect(waiting).rejects.toThrow();
  });

  it("settle rejects when the flush fails", async () => {
    const saves = new SectionSaves();
    await expect(saves.settle(() => Promise.reject(new Error("note")))).rejects.toThrow("note");
  });

  it("a save that failed before the sign does not hold the next one back", async () => {
    const saves = new SectionSaves();
    const earlier = pending();
    saves.track(earlier.promise).catch(() => undefined);
    earlier.reject();
    await Promise.resolve();
    await expect(saves.settle(nothingToFlush)).resolves.toBeUndefined();
  });
});
