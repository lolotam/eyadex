import { Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ForbiddenPage } from "@/shared/shell/forbidden-page";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { PageHeader } from "@/shared/shell/page-header";
import { errorCodeOf } from "@/shared/api/api-error";
import { ClinicBranchesTab } from "./clinic-branches-tab";
import { ClinicDetailsTab } from "./clinic-details-tab";
import { ClinicModulesTab } from "./clinic-modules-tab";
import { useClinic } from "./clinic-queries";
import { ClinicStatusBadge } from "./clinic-status-badge";
import { ClinicSubscriptionTab } from "./clinic-subscription-tab";
import { ClinicUsersTab } from "./clinic-users-tab";

export function ClinicPage({ clinicId }: { clinicId: string }) {
  const { t, pick } = useI18n();
  const clinic = useClinic(clinicId);

  if (clinic.isLoading) return <LoadingBlock />;
  if (clinic.error) {
    return errorCodeOf(clinic.error) === "forbidden" ? (
      <ForbiddenPage />
    ) : (
      <p className="py-16 text-center text-muted-foreground">{t("clinics.notFound")}</p>
    );
  }
  const data = clinic.data;
  if (!data) return null;

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ms-2">
        <Link to="/platform/clinics">
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t("nav.clinics")}
        </Link>
      </Button>
      <PageHeader
        title={pick(data.nameAr, data.nameEn)}
        subtitle={`${data.slug} · ${t(`specialty.${data.specialty}`)}`}
        actions={<ClinicStatusBadge status={data.status} />}
      />
      <p className="mb-5 flex items-center gap-2 rounded-md border border-primary/15 bg-secondary/60 px-3 py-2 text-xs text-secondary-foreground">
        <ShieldCheck className="size-4" />
        {t("clinics.privacyNote")}
      </p>
      <Tabs defaultValue="details">
        <TabsList className="mb-5 flex w-full flex-wrap justify-start overflow-x-auto">
          <TabsTrigger value="details">{t("clinics.tabs.details")}</TabsTrigger>
          <TabsTrigger value="subscription">{t("clinics.tabs.subscription")}</TabsTrigger>
          <TabsTrigger value="modules">{t("clinics.tabs.modules")}</TabsTrigger>
          <TabsTrigger value="users">{t("clinics.tabs.users")}</TabsTrigger>
          <TabsTrigger value="branches">{t("clinics.tabs.branches")}</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <ClinicDetailsTab clinic={data} />
        </TabsContent>
        <TabsContent value="subscription">
          <ClinicSubscriptionTab clinic={data} />
        </TabsContent>
        <TabsContent value="modules">
          <ClinicModulesTab clinic={data} />
        </TabsContent>
        <TabsContent value="users">
          <ClinicUsersTab clinicId={data.id} />
        </TabsContent>
        <TabsContent value="branches">
          <ClinicBranchesTab clinicId={data.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
