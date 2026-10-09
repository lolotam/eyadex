import { Link, Outlet } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { useAccountDisabledGuard } from "@/shared/persona/use-account-guard";
import { isSessionLoadFailure } from "@/shared/persona/session-readiness";
import { AppShell } from "./app-shell";
import { blockedReasonOf } from "./blocked-reason";
import { ForbiddenPage } from "./forbidden-page";
import { LoadingBlock } from "./loading-block";
import { CLINIC_NAV, navItemsFor } from "./nav-items";
import { StatusPanel } from "./status-panel";
import { ExpiryBanner } from "./expiry-banner";
import { HttpAreaGate } from "./http-area-gate";
import { SessionErrorPanel } from "./session-error-panel";
import { errorCodeOf } from "@/shared/api/api-error";

export function ClinicLayout() {
  const { t, pick } = useI18n();
  const { persona, http } = usePersona();
  const { session, isLoading, error } = useSession();
  useAccountDisabledGuard();

  if (http && http.area !== "clinic") return <HttpAreaGate area="clinic">{null}</HttpAreaGate>;
  if (!http && persona.kind === "platform_admin") {
    return (
      <AppShell areaLabel="nav.clinicArea" items={[]}>
        <ForbiddenPage />
      </AppShell>
    );
  }

  const permissions = session?.permissions ?? [];
  const items = session?.blocked ? [] : navItemsFor(CLINIC_NAV, permissions);
  const subtitle = session?.clinic ? pick(session.clinic.nameAr, session.clinic.nameEn) : undefined;

  const signInLink = (
    <Button asChild variant="outline" size="sm">
      <Link to="/login">{t("blocked.toSignIn")}</Link>
    </Button>
  );
  let content = (
    <>
      {session?.expiresInDays != null && <ExpiryBanner days={session.expiresInDays} />}
      <HttpAreaGate area="clinic">
        <Outlet />
      </HttpAreaGate>
    </>
  );
  if (errorCodeOf(error) === "subscription_blocked") {
    const suspended = blockedReasonOf(error) === "suspended";
    content = (
      <StatusPanel
        icon={Lock}
        title={t(suspended ? "blocked.suspendedTitle" : "blocked.expiredTitle")}
        body={t(suspended ? "blocked.suspendedBody" : "blocked.expiredBody")}
        action={signInLink}
      />
    );
  } else if (http && isSessionLoadFailure(http.error, http.session !== undefined))
    content = <SessionErrorPanel error={http.error} onRetry={http.retry} />;
  else if (isLoading || !session) content = <LoadingBlock />;
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
