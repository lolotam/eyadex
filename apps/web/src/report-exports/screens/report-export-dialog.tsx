import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ExportRequestForm } from "../export-request-form";
import type { ExportFormDraft } from "../use-export-form";

/**
 * «تصدير هذا التقرير»: the reviewed export request form, prefilled with this report and the screen's
 * filters. The form judges the range against the export limit (1096 days), not the screen's 366.
 */
export function ReportExportDialog({ initial }: { initial: Partial<ExportFormDraft> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // A new prefill on each opening: the dialog body remounts with the filters of that moment.
  const [opening, setOpening] = useState(0);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        className="print:hidden"
        onClick={() => {
          setOpening((n) => n + 1);
          setOpen(true);
        }}
      >
        <Download className="size-4" aria-hidden />
        {t("financeReports.actions.export")}
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("financeReports.exportTitle")}</DialogTitle>
          <DialogDescription>{t("reportExports.request.subtitle")}</DialogDescription>
        </DialogHeader>
        {open ? <ExportRequestForm key={opening} initial={initial} /> : null}
      </DialogContent>
    </Dialog>
  );
}
