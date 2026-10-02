import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DirectionProvider } from "@radix-ui/react-direction";
import type { Language } from "@contracts/common";
import { ar } from "./ar";
import { en } from "./en";
import { lookup, type Dictionary, type TranslationKey } from "./dictionary";

const STORAGE_KEY = "eyadex:language";
const dictionaries: Record<Language, Dictionary> = { ar, en };

type Vars = Record<string, string | number>;
type I18nValue = {
  lang: Language;
  dir: "rtl" | "ltr";
  setLang: (lang: Language) => void;
  t: (key: TranslationKey, vars?: Vars) => string;
  /** Translate a dynamic key (e.g. a validation message key); returns the raw text if unknown. */
  tDynamic: (key: string) => string;
  pick: (nameAr: string, nameEn: string) => string;
  formatDate: (iso: string) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

/** manageDocument=false while a marketing route owns <html lang/dir>. */
export function I18nProvider({ children, manageDocument = true }: { children: ReactNode; manageDocument?: boolean }) {
  const [lang, setLangState] = useState<Language>("ar");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "ar" || stored === "en") setLangState(stored);
  }, []);

  useEffect(() => {
    if (!manageDocument) return;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang, manageDocument]);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = dictionaries[lang];
    const dateFormat = new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en-GB", { dateStyle: "medium" });
    return {
      lang,
      dir: lang === "ar" ? "rtl" : "ltr",
      setLang,
      t: (key, vars) => interpolate(lookup(dict, key) ?? key, vars),
      tDynamic: (key) => lookup(dict, key) ?? key,
      pick: (nameAr, nameEn) => (lang === "ar" ? nameAr : nameEn),
      formatDate: (iso) => dateFormat.format(new Date(iso)),
    };
  }, [lang, setLang]);

  return (
    <I18nContext.Provider value={value}>
      <DirectionProvider dir={value.dir}>{children}</DirectionProvider>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
