import { Navigate } from "@tanstack/react-router";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { ForbiddenPage } from "@/shared/shell/forbidden-page";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { ClinicSettingsContent } from "./clinic-settings-content";
import { ClinicSettingsShell } from "./clinic-settings-shell";
import { firstSettingsTab } from "./settings-tabs";

/**
 * `/clinic/settings`: the General tab. The Settings menu entry shows to whoever can view any tab
 * (D-17), so a user who cannot view the clinic's own settings lands on the first tab they can see.
 */
export function ClinicSettingsPage() {
  const { session, isLoading } = useSession();
  if (isLoading || !session) return <LoadingBlock />;
  if (!can(session.permissions, "view", "clinic_settings")) {
    const first = firstSettingsTab(session.permissions);
    return first ? <Navigate to={first.to} replace /> : <ForbiddenPage />;
  }
  return (
    <ClinicSettingsShell active="general">
      <ClinicSettingsContent />
    </ClinicSettingsShell>
  );
}
