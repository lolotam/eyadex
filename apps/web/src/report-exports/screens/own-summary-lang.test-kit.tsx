/* eslint-disable react-refresh/only-export-components -- a test kit, never hot-reloaded */
import type { ReactNode } from "react";
import { useI18n } from "@/shared/i18n/i18n-provider";

export const lang = { set: (_l: "ar" | "en") => undefined as void };

/** Hands the provider's `setLang` to the test, so a screen can be switched to English. */
export function LangHandle({ children }: { children: ReactNode }) {
  lang.set = useI18n().setLang;
  return <>{children}</>;
}
