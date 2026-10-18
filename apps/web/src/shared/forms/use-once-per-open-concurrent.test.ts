import { createElement, startTransition, Suspense, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOncePerOpen } from "./use-once-per-open";

// A read-only probe of the callback ref: a suspended render must not publish to shared state.
const probe = vi.hoisted(() => ({ callback: null as { current: () => void } | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useRef: <T>(initial: T) => {
      const ref = react.useRef(initial);
      if (typeof initial === "function") probe.callback = ref as { current: () => void };
      return ref;
    },
  };
});

afterEach(cleanup);

describe("useOncePerOpen during concurrent rendering", () => {
  it("publishes only committed initializers, leaving a suspended render's callback unpublished", async () => {
    const committed = vi.fn();
    const abandoned = vi.fn();
    const pending = new Promise<never>(() => undefined);
    let attempted = false;
    const { rerender } = renderHook(
      ({ init, suspend }) => {
        useOncePerOpen(null, init);
        if (suspend) {
          attempted = true;
          throw pending;
        }
      },
      {
        initialProps: { init: committed, suspend: false },
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(Suspense, { fallback: null }, children),
      },
    );
    await act(async () => {
      startTransition(() => rerender({ init: abandoned, suspend: true }));
    });
    expect(attempted).toBe(true);
    expect(probe.callback?.current).toBe(committed);
    expect(committed).not.toHaveBeenCalled();
    expect(abandoned).not.toHaveBeenCalled();
    rerender({ init: abandoned, suspend: false });
    expect(probe.callback?.current).toBe(abandoned);
  });
});
