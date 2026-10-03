import { ar, type MkDict } from "./ar";
import { en } from "./en";

export type MkLang = "ar" | "en";
export type { MkDict };
export const mkDicts: Record<MkLang, MkDict> = { ar, en };

export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/** "/" is Arabic, "/en" is English; any other path is an app route. */
export function marketingLang(pathname: string): MkLang | null {
  if (pathname === "/") return "ar";
  if (pathname === "/en" || pathname === "/en/") return "en";
  return null;
}
