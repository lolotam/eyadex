import { createContext, useContext } from "react";
import type { MkDict, MkLang } from "./i18n";

export type MkValue = { lang: MkLang; d: MkDict };
export const MkContext = createContext<MkValue | null>(null);

export function useMk(): MkValue {
  const v = useContext(MkContext);
  if (!v) throw new Error("useMk must be used inside MarketingPage");
  return v;
}
