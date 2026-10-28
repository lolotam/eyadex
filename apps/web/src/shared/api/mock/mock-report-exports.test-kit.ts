import type { ReportExportRequest } from "@eyadex/contracts/finance-reports";
import { fixture, invoice, payment, makeOwn, NOW } from "./mock-report-export.test-kit";
import { personaWith } from "./mock-report-test-kit";
import { exportJobsOf } from "./mock-report-export-state";
import { createMockReportExports } from "./mock-report-exports";
import { EXPORT_STEP_MS } from "./mock-report-export-run";

export function setup(own = false) {
  const f = fixture();
  f.db.appointments = [];
  f.db.medical.visits = [];
  const persona = personaWith(
    own ? ["view:report_own:own", "view:invoices:own"] : ["view:report_takings:branch", "view:payments:branch"],
    [f.a.id, f.b.id],
  );
  const member = f.db.members.find((m) => m.id === persona.memberId);
  const role = f.db.roles.find((r) => r.id === member?.roleId);
  if (!member || !role) throw new Error("Missing actor");
  makeOwn(f, f.patient.id);
  const appointment = f.db.appointments.at(-1);
  if (!appointment) throw new Error("Missing appointment");
  appointment.providerMembershipId = member.id;
  const inv = invoice(f, 1);
  for (const line of inv.lines) line.providerId = member.id;
  payment(f, 1, inv);
  let time = NOW.getTime();
  const clock = () => new Date(time);
  const api = createMockReportExports(clock);
  const body: ReportExportRequest = {
    report: own ? "own_summary" : "daily_takings", format: "csv", language: "en",
    from: "2026-01-01", to: "2026-12-31",
  };
  const tick = (ms = EXPORT_STEP_MS) => { time += ms; };
  const request = async (changes: Partial<ReportExportRequest> = {}) => {
    const response = await api.requestExport(persona, { ...body, ...changes });
    const job = exportJobsOf(f.db).find((j) => j.id === response.export.id);
    if (!job) throw new Error("Missing admitted job");
    return job;
  };
  const finish = async (changes: Partial<ReportExportRequest> = {}) => {
    const job = await request(changes);
    tick();
    await api.getExport(persona, job.id);
    tick();
    await api.getExport(persona, job.id);
    return job;
  };
  return { ...f, persona, member, role, appointment, inv, clock, api, body, tick, request, finish };
}

/** jsdom Blob uses FileReader; do not modify global Blob or install a polyfill. */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) return reject(new Error("Missing bytes"));
      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(blob);
  });
}
