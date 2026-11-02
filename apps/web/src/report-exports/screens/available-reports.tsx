import { Link } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { availableScreens } from "./report-catalogue";

/** «التقارير المتاحة»: one card per built report the caller's permissions open; none, no section. */
export function AvailableReports() {
  const { t } = useI18n();
  const { session } = useSession();
  const reports = availableScreens(session?.permissions ?? []);
  if (reports.length === 0) return null;
  return (
    <section aria-labelledby="available-reports" className="flex flex-col gap-3">
      <header>
        <h2 id="available-reports" className="text-base font-semibold">
          {t("financeReports.available.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("financeReports.available.subtitle")}</p>
      </header>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {reports.map((report) => (
          <li key={report}>
            <Link
              to="/clinic/reports/$reportId"
              params={{ reportId: report }}
              className="flex h-full flex-col gap-1 rounded-md border bg-card p-4 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center gap-2 font-medium">
                <BarChart3 className="size-4 text-primary" aria-hidden />
                {t(`financeReports.names.${report}`)}
              </span>
              <span className="text-sm text-muted-foreground">
                {t(`financeReports.descriptions.${report}`)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
