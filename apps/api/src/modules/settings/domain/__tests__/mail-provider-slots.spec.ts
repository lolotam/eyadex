import { describe, expect, it } from "vitest";

import { slotPutRefusal, slotRemoveRefusal } from "../mail-provider-rules.ts";

describe("mail provider slots (N-3)", () => {
  it("a fallback is refused while the clinic has no primary", () => {
    expect(slotPutRefusal("fallback", false)).toBe("fallback_without_primary");
    expect(slotPutRefusal("fallback", true)).toBeNull();
  });

  it("the primary can always be saved", () => {
    expect(slotPutRefusal("primary", false)).toBeNull();
    expect(slotPutRefusal("primary", true)).toBeNull();
  });

  it("the primary cannot be removed while a fallback exists", () => {
    expect(slotRemoveRefusal("primary", true)).toBe("primary_has_fallback");
    expect(slotRemoveRefusal("primary", false)).toBeNull();
  });

  it("the fallback can always be removed", () => {
    expect(slotRemoveRefusal("fallback", true)).toBeNull();
    expect(slotRemoveRefusal("fallback", false)).toBeNull();
  });
});
