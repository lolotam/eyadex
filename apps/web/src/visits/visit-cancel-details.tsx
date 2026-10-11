import type { VisitCancelReason } from "@eyadex/contracts/visits";
import { useI18n } from "@/shared/i18n/i18n-provider";

/**
 * Why a draft was cancelled: the reason is metadata (every visit reader sees it), the free note is
 * clinical text that arrives only with the content, so it is shown only when present.
 */
export function VisitCancelDetails({
  reason,
  note,
}: {
  reason: VisitCancelReason;
  note: string | null;
}) {
  const { t } = useI18n();
  return (
    <dl className="mb-4 grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
      <dt className="text-muted-foreground">{t("visit.cancelReason")}</dt>
      <dd>{t(`visit.cancelReasons.${reason}`)}</dd>
      {note !== null && (
        <>
          <dt className="text-muted-foreground">{t("visit.cancelNote")}</dt>
          <dd className="whitespace-pre-wrap break-words">{note}</dd>
        </>
      )}
    </dl>
  );
}
