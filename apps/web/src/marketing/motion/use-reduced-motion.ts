import { useMedia } from "./use-media";

export function useReducedMotion(): boolean {
  return useMedia("(prefers-reduced-motion: reduce)");
}
