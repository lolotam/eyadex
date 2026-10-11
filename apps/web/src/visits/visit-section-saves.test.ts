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
    void saves.track("note", first.promise);
    let settled = false;
    const waiting = saves.settle(nothingToFlush).then(() => (settled = true));
    void saves.track("diagnoses", late.promise);
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
      saves.track("diagnoses", started.promise).catch(() => undefined);
      started.reject();
      await Promise.resolve();
    });
    await expect(waiting).rejects.toThrow();
  });

  it("settle rejects when the flush fails", async () => {
    const saves = new SectionSaves();
    await expect(saves.settle(() => Promise.reject(new Error("note")))).rejects.toThrow("note");
  });

  it("a save that failed before the sign refuses it with that error, until the section saves again", async () => {
    const saves = new SectionSaves();
    const failed = pending();
    saves.track("diagnoses", failed.promise).catch(() => undefined);
    failed.reject();
    await Promise.resolve();
    await expect(saves.settle(nothingToFlush)).rejects.toThrow("save failed");
    // Another section saving does not clear it; only the failed section's own next save does.
    await saves.track("prescription", Promise.resolve());
    await expect(saves.settle(nothingToFlush)).rejects.toThrow("save failed");
    await saves.track("diagnoses", Promise.resolve());
    await expect(saves.settle(nothingToFlush)).resolves.toBeUndefined();
  });

  it("an older save of a section settling after its newer one never changes the section's state", async () => {
    const saves = new SectionSaves();
    const older = pending();
    const newer = pending();
    saves.track("diagnoses", older.promise).catch(() => undefined);
    void saves.track("diagnoses", newer.promise);
    newer.resolve();
    older.reject();
    await expect(saves.settle(nothingToFlush)).resolves.toBeUndefined();
  });
});

// Codex 4241757315: a list form's flush runs after the saves on their way, and only while registered.
describe("the registered section flushes", () => {
  it("run after the running saves settle, and no longer once unregistered", async () => {
    const saves = new SectionSaves();
    const running = pending();
    void saves.track("diagnoses", running.promise);
    const order: string[] = [];
    const undo = saves.register("diagnoses", async () => {
      order.push("flush");
    });
    void running.promise.then(() => order.push("saved"));
    const waiting = saves.settle(nothingToFlush);
    running.resolve();
    await waiting;
    expect(order).toEqual(["saved", "flush"]);
    undo();
    await saves.settle(nothingToFlush);
    expect(order).toEqual(["saved", "flush"]);
  });

  it("a flush that refuses refuses the settle", async () => {
    const saves = new SectionSaves();
    saves.register("prescription", () => Promise.reject(new Error("invalid")));
    await expect(saves.settle(nothingToFlush)).rejects.toThrow("invalid");
  });
});
