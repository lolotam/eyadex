import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import type { Area } from "@/shared/api/area-host";
import { usePersona } from "@/shared/persona/persona-provider";
import { ComingSoonPanel } from "./coming-soon-panel";
import { LoadingBlock } from "./loading-block";
import { comingSoonActionFor, isUnservedPath } from "./unserved-paths";
import { WrongHostPage } from "./wrong-host-page";

/**
 * HTTP mode only (the mock passes straight through): an area's pages run on that area's host, and
 * pages the API does not serve yet show "coming soon". Rendered around the area layout's content.
 */
export function HttpAreaGate({ area, children }: { area: Area; children: ReactNode }) {
  const { t } = useI18n();
  const { http } = usePersona();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!http) return <>{children}</>;
  if (http.area === undefined) return <LoadingBlock />;
  if (http.area !== area) return <WrongHostPage area={area} />;
  if (isUnservedPath(pathname)) {
    if (comingSoonActionFor(pathname) !== "createClinic") return <ComingSoonPanel />;
    return (
      <ComingSoonPanel
        action={
          <Button asChild>
            <Link to="/platform/clinics/new">
              <Plus className="size-4" />
              {t("clinics.new")}
            </Link>
          </Button>
        }
      />
    );
  }
  return <>{children}</>;
}
