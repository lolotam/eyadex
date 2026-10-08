import type { ReactNode } from "react";
import type { Area } from "@/shared/api/area-host";
import { usePersona } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "./loading-block";
import { WrongHostPage } from "./wrong-host-page";

/**
 * HTTP mode only (the mock passes straight through): an area's pages run on that area's host. Every
 * area page is served by the API since slice 11 (ADR-0020). Rendered around the area layout's content.
 */
export function HttpAreaGate({ area, children }: { area: Area; children: ReactNode }) {
  const { http } = usePersona();
  if (!http) return <>{children}</>;
  if (http.area === undefined) return <LoadingBlock />;
  if (http.area !== area) return <WrongHostPage area={area} />;
  return <>{children}</>;
}
