import type { ReactNode } from "react";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { ForbiddenPage } from "@/shared/shell/forbidden-page";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PricesOnlyServices } from "./prices-only-services";
import { ServicesContent } from "./services-content";
import { servicesScreenOf } from "./services-screen";

/**
 * `/clinic/settings/services` (D-12, D-17). `view:services` opens the full screen; `view:prices` alone
 * the prices-only one (item 8); neither is the "not allowed" page.
 * The route frames it in the Settings page shell: a business area never imports another (§1.1).
 */
export function ServicesPage({ frame }: { frame: (content: ReactNode) => ReactNode }) {
  const { session, isLoading } = useSession();
  if (isLoading || !session) return <LoadingBlock />;
  const screen = servicesScreenOf(session.permissions, can);
  if (screen === "none") return <ForbiddenPage />;
  return <>{frame(screen === "full" ? <ServicesContent /> : <PricesOnlyServices />)}</>;
}
