import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3ExportBlobs } from "./s3-export-blobs.ts";

let server: Server;
let store: S3ExportBlobs;
let status = 200;
let versioning: string | undefined;
const requests: { method: string; path: string; tag: string | undefined; bytes: Buffer }[] = [];
const key = `clinic/${randomUUID()}/finance-exports/${randomUUID()}/1.csv`;
beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (new URL(req.url!, "http://storage.test").searchParams.has("versioning")) {
      res.writeHead(status, { "content-type": "application/xml" });
      res.end(
        `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${versioning === undefined ? "" : `<Status>${versioning}</Status>`}</VersioningConfiguration>`,
      );
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({
      method: req.method!,
      path: req.url!,
      tag: req.headers["x-amz-tagging"] as string | undefined,
      bytes: Buffer.concat(chunks),
    });
    res.writeHead(status);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  store = new S3ExportBlobs({
    endpoint: `http://127.0.0.1:${address.port}`,
    bucket: "exports-test",
    region: "us-east-1",
    accessKey: randomBytes(12).toString("hex"),
    secretKey: randomBytes(24).toString("hex"),
  });
});
afterAll(async () => {
  store.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("export-only S3 transport", () => {
  it("accepts a never-versioned bucket without bucket listing", async () => {
    status = 200;
    versioning = undefined;
    await expect(store.verifyBucket()).resolves.toBeUndefined();
  });
  it.each(["Enabled", "Suspended"])("refuses %s versioning before claiming jobs", async (value) => {
    status = 200;
    versioning = value;
    await expect(store.verifyBucket()).rejects.toThrow("FINANCE_EXPORT_BLOB_S3_BUCKET");
  });
  it("fails closed when bucket metadata is denied", async () => {
    status = 403;
    await expect(store.verifyBucket()).rejects.toThrow("FINANCE_EXPORT_BLOB_S3_BUCKET");
  });
  it("uploads with the lifecycle tag in the actual signed HTTP request", async () => {
    status = 200;
    await store.put(key, Buffer.from("sample"), new AbortController().signal);
    expect(requests.at(-1)).toMatchObject({
      method: "PUT",
      tag: "eyadex-kind=finance-export",
      bytes: Buffer.from("sample"),
    });
    expect(requests.at(-1)?.path).toContain(`/exports-test/${key}`);
  });
  it("deletes idempotently and stats one key without listing", async () => {
    status = 204;
    await store.delete(key);
    expect(requests.at(-1)?.method).toBe("DELETE");
    status = 200;
    expect(await store.exists(key)).toBe(true);
    expect(requests.at(-1)?.method).toBe("HEAD");
    status = 404;
    expect(await store.exists(key)).toBe(false);
    await store.delete(key);
  });
  it("refuses attachment keys before sending any request", async () => {
    const count = requests.length;
    const attachment = `clinic/${randomUUID()}/${randomUUID()}`;
    await expect(store.delete(attachment)).rejects.toThrow("invalid_export_key");
    await expect(
      store.put(attachment, Buffer.from("sample"), new AbortController().signal),
    ).rejects.toThrow("invalid_export_key");
    expect(requests).toHaveLength(count);
  });
  it("refuses a denied stat and strips the SDK's key and bucket from errors", async () => {
    status = 403;
    await expect(store.exists(key)).rejects.toThrow("export_store_unavailable");
    await expect(store.delete(key)).rejects.toThrow("export_store_unavailable");
  });
});
