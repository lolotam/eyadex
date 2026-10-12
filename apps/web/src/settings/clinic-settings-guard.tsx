import type { ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { ForbiddenPage } from "@/shared/shell/forbidden-page";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { ClinicSettingsShell } from "./clinic-settings-shell";
import { firstSettingsTab, type SettingsTabId } from "./settings-tabs";

/** A Settings tab behind `view:clinic_settings:clinic`; anyone else lands on a tab they can see. */
export function ClinicSettingsGuard({
  active,
  children,
}: {
  active: SettingsTabId;
  children: ReactNode;
}) {
  const { session, isLoading } = useSession();
  if (isLoading || !session) return <LoadingBlock />;
  if (!can(session.permissions, "view", "clinic_settings")) {
    const first = firstSettingsTab(session.permissions);
    return first ? <Navigate to={first.to} replace /> : <ForbiddenPage />;
  }
  return <ClinicSettingsShell active={active}>{children}</ClinicSettingsShell>;
}
