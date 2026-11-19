import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { FinanceTabs } from "@/shared/shell/finance-tabs";
import { PageHeader } from "@/shared/shell/page-header";
import { ReceiptsContent } from "./receipts-content";
import { RefundsContent } from "./refunds-content";
import "./payments-print.css";

type View = "receipts" | "refunds";

/**
 * «المدفوعات»: the receipts and the refunds, two lists of the same `view:payments` reach, switched in
 * page state (an in-page tab, unlike the finance strip above it, which is navigation).
 */
export function PaymentsContent() {
  const { t } = useI18n();
  const [view, setView] = useState<View>("receipts");
  return (
    <div data-payments-print>
      <PageHeader
        title={t("payments.receipts.title")}
        subtitle={t("payments.receipts.subtitle")}
        actions={
          <Button
            variant="outline"
            className="min-h-11 print:hidden sm:min-h-9"
            onClick={() => window.print()}
          >
            <Printer className="size-4" />
            {t("payments.print.action")}
          </Button>
        }
      />
      <div className="print:hidden">
        <FinanceTabs active="payments" />
      </div>
      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList aria-label={t("payments.views.label")} className="mb-4 print:hidden">
          <TabsTrigger value="receipts">{t("payments.views.receipts")}</TabsTrigger>
          <TabsTrigger value="refunds">{t("payments.views.refunds")}</TabsTrigger>
        </TabsList>
      </Tabs>
      {view === "receipts" ? <ReceiptsContent /> : <RefundsContent />}
    </div>
  );
}
