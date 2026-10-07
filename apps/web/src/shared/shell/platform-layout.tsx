import { Outlet } from "@tanstack/react-router";
import { usePersona } from "@/shared/persona/persona-provider";
import { useAccountDisabledGuard } from "@/shared/persona/use-account-guard";
import { AppShell } from "./app-shell";
import { ForbiddenPage } from "./forbidden-page";
import { HttpAreaGate } from "./http-area-gate";
import { LoadingBlock } from "./loading-block";
import { PLATFORM_NAV } from "./nav-items";

export function PlatformLayout() {
  const { persona, ready, http } = usePersona();
  useAccountDisabledGuard();
  if (http && http.area !== "platform") return <HttpAreaGate area="platform">{null}</HttpAreaGate>;
  const allowed = persona.kind === "platform_admin";
  return (
    <AppShell areaLabel="nav.platformArea" items={allowed ? PLATFORM_NAV : []}>
      {!ready ? (
        <LoadingBlock />
      ) : allowed ? (
        <HttpAreaGate area="platform">
          <Outlet />
        </HttpAreaGate>
      ) : (
        <ForbiddenPage />
      )}
    </AppShell>
  );
}
