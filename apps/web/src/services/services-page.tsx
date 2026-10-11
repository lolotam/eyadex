import type { ReactNode } from "react";
import { RequirePermission } from "@/shared/permissions/require-permission";
import { ServicesContent } from "./services-content";

/**
 * `/clinic/settings/services` (D-12, D-17).
 * The route frames it in the Settings page shell: a business area never imports another (§1.1).
 */
export function ServicesPage({ frame }: { frame: (content: ReactNode) => ReactNode }) {
  return <RequirePermission resource="services">{frame(<ServicesContent />)}</RequirePermission>;
}
