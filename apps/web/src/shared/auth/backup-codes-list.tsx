import { useI18n } from "@/shared/i18n/i18n-provider";

/** Shown once, during enrolment: the recovery codes for a lost authenticator. Never stored. */
export function BackupCodesList({ codes }: { codes: readonly string[] }) {
  const { t } = useI18n();
  return (
    <div className="flex w-full flex-col gap-2 rounded-md border border-border p-3">
      <p className="text-sm font-medium">{t("auth.backupCodesTitle")}</p>
      <p className="text-xs text-muted-foreground">{t("auth.backupCodesBody")}</p>
      <ul dir="ltr" className="grid grid-cols-2 gap-1 font-mono text-xs">
        {codes.map((code) => (
          <li key={code} className="rounded-sm bg-muted px-2 py-1 text-center">
            {code}
          </li>
        ))}
      </ul>
    </div>
  );
}
