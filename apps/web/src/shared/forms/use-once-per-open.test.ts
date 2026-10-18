import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useOncePerOpen } from "./use-once-per-open";

describe("useOncePerOpen", () => {
  it("initialises once per open; a re-render with new data does not reset", () => {
    const init = vi.fn();
    const { rerender } = renderHook(({ k, data }) => useOncePerOpen(k, () => init(data)), {
      initialProps: { k: "a" as string | null, data: 1 },
    });
    rerender({ k: "a", data: 2 });
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenLastCalledWith(1);
    rerender({ k: null, data: 2 });
    rerender({ k: "a", data: 3 });
    expect(init).toHaveBeenCalledTimes(2);
    expect(init).toHaveBeenLastCalledWith(3);
  });
});
