import { ExternalLink, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { areaOrigin, type Area } from "@/shared/api/area-host";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { StatusPanel } from "./status-panel";

/** HTTP mode: an area page opened on another area's host. Rendered after mount only. */
export function WrongHostPage({ area }: { area: Area }) {
  const { t } = useI18n();
  const href = `${areaOrigin(area, window.location)}${window.location.pathname}`;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <StatusPanel
        icon={MapPin}
        title={t("area.wrongHostTitle")}
        body={t(area === "clinic" ? "area.clinicBody" : "area.platformBody")}
        action={
          <Button asChild>
            <a href={href}>
              <ExternalLink aria-hidden />
              {t(area === "clinic" ? "area.goToClinic" : "area.goToPlatform")}
            </a>
          </Button>
        }
      />
    </div>
  );
}
