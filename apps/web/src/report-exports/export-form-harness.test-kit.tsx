/* eslint-disable react-refresh/only-export-components -- a test kit, never hot-reloaded */
import { useState } from "react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ExportHistory } from "./export-history";
import { ExportRequestForm } from "./export-request-form";

export let setLang: (l: "ar" | "en") => void = () => undefined;
export let bump: () => void = () => undefined;
/** Renders fresh form elements on `bump`, so a changed session reaches the real hooks. */
export function Harness({ history }: { history: boolean }) {
  setLang = useI18n().setLang;
  const [, setTick] = useState(0);
  bump = () => setTick((n) => n + 1);
  return (
    <>
      <ExportRequestForm />
      {history ? <ExportHistory /> : null}
    </>
  );
}
