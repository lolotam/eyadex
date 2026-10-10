import type { PrescriptionPrint } from "@eyadex/contracts/visits";
import { useI18n } from "@/shared/i18n/i18n-provider";

/**
 * The printable prescription: clinic names in both languages, branch, patient name and file
 * number, provider, the signing date (or the start while still a draft), the items. Direction
 * follows the UI language, so Arabic prints right to left.
 */
export function PrescriptionPrintView({
  data,
  timeZone,
}: {
  data: PrescriptionPrint;
  timeZone: string;
}) {
  const { t, pick, lang } = useI18n();
  const date = new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en-GB", {
    dateStyle: "long",
    timeZone,
  }).format(new Date(data.signedAt ?? data.startedAt));
  const rows: [string, string][] = [
    [t("printView.patient"), data.patient.fullName],
    [t("printView.fileNumber"), String(data.patient.fileNumber)],
    [t("printView.provider"), data.providerName],
    [t("printView.branch"), pick(data.branch.nameAr, data.branch.nameEn)],
    [t("printView.date"), date],
  ];
  return (
    <article dir={lang === "ar" ? "rtl" : "ltr"} className="prescription-print text-sm">
      <header className="mb-4 border-b pb-3 text-center">
        <p className="text-lg font-semibold" dir="rtl">
          {data.clinic.nameAr}
        </p>
        <p className="font-medium" dir="ltr">
          {data.clinic.nameEn}
        </p>
        <h2 className="mt-2 text-base font-semibold">{t("printView.title")}</h2>
      </header>
      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="text-muted-foreground">{label}:</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {data.items.length === 0 ? (
        <p className="text-muted-foreground">{t("printView.empty")}</p>
      ) : (
        <ol className="list-inside list-decimal space-y-2">
          {data.items.map((item) => (
            <li key={item.position}>
              <span className="font-semibold">{item.medicine}</span>
              <span className="text-muted-foreground">
                {" — "}
                {[item.dose, item.frequency, item.duration].filter(Boolean).join(" · ")}
              </span>
              {item.note && <p className="ps-5 text-xs text-muted-foreground">{item.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
