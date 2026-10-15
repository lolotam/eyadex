import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { ImageIcon, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { useClinicLogo, useRefreshFinanceSettings } from "./finance-queries";
import { isAcceptedLogo } from "./logo-file";

/** The clinic logo printed on invoices: preview and upload (PNG/JPEG, at most 1 MB). */
export function ClinicLogoCard({ hasLogo, editable }: { hasLogo: boolean; editable: boolean }) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const refresh = useRefreshFinanceSettings();
  const logo = useClinicLogo(hasLogo);
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => api.finance.uploadLogo(persona, file),
    onSuccess: () => {
      refresh();
      toast.success(t("finance.settings.logoSaved"));
    },
    onError: (e) => toast.error(tDynamic(`errors.${errorCodeOf(e)}`)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("finance.settings.logo")}</CardTitle>
        <CardDescription>{t("finance.settings.logoHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="flex size-24 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
          {logo.data ? (
            <img
              src={logo.data}
              alt={t("finance.settings.logo")}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-1 p-2 text-center text-xs text-muted-foreground">
              <ImageIcon className="size-5" />
              {t("finance.settings.noLogo")}
            </div>
          )}
        </div>
        {editable && (
          <>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              aria-label={t("finance.settings.uploadLogo")}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (!isAcceptedLogo(file)) toast.error(t("finance.settings.logoInvalid"));
                else upload.mutate(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={upload.isPending}
              onClick={() => input.current?.click()}
            >
              <Upload className="size-4" />
              {t("finance.settings.uploadLogo")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
