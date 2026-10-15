import { describe, expect, it } from "vitest";
import { isAcceptedLogo, MAX_LOGO_BYTES } from "./logo-file";

describe("clinic logo file (F1 §2)", () => {
  it("accepts only PNG or JPEG logos of at most 1 MB", () => {
    expect(isAcceptedLogo({ type: "image/png", size: MAX_LOGO_BYTES })).toBe(true);
    expect(isAcceptedLogo({ type: "image/jpeg", size: 10 })).toBe(true);
    expect(isAcceptedLogo({ type: "image/png", size: MAX_LOGO_BYTES + 1 })).toBe(false);
    expect(isAcceptedLogo({ type: "image/gif", size: 10 })).toBe(false);
  });
});
