import { RequirePermission } from "@/shared/permissions/require-permission";
import { VisitContent } from "./visit-content";

/** `/clinic/visits/$visitId`: reload-safe from `getVisit` alone. */
export function VisitPage({ visitId }: { visitId: string }) {
  return (
    <RequirePermission resource="visits">
      <VisitContent visitId={visitId} />
    </RequirePermission>
  );
}
