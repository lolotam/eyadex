import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Plus, ReceiptText } from "lucide-react";
import { formatMinor } from "@eyadex/contracts/money";
import { invoiceStatusSchema } from "@eyadex/contracts/finance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorCodeOf } from "@/shared/api/api-error";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { can } from "@/shared/permissions/can";
import { useSession } from "@/shared/persona/persona-provider";
import { PageHeader } from "@/shared/shell/page-header";
import { StatusPanel } from "@/shared/shell/status-panel";
import { CursorPager } from "@/shared/table/cursor-pager";
import { DataTable } from "@/shared/table/data-table";
import { FilterSelect } from "@/shared/table/filter-select";
import { useCursorPages } from "@/shared/table/use-cursor-pages";
import { useInvoiceOptions } from "./invoice-options";
import { InvoicePatientPicker } from "./invoice-patient-picker";
import { useInvoiceList } from "./invoice-queries";
import { useInvoiceColumns } from "./use-invoice-columns";

const PAGE_SIZE = 20;
const money = (minor: string, exponent: number, currency: string) =>
  `${formatMinor(minor, exponent)} ${currency}`;

/** The invoice list: one toolbar (branch, patient, status, dates, number), cursor pages. */
export function InvoicesContent() {
  const { t, tDynamic, pick } = useI18n();
  const { session } = useSession();
  const pages = useCursorPages();
  const options = useInvoiceOptions();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [patient, setPatient] = useState<{ id: string; label: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [number, setNumber] = useState("");
  const list = useInvoiceList({
    limit: PAGE_SIZE,
    ...(pages.cursor ? { cursor: pages.cursor } : {}),
    ...(branchId ? { branchId } : {}),
    ...(patient ? { patientId: patient.id } : {}),
    ...(status ? { status: invoiceStatusSchema.parse(status) } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(number.trim() ? { number: number.trim() } : {}),
  });
  const columns = useInvoiceColumns(options.branches, money);
  const filtered = (apply: () => void) => {
    apply();
    pages.reset();
  };
  const items = list.data?.items ?? [];
  return (
    <div>
      <PageHeader
        title={t("finance.list.title")}
        subtitle={t("finance.list.subtitle")}
        actions={
          can(session?.permissions ?? [], "create", "invoices") && (
            <Button asChild>
              <Link to="/clinic/invoices/new">
                <Plus className="size-4" />
                {t("finance.invoice.newManual")}
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6">
        <FilterSelect
          label={t("finance.list.branch")}
          value={branchId}
          anyLabel={t("finance.list.allBranches")}
          options={options.branches.map((b) => ({ value: b.id, label: pick(b.nameAr, b.nameEn) }))}
          onChange={(v) => filtered(() => setBranchId(v))}
        />
        <div className="lg:col-span-2">
          <InvoicePatientPicker value={patient} onChange={(p) => filtered(() => setPatient(p))} />
        </div>
        <FilterSelect
          label={t("finance.list.status")}
          value={status}
          anyLabel={t("finance.list.allStatuses")}
          options={invoiceStatusSchema.options.map((s) => ({
            value: s,
            label: t(`finance.status.${s}`),
          }))}
          onChange={(v) => filtered(() => setStatus(v))}
        />
        <Input
          type="date"
          value={from}
          aria-label={t("finance.list.from")}
          onChange={(e) => filtered(() => setFrom(e.target.value))}
        />
        <Input
          type="date"
          value={to}
          aria-label={t("finance.list.to")}
          onChange={(e) => filtered(() => setTo(e.target.value))}
        />
        <Input
          value={number}
          dir="ltr"
          maxLength={40}
          aria-label={t("finance.list.searchNumber")}
          placeholder={t("finance.list.searchNumber")}
          onChange={(e) => filtered(() => setNumber(e.target.value))}
        />
      </div>
      {list.isError ? (
        <StatusPanel
          icon={AlertCircle}
          title={t("finance.list.loadError")}
          body={tDynamic(`errors.${errorCodeOf(list.error)}`)}
          action={<Button onClick={() => void list.refetch()}>{t("common.tryAgain")}</Button>}
        />
      ) : !list.isLoading && items.length === 0 ? (
        <StatusPanel
          icon={ReceiptText}
          title={t("finance.list.empty")}
          body={t("finance.list.emptyBody")}
        />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <DataTable columns={columns} data={items} isLoading={list.isLoading} />
          </div>
        </div>
      )}
      <CursorPager
        count={items.length}
        total={list.data?.total ?? 0}
        canPrevious={pages.canPrevious}
        canNext={Boolean(list.data?.nextCursor)}
        onPrevious={pages.previous}
        onNext={() => pages.next(list.data?.nextCursor ?? null)}
      />
    </div>
  );
}
