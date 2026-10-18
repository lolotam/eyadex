import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./use-debounced-value";

afterEach(() => vi.useRealTimers());

describe("useDebouncedValue", () => {
  it("settles about 300 ms after the last change, not on each keystroke", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: "" },
    });
    rerender({ v: "A" });
    act(() => void vi.advanceTimersByTime(200));
    rerender({ v: "AB" });
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current).toBe("");
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toBe("AB");
  });

  it("clears its timer on unmount", () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: "" },
    });
    rerender({ v: "x" });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
