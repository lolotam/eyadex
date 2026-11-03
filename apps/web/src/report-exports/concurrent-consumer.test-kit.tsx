import { useLayoutEffect } from "react";
import type { ReportExport } from "@eyadex/contracts/finance-reports";
import { useExportDownload } from "./use-export-download";
import { handle } from "./use-export-download-concurrent.state.test-kit";

export function Consumer({ rows }: { rows: ReportExport[] }) {
  const result = useExportDownload(rows, () => undefined);
  useLayoutEffect(() => {
    handle.current = result;
  });
  return null;
}
