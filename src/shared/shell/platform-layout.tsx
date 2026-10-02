import { Outlet } from "@tanstack/react-router";
import { usePersona } from "@/shared/persona/persona-provider";
import { AppShell } from "./app-shell";
import { ForbiddenPage } from "./forbidden-page";
import { LoadingBlock } from "./loading-block";
import { PLATFORM_NAV } from "./nav-items";

export function PlatformLayout() {
  const { persona, ready } = usePersona();
  const allowed = persona.kind === "platform_admin";
  return (
    <AppShell areaLabel="nav.platformArea" items={allowed ? PLATFORM_NAV : []}>
      {!ready ? <LoadingBlock /> : allowed ? <Outlet /> : <ForbiddenPage />}
    </AppShell>
  );
}
