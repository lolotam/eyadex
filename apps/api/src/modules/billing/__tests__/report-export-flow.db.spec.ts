import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { reportExportResponseSchema } from "@eyadex/contracts/finance-reports";
import { S3ReportExportFiles } from "../../../shared/blob/s3-report-export-files.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { closeHarness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import {
  issueReportInvoice,
  reportFixture,
  reportFreeLine,
  type ReportFixture,
} from "./report-fixtures.ts";

let f: ReportFixture;
let server: Server;
let worker: ChildProcess | undefined;
const objects = new Map<string, Buffer>();
const tags = new Map<string, string>();
let storage: Record<string, string>;

beforeAll(async () => {
  if (!process.env["EYADEX_TEST_DISPATCHER_URL"])
    throw new Error("EYADEX_TEST_DISPATCHER_URL is not set — the export flow needs a worker");
  server = createServer(async (req, res) => {
    if (!req.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ")) {
      res.writeHead(403).end();
      return;
    }
    if (new URL(req.url!, "http://storage.test").searchParams.has("versioning")) {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end('<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>');
      return;
    }
    const key = new URL(req.url!, "http://storage.test").pathname.replace(/^\/exports-test\//, "");
    if (req.method === "PUT") {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
      tags.set(key, String(req.headers["x-amz-tagging"]));
      res.writeHead(200).end();
    } else if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204).end();
    } else {
      const bytes = objects.get(key);
      res.writeHead(
        bytes === undefined ? 404 : 200,
        bytes === undefined
          ? {}
          : { "content-type": "application/octet-stream", "content-length": bytes.length },
      );
      res.end(req.method === "HEAD" ? undefined : bytes);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  storage = {
    FINANCE_EXPORT_BLOB_S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
    FINANCE_EXPORT_BLOB_S3_BUCKET: "exports-test",
    FINANCE_EXPORT_BLOB_S3_ACCESS_KEY: randomBytes(12).toString("hex"),
    FINANCE_EXPORT_BLOB_S3_SECRET_KEY: randomBytes(24).toString("hex"),
  };
  f = await reportFixture({
    maxQueuedPerClinic: 10,
    files: new S3ReportExportFiles({
      endpoint: new URL(storage["FINANCE_EXPORT_BLOB_S3_ENDPOINT"]!),
      bucket: "exports-test",
      region: "us-east-1",
      accessKey: storage["FINANCE_EXPORT_BLOB_S3_ACCESS_KEY"]!,
      secretKey: storage["FINANCE_EXPORT_BLOB_S3_SECRET_KEY"]!,
    }),
  });
}, 60_000);

afterAll(async () => {
  if (worker?.connected) worker.send("stop");
  if (worker && worker.exitCode === null)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        worker?.kill();
        resolve();
      }, 15_000);
      worker!.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  await closeHarness(f?.h);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

it("HTTP request -> committed outbox -> separate worker -> private tagged file -> authorized HTTP download; queued revocation fails", async () => {
  await issueReportInvoice(f, f.patientD, f.C.branchD, [reportFreeLine("12500")]);
  const roleId = await customRole(f.h, f.C.clinicId, [
    "view:report_takings:clinic",
    "view:payments:clinic",
  ]);
  const revoked = await memberOn(f.h, f.C.admin, roleId);
  const request = async (cookie: string, report: string) => {
    const response = await send(f.h, cookie, "POST", "/v1/finance-reports/exports", {
      report,
      from: "2026-01-01",
      to: "2026-12-31",
      format: "csv",
      language: "ar",
    });
    expect(response.statusCode, response.body).toBe(202);
    return reportExportResponseSchema.parse(response.json()).export.id;
  };
  const success = await request(f.C.admin.cookie, "period_summary");
  const denied = await request(revoked.cookie, "daily_takings");
  await f.h
    .owner`DELETE FROM role_permissions WHERE clinic_id = ${f.C.clinicId} AND role_id = ${roleId}`;
  // Put this test's two events first without touching other events or their outcomes.
  await f.h
    .owner`UPDATE outbox_events SET created_at = (SELECT min(created_at) - interval '1 second' FROM outbox_events)
    WHERE payload->>'exportId' IN (${success}, ${denied})`;
  worker = fork(
    fileURLToPath(
      new URL("../../../../../../docker/finance-export-worker-smoke.mjs", import.meta.url),
    ),
    [],
    {
      execArgv: ["--conditions=eyadex-runtime"],
      env: { ...process.env, ...storage, FINANCE_EXPORTS_ENABLED: "true" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("export worker did not start")), 10_000);
    worker!.once("error", reject);
    worker!.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`export worker exited ${code}`));
    });
    worker!.once("message", (message) => {
      clearTimeout(timer);
      if (message === "ready") resolve();
    });
  });
  const status = async (id: string, cookie: string) =>
    reportExportResponseSchema.parse(
      (await send(f.h, cookie, "GET", `/v1/finance-reports/exports/${id}`)).json(),
    ).export.status;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (
      (await status(success, f.C.admin.cookie)) === "done" &&
      (await status(denied, revoked.cookie)) === "failed"
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(await status(success, f.C.admin.cookie)).toBe("done");
  expect(await status(denied, revoked.cookie)).toBe("failed");
  const downloaded = await send(
    f.h,
    f.C.admin.cookie,
    "GET",
    `/v1/finance-reports/exports/${success}/download`,
  );
  expect(downloaded.statusCode, downloaded.body).toBe(200);
  expect(downloaded.body).toContain("12.500");
  expect(downloaded.body).toContain("الفترة");
  const key = `clinic/${f.C.clinicId}/finance-exports/${success}/1.csv`;
  expect(tags.get(key)).toBe("eyadex-kind=finance-export");
  expect([...objects.keys()].some((key) => key.includes(denied))).toBe(false);
  expect(
    (
      await send(
        f.h,
        f.other.admin.cookie,
        "GET",
        `/v1/finance-reports/exports/${success}/download`,
      )
    ).statusCode,
  ).toBe(404);
  const [failure] = await f.h
    .owner`SELECT error_code FROM finance_report_exports WHERE id = ${denied}`;
  expect(failure!["error_code"]).toBe("forbidden");
  const audits = await f.h
    .owner`SELECT details FROM audit_log WHERE entity_type = 'finance_report_export' AND entity_id = ${success}`;
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits)).not.toContain("patientName");
}, 60_000);
