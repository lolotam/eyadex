import { useI18n } from "@/shared/i18n/i18n-provider";
import { formatReportMinor, reportLocale } from "./report-money";

/** One formatter per language for every number, amount and period on a report screen. */
export function useReportFormat(currency: string, exponent: number) {
  const { lang } = useI18n();
  const locale = reportLocale(lang);
  const numbers = new Intl.NumberFormat(locale);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const month = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return {
    money: (minor: string) => `${formatReportMinor(minor, exponent, lang)} ${currency}`,
    count: (value: number) => numbers.format(value),
    // A period is a clinic calendar day or month, so it is shown as written, never shifted by a zone.
    period: (value: string) =>
      value.length === 7
        ? month.format(new Date(`${value}-01T00:00:00Z`))
        : day.format(new Date(`${value}T00:00:00Z`)),
  };
}
