import type { ReactNode } from "react";
import { RequirePermission } from "@/shared/permissions/require-permission";
import { MedicinesContent } from "./medicines-content";

/**
 * `/clinic/settings/medicines` (P2-F2): `view:medicines:clinic` to read, `update` to change.
 * The route frames it in the Settings page shell: a business area never imports another (§1.1).
 */
export function MedicinesPage({ frame }: { frame: (content: ReactNode) => ReactNode }) {
  return <RequirePermission resource="medicines">{frame(<MedicinesContent />)}</RequirePermission>;
}
