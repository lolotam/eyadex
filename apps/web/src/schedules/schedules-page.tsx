import type { ReactNode } from "react";
import { RequirePermission } from "@/shared/permissions/require-permission";
import { SchedulesContent } from "./schedules-content";

/**
 * `/clinic/settings/schedules` (D-6, D-17).
 * The route frames it in the Settings page shell: a business area never imports another (§1.1).
 */
export function SchedulesPage({ frame }: { frame: (content: ReactNode) => ReactNode }) {
  return <RequirePermission resource="schedules">{frame(<SchedulesContent />)}</RequirePermission>;
}
