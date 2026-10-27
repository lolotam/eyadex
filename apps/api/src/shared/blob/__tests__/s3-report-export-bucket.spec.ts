import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3ReportExportFiles } from "../s3-report-export-files.ts";

let server: Server;
let store: S3ReportExportFiles;
let status = 200;
let versioning: string | undefined;
const paths: string[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    paths.push(req.url!);
    res.writeHead(status, { "content-type": "application/xml" });
    res.end(
      `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${versioning === undefined ? "" : `<Status>${versioning}</Status>`}</VersioningConfiguration>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  store = new S3ReportExportFiles({
    endpoint: new URL(`http://127.0.0.1:${address.port}`),
    bucket: "exports-test",
    region: "us-east-1",
    accessKey: randomBytes(12).toString("hex"),
    secretKey: randomBytes(24).toString("hex"),
  });
});
afterAll(async () => {
  store.onApplicationShutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("export bucket startup gate", () => {
  it("accepts never-versioned metadata using only GetBucketVersioning", async () => {
    await expect(store.onModuleInit()).resolves.toBeUndefined();
    expect(paths.at(-1)).toContain("versioning");
    expect(paths.every((path) => !path.includes("list-type"))).toBe(true);
  });
  it.each(["Enabled", "Suspended"])("refuses %s before exposing routes", async (value) => {
    versioning = value;
    await expect(store.onModuleInit()).rejects.toThrow("FINANCE_EXPORT_BLOB_S3_BUCKET");
  });
  it("refuses inaccessible metadata without reporting credentials or endpoint", async () => {
    status = 403;
    await expect(store.onModuleInit()).rejects.toThrow("FINANCE_EXPORT_BLOB_S3_BUCKET");
  });
});
