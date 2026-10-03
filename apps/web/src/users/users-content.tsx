import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { InvitationsTab } from "./invitations-tab";
import { InviteUserDialog } from "./invite-user-dialog";
import { useUserUsage } from "./user-queries";
import { UsersTab } from "./users-tab";

export function UsersContent() {
  const { t } = useI18n();
  const { session } = useSession();
  const usage = useUserUsage();
  const [inviteOpen, setInviteOpen] = useState(false);
  const mayCreate = can(session?.permissions ?? [], "create", "users");
  const atLimit = usage.data ? usage.data.used >= usage.data.limit : false;

  return (
    <div>
      <PageHeader
        title={t("users.title")}
        subtitle={t("users.subtitle")}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="rounded-md border bg-card px-3 py-2 text-sm font-medium">
              {t("users.usage", { used: usage.data?.used ?? 0, limit: usage.data?.limit ?? 0 })}
            </span>
            {mayCreate && (
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-4" />
                {t("users.invite")}
              </Button>
            )}
          </div>
        }
      />
      {mayCreate && atLimit && usage.data && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {t("users.limitReached", usage.data)}
        </p>
      )}
      <Tabs defaultValue="users">
        <TabsList className="mb-4 w-full justify-start">
          <TabsTrigger value="users">{t("users.tabs.users")}</TabsTrigger>
          <TabsTrigger value="invitations">{t("users.tabs.invitations")}</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="invitations">
          <InvitationsTab />
        </TabsContent>
      </Tabs>
      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
