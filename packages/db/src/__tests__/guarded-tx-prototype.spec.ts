import { describe, expect, it } from "vitest";

import { guardTransaction, type RawTx } from "../guarded-tx.ts";

/**
 * من غير trap لـ `setPrototypeOf`، العملية بتعدّي على الـ target: `Object.setPrototypeOf(tx, …)` كان
 * بيغيّر أب الـ transaction الحقيقية، و`rollback()` مزروعة كانت بتشتغل والـ `this` هو الـ transaction
 * الخام. (Codex على PR #22، P1.)
 */
describe("tx cannot be re-parented or frozen to reach the raw transaction", () => {
  const fakeRaw = () => {
    const seen: unknown[] = [];
    const raw = {
      rollback(this: unknown) {
        seen.push(this);
        return "rolled back";
      },
    };
    return { raw, seen };
  };

  it("refuses Object.setPrototypeOf and Object.preventExtensions", () => {
    const { raw } = fakeRaw();
    const { tx } = guardTransaction(raw as unknown as RawTx);
    const escaped: unknown[] = [];
    expect(() =>
      Object.setPrototypeOf(tx, {
        rollback(this: unknown) {
          escaped.push(this);
        },
      }),
    ).toThrow(TypeError);
    expect(() => Object.preventExtensions(tx)).toThrow(TypeError);
    expect(Object.getPrototypeOf(raw)).toBe(Object.prototype);
    tx.rollback();
    expect(escaped).toEqual([]);
  });

  it("rollback is the method captured at guard time, run on the raw transaction", () => {
    const { raw, seen } = fakeRaw();
    const { tx } = guardTransaction(raw as unknown as RawTx);
    raw.rollback = () => "swapped later";
    expect(tx.rollback()).toBe("rolled back");
    expect(seen).toEqual([raw]);
  });
});
