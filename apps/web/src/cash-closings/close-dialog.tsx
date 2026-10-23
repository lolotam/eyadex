import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import type { CreateCashClosingRequest } from "@eyadex/contracts/finance";
import type { BranchOption } from "@eyadex/contracts/users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { keyFor, type KeyedRequest } from "@/payments/idempotency-key";
import { errorKeyOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { LoadingBlock } from "@/shared/shell/loading-block";
import { FilterSelect } from "@/shared/table/filter-select";
import { countedMinorOf, differenceOf, needsNote } from "./closing-count";
import { ClosingDifference } from "./closing-difference";
import { ClosingPreviewSummary } from "./closing-preview-summary";
import { closingKeys, useClosingPreview } from "./closing-queries";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only the branches `create:cash_closings` reaches (closableBranches). */
  branches: readonly BranchOption[];
  /** `cash_closing_exists`: show the history filtered to that branch and day. */
  onShowClosed: (branchId: string, businessDate: string) => void;
};

/**
 * Close a branch drawer (spec §4.4): preview, count, a note when the count differs. `cash_drawer_changed`
 * refetches the preview and keeps the count and the note; nothing here edits or reopens a closing.
 */
export function CloseDialog({ open, onOpenChange, branches, onShowClosed }: Props) {
  const { t, tDynamic, pick } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState<string | null>(
    branches.length === 1 ? branches[0]!.id : null,
  );
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const held = useRef<KeyedRequest>(null);
  const preview = useClosingPreview(open ? branchId : null);
  const pv = preview.data;
  const countedMinor = pv ? countedMinorOf(counted, pv.currencyExponent) : null;
  const difference = pv && countedMinor !== null ? differenceOf(countedMinor, pv.expectedMinor) : null;
  const save = useMutation({
    mutationFn: (body: CreateCashClosingRequest) => {
      held.current = keyFor(held.current, JSON.stringify(body), () => crypto.randomUUID());
      return api.cashClosings.close(persona, body, held.current.key);
    },
    onSuccess: (closing) => {
      held.current = null;
      toast.success(t("cashClosings.dialog.done"));
      void queryClient.invalidateQueries({ queryKey: closingKeys.all });
      onOpenChange(false);
      onShowClosed(closing.branchId, closing.businessDate);
    },
    onError: (error) => {
      const code = errorKeyOf(error);
      setFailure(code);
      if (code === "cash_drawer_changed") void preview.refetch();
    },
  });
  const blocked =
    !pv || countedMinor === null || difference === null || needsNote(difference, note) || save.isPending;
  const submit = () => {
    if (!pv || countedMinor === null) return;
    setFailure(null);
    save.mutate({
      branchId: pv.branchId,
      previousClosingId: pv.previousClosingId,
      throughCashSeq: pv.throughCashSeq,
      countedMinor,
      note: note.trim() === "" ? null : note.trim(),
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("cashClosings.dialog.title")}</DialogTitle>
          <DialogDescription>{t("cashClosings.dialog.description")}</DialogDescription>
        </DialogHeader>
        {branches.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("cashClosings.dialog.noBranches")}</p>
        ) : (
          <div className="grid gap-4">
            <FilterSelect
              label={t("cashClosings.dialog.pickBranch")}
              value={branchId}
              options={branches.map((b) => ({ value: b.id, label: pick(b.nameAr, b.nameEn) }))}
              onChange={(v) => {
                setBranchId(v);
                setFailure(null);
                held.current = null;
              }}
            />
            {branchId === null ? null : preview.isError ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
                <span>
                  {t("cashClosings.dialog.previewError")} —{" "}
                  {tDynamic(`errors.${errorKeyOf(preview.error)}`)}
                </span>
                <Button size="sm" variant="outline" onClick={() => void preview.refetch()}>
                  {t("common.tryAgain")}
                </Button>
              </div>
            ) : !pv ? (
              <LoadingBlock />
            ) : (
              <>
                <ClosingPreviewSummary preview={pv} />
                <div className="grid gap-1.5">
                  <Label htmlFor="closing-counted">{t("cashClosings.dialog.counted")}</Label>
                  <Input
                    id="closing-counted"
                    inputMode="decimal"
                    dir="ltr"
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                    aria-invalid={counted !== "" && countedMinor === null}
                  />
                  {counted !== "" && countedMinor === null && (
                    <p className="text-xs text-destructive">
                      {t("cashClosings.dialog.countedInvalid")}
                    </p>
                  )}
                  {difference !== null && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{t("cashClosings.difference")}</span>
                      <ClosingDifference
                        differenceMinor={String(difference)}
                        exponent={pv.currencyExponent}
                        currency={pv.currency}
                      />
                    </div>
                  )}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="closing-note">{t("cashClosings.note")}</Label>
                  <Textarea
                    id="closing-note"
                    maxLength={300}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t("cashClosings.dialog.noteHint")}</p>
                </div>
              </>
            )}
            {failure && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
              >
                <AlertCircle className="size-4" />
                <span>
                  {failure === "cash_drawer_changed"
                    ? t("cashClosings.dialog.changed")
                    : tDynamic(`errors.${failure}`)}
                </span>
                {failure === "cash_closing_exists" && pv && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onOpenChange(false);
                      onShowClosed(pv.branchId, pv.businessDate);
                    }}
                  >
                    {t("cashClosings.dialog.showToday")}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={blocked} onClick={submit}>
            {t("cashClosings.dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
