import { Link, Outlet } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { can } from "@/shared/permissions/can";
import { useAccountDisabledGuard } from "@/shared/persona/use-account-guard";
import { AppShell } from "./app-shell";
import { ForbiddenPage } from "./forbidden-page";
import { LoadingBlock } from "./loading-block";
import { CLINIC_NAV } from "./nav-items";
import { StatusPanel } from "./status-panel";
import { ExpiryBanner } from "./expiry-banner";

export function ClinicLayout() {
  const { t, pick } = useI18n();
  const { persona } = usePersona();
  const { session, isLoading } = useSession();
  useAccountDisabledGuard();

  if (persona.kind === "platform_admin") {
    return (
      <AppShell areaLabel="nav.clinicArea" items={[]}>
        <ForbiddenPage />
      </AppShell>
    );
  }

  const permissions = session?.permissions ?? [];
  const items = session?.blocked
    ? []
    : CLINIC_NAV.filter((i) => !i.resource || can(permissions, "view", i.resource));
  const subtitle = session?.clinic ? pick(session.clinic.nameAr, session.clinic.nameEn) : undefined;

  const signInLink = (
    <Button asChild variant="outline" size="sm">
      <Link to="/login">{t("blocked.toSignIn")}</Link>
    </Button>
  );
  let content = (
    <>
      {session?.expiresInDays != null && <ExpiryBanner days={session.expiresInDays} />}
      <Outlet />
    </>
  );
  if (isLoading || !session) content = <LoadingBlock />;
  else if (session.blocked === "suspended")
    content = (
      <StatusPanel
        icon={Lock}
        title={t("blocked.suspendedTitle")}
        body={t("blocked.suspendedBody")}
        action={signInLink}
      />
    );
  else if (session.blocked === "expired")
    content = (
      <StatusPanel
        icon={Lock}
        title={t("blocked.expiredTitle")}
        body={t("blocked.expiredBody")}
        action={signInLink}
      />
    );

  return (
    <AppShell areaLabel="nav.clinicArea" items={items} {...(subtitle ? { subtitle } : {})}>
      {content}
    </AppShell>
  );
}
