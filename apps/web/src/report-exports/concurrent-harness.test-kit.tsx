import { startTransition, Suspense, useState } from "react";
import type { ReportExport } from "@eyadex/contracts/finance-reports";
import { Consumer } from "./concurrent-consumer.test-kit";
import { Suspender } from "./concurrent-suspender.test-kit";
import { controls, Identity, type Who } from "./use-export-download-concurrent.state.test-kit";

export function Harness({ first, rows }: { first: Who; rows: ReportExport[] }) {
  const [who, setWho] = useState(first);
  controls.switchTo = (next) => startTransition(() => setWho(next));
  return (
    <Identity.Provider value={who}>
      <Suspense fallback={null}>
        <Consumer rows={rows} />
        {who === first ? null : <Suspender />}
      </Suspense>
    </Identity.Provider>
  );
}
