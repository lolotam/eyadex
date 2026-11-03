import { use } from "react";

const never = new Promise<never>(() => {});

/** Never settles, so a transition that renders it is suspended and never committed. */
export function Suspender(): null {
  use(never);
  return null;
}
