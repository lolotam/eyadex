import { owner } from "./pdf-job-fixtures.ts";

const kinds = ["claim", "recovery", "heartbeat", "failure"] as const;
type WriteBlock = (typeof kinds)[number];

const conditions: Record<WriteBlock, string> = {
  claim: "NEW.status='running' AND OLD.status<>'running'",
  recovery: "OLD.status='running' AND NEW.status IN ('retry_wait','failed','cancelled')",
  heartbeat:
    "OLD.status='running' AND NEW.status='running' AND NEW.lease_until IS DISTINCT FROM OLD.lease_until",
  failure: "OLD.status='running' AND NEW.status IN ('retry_wait','failed','cancelled')",
};

export function installWriteBlock(kind: WriteBlock, mode: "miss" | "error" = "miss"): void {
  const action = mode === "miss" ? "RETURN NULL" : `RAISE EXCEPTION 'pdf_test_${kind}_error'`;
  owner(`CREATE OR REPLACE FUNCTION p4a_test_${kind}_block() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF ${conditions[kind]} THEN ${action}; END IF; RETURN NEW; END $$;
    DROP TRIGGER IF EXISTS p4a_test_${kind}_block ON invoice_pdf_jobs;
    CREATE TRIGGER p4a_test_${kind}_block BEFORE UPDATE ON invoice_pdf_jobs
      FOR EACH ROW EXECUTE FUNCTION p4a_test_${kind}_block()`);
}

export function clearWriteBlocks(): void {
  for (const kind of kinds) {
    owner(`DROP TRIGGER IF EXISTS p4a_test_${kind}_block ON invoice_pdf_jobs;
      DROP FUNCTION IF EXISTS p4a_test_${kind}_block()`);
  }
}
