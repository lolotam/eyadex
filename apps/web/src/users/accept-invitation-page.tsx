import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { CircleCheck, Hourglass, XCircle } from "lucide-react";
import {
  acceptInvitationInputSchema,
  type AcceptInvitationInput,
  type InvitationStatus,
} from "@eyadex/contracts/invitations";
import { personaKindSchema } from "@eyadex/contracts/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { useApi } from "@/shared/api/api-provider";
import { acceptErrorMessage } from "./accept-error-message";
import { TextField } from "@/shared/forms/form-fields";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { LanguageSwitch } from "@/shared/i18n/language-switch";
import { usePersona } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { StatusPanel } from "@/shared/shell/status-panel";

const INVALID_BODY = {
  expired: "invite.expiredBody",
  cancelled: "invite.cancelledBody",
  accepted: "invite.usedBody",
} as const;

export function AcceptInvitationPage() {
  const { token } = useParams({ from: "/invite/$token" });
  const api = useApi();
  const { t, pick } = useI18n();
  const { setPersona } = usePersona();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const preview = useQuery({
    queryKey: ["invitation-preview", token],
    queryFn: () => api.invitations.preview(token),
    retry: false,
  });
  const form = useForm<AcceptInvitationInput>({
    resolver: zodResolver(acceptInvitationInputSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const accept = useMutation({
    mutationFn: (input: AcceptInvitationInput) => api.invitations.accept(token, input),
    onSuccess: () => void preview.refetch(),
  });

  function signIn() {
    const done = accept.data;
    if (!done) return;
    const kind = personaKindSchema.safeParse(done.roleKey);
    setPersona({
      // A clinic-created role has no system key: it signs in as "custom", pinned to this account.
      kind: kind.success ? kind.data : "custom",
      clinicId: done.clinicId,
      memberId: done.memberId,
    });
    void queryClient.invalidateQueries({ queryKey: ["session"] });
    void navigate({ to: "/clinic" });
  }

  const signInLink = (
    <Button asChild variant="outline">
      <Link to="/login">{t("invite.toSignIn")}</Link>
    </Button>
  );

  let content;
  if (preview.isLoading) content = <LoadingBlock />;
  else if (accept.isSuccess)
    content = (
      <StatusPanel
        icon={CircleCheck}
        title={t("invite.acceptedTitle")}
        body={t("invite.acceptedBody")}
        action={<Button onClick={signIn}>{t("invite.signInAsMe")}</Button>}
      />
    );
  else if (!preview.data || preview.data.status !== "pending") {
    const status: InvitationStatus | null = preview.data?.status ?? null;
    content = (
      <StatusPanel
        icon={status === "expired" ? Hourglass : XCircle}
        title={t("invite.invalidTitle")}
        body={t(status && status !== "pending" ? INVALID_BODY[status] : "invite.notFoundBody")}
        action={signInLink}
      />
    );
  } else {
    const p = preview.data;
    content = (
      <Card className="w-full max-w-md">
        <CardHeader className="text-start">
          <CardTitle className="text-xl">
            {t("invite.title", { clinic: pick(p.clinicNameAr, p.clinicNameEn) })}
          </CardTitle>
          <CardDescription>
            {t("invite.body", { role: pick(p.roleNameAr, p.roleNameEn) })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border bg-muted/40 p-3 text-sm">
            <dt className="text-muted-foreground">{t("users.fields.fullName")}</dt>
            <dd>{p.fullName}</dd>
            <dt className="text-muted-foreground">{t("users.fields.email")}</dt>
            <dd dir="ltr" className="text-start">
              {p.email}
            </dd>
            <dt className="text-muted-foreground">{t("invite.invitedAs")}</dt>
            <dd>{pick(p.roleNameAr, p.roleNameEn)}</dd>
          </dl>
          <Form {...form}>
            <form
              className="flex flex-col gap-4"
              onSubmit={form.handleSubmit((values) => accept.mutate(values))}
            >
              <TextField
                control={form.control}
                name="password"
                type="password"
                dir="ltr"
                label={t("invite.password")}
              />
              <TextField
                control={form.control}
                name="confirmPassword"
                type="password"
                dir="ltr"
                label={t("invite.confirmPassword")}
              />
              {accept.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {acceptErrorMessage(t, accept.error)}
                </p>
              )}
              <Button type="submit" disabled={accept.isPending}>
                {t("invite.accept")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("invite.mockNote")}</p>
            </form>
          </Form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex justify-end p-4">
        <LanguageSwitch />
      </div>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center">
        {content}
      </main>
    </div>
  );
}
