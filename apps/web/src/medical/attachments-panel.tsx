import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Archive, ExternalLink, FileText, Paperclip, Upload } from "lucide-react";
import { toast } from "sonner";
import { ATTACHMENT_TYPES, type Attachment } from "@eyadex/contracts/attachments";
import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ConfirmActionDialog } from "@/shared/shell/confirm-action-dialog";
import { LoadingBlock } from "@/shared/shell/loading-block";
import {
  medicalKeys,
  useAttachments,
  useClinicPersona,
  useRefreshMedical,
} from "./medical-queries";

type Props = { patientId: string; visitId: string | null; canUpload: boolean };

const sizeOf = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;

/** A file's attachments, or one visit's (P2-10): upload, open, archive — never delete. */
export function AttachmentsPanel({ patientId, visitId, canUpload }: Props) {
  const api = useApi();
  const { persona } = useClinicPersona();
  const { t, formatDate } = useI18n();
  const refresh = useRefreshMedical();
  const list = useAttachments(patientId, visitId ?? undefined);
  const input = useRef<HTMLInputElement>(null);
  const [archiving, setArchiving] = useState<Attachment | null>(null);
  const done = () => refresh([...medicalKeys.all, "attachments", patientId]);

  const upload = useMutation({
    mutationFn: (file: File) => api.medical.uploadAttachment(persona, patientId, file, visitId),
    onSuccess: () => {
      done();
      toast.success(t("attachments.uploaded"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  const archive = useMutation({
    mutationFn: (id: string) => api.medical.archiveAttachment(persona, id),
    onSuccess: () => {
      done();
      setArchiving(null);
      toast.success(t("attachments.archived"));
    },
    onError: (e) => toast.error(t(`errors.${errorCodeOf(e)}`)),
  });
  async function open(row: Attachment) {
    try {
      const blob = await api.medical.downloadAttachment(persona, row.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(t(`errors.${errorCodeOf(e)}`));
    }
  }

  const items = list.data?.items ?? [];
  return (
    <section className="max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {t(visitId ? "visit.attachments" : "attachments.title")}
        </h2>
        {canUpload && (
          <>
            <input
              ref={input}
              type="file"
              className="hidden"
              accept={ATTACHMENT_TYPES.join(",")}
              aria-label={t("attachments.upload")}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              disabled={upload.isPending}
              onClick={() => input.current?.click()}
            >
              <Upload className="size-4" />
              {t("attachments.upload")}
            </Button>
          </>
        )}
      </div>
      {canUpload && (
        <p className="mb-2 text-xs text-muted-foreground">{t("attachments.uploadHint")}</p>
      )}
      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <p className="text-sm text-destructive">{t("attachments.loadError")}</p>
      ) : items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          <Paperclip className="size-4" />
          {t("attachments.empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-40 flex-1">
                <p className="break-all font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("attachments.by", {
                    name: row.uploadedByName,
                    date: formatDate(row.uploadedAt),
                    size: sizeOf(row.sizeBytes),
                  })}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void open(row)}>
                <ExternalLink className="size-4" />
                {t("attachments.open")}
              </Button>
              {canUpload && (
                <Button variant="ghost" size="sm" onClick={() => setArchiving(row)}>
                  <Archive className="size-4" />
                  {t("attachments.archive")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmActionDialog
        open={archiving !== null}
        title={t("attachments.archiveTitle")}
        body={t("attachments.archiveBody")}
        confirmLabel={t("attachments.archive")}
        cancelLabel={t("common.cancel")}
        pending={archive.isPending}
        onConfirm={() => archiving && archive.mutate(archiving.id)}
        onClose={() => setArchiving(null)}
      />
    </section>
  );
}
