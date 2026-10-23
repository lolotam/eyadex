import { useState } from "react";
import { AlertCircle, Undo2 } from "lucide-react";
import { paymentMethodSchema } from "@eyadex/contracts/finance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKeyOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { StatusPanel } from "@/shared/shell/status-panel";
import { CursorPager } from "@/shared/table/cursor-pager";
import { DataTable } from "@/shared/table/data-table";
import { FilterSelect } from "@/shared/table/filter-select";
import { useCursorPages } from "@/shared/table/use-cursor-pages";
import { ReceiptPatientPicker } from "./receipt-patient-picker";
import { useReceiptBranches, useRefundList } from "./receipt-queries";
import { useRefundColumns } from "./use-refund-columns";

const PAGE_SIZE = 20;

/** The refunds list: branch, method, dates, patient (with `view:patients` only); no number search. */
export function RefundsContent() {
  const { t, tDynamic, pick } = useI18n();
  const { session } = useSession();
  const pages = useCursorPages();
  const branches = useReceiptBranches();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [patient, setPatient] = useState<{ id: string; label: string } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const seesPatients = can(session?.permissions ?? [], "view", "patients");
  // A key lost mid-session drops the hidden patient choice, as on the receipts list.
  if (!seesPatients && patient) {
    setPatient(null);
    pages.reset();
  }
  const list = useRefundList({
    limit: PAGE_SIZE,
    ...(pages.cursor ? { cursor: pages.cursor } : {}),
    ...(branchId ? { branchId } : {}),
    ...(method ? { method: paymentMethodSchema.parse(method) } : {}),
    ...(seesPatients && patient ? { patientId: patient.id } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const columns = useRefundColumns(branches.data);
  const filtered = (apply: () => void) => {
    apply();
    pages.reset();
  };
  const items = list.data?.items ?? [];
  return (
    <div>
      <div className="mb-4 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-5">
        <FilterSelect
          label={t("payments.receipts.branch")}
          value={branchId}
          anyLabel={t("payments.receipts.allBranches")}
          options={(branches.data ?? []).map((b) => ({
            value: b.id,
            label: pick(b.nameAr, b.nameEn),
          }))}
          onChange={(v) => filtered(() => setBranchId(v))}
        />
        <FilterSelect
          label={t("payments.receipts.method")}
          value={method}
          anyLabel={t("payments.receipts.allMethods")}
          options={paymentMethodSchema.options.map((m) => ({
            value: m,
            label: t(`payments.method.${m}`),
          }))}
          onChange={(v) => filtered(() => setMethod(v))}
        />
        {seesPatients && (
          <ReceiptPatientPicker value={patient} onChange={(p) => filtered(() => setPatient(p))} />
        )}
        <Input
          type="date"
          value={from}
          aria-label={t("payments.receipts.from")}
          onChange={(e) => filtered(() => setFrom(e.target.value))}
        />
        <Input
          type="date"
          value={to}
          aria-label={t("payments.receipts.to")}
          onChange={(e) => filtered(() => setTo(e.target.value))}
        />
      </div>
      {branches.isError && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
          <span>{t("payments.receipts.branchesError")}</span>
          <Button size="sm" variant="outline" onClick={() => void branches.refetch()}>
            {t("common.tryAgain")}
          </Button>
        </div>
      )}
      {list.isError ? (
        <StatusPanel
          icon={AlertCircle}
          title={t("payments.refunds.loadError")}
          body={tDynamic(`errors.${errorKeyOf(list.error)}`)}
          action={<Button onClick={() => void list.refetch()}>{t("common.tryAgain")}</Button>}
        />
      ) : !list.isLoading && items.length === 0 ? (
        <StatusPanel
          icon={Undo2}
          title={t("payments.refunds.empty")}
          body={t("payments.refunds.emptyBody")}
        />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <DataTable columns={columns} data={items} isLoading={list.isLoading} />
          </div>
        </div>
      )}
      <CursorPager
        count={items.length}
        total={list.data?.total ?? 0}
        canPrevious={!list.isPlaceholderData && pages.canPrevious}
        canNext={!list.isPlaceholderData && Boolean(list.data?.nextCursor)}
        onPrevious={pages.previous}
        onNext={() => pages.next(list.data?.nextCursor ?? null)}
      />
    </div>
  );
}
