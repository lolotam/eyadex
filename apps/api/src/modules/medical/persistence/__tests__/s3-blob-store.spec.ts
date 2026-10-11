import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ServiceUnavailableError } from "../../../../shared/errors.ts";
import { BlobStoreAnswerError, S3BlobStore } from "../s3-blob-store.ts";

// How the adapter reads S3 failures, against a local server that answers every request with one status
// and an S3 error body that echoes the key (as real stores do). The round trip itself runs against a real
// MinIO in s3-blob-store.db.spec.ts.
const KEY = `clinic/${randomUUID()}/${randomUUID()}`;
let status = 500;
let server: Server;

const errorBody = (): string =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>Status${status}</Code>` +
  `<Message>failed on ${KEY}</Message><Key>${KEY}</Key></Error>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(status, { "content-type": "application/xml" });
      res.end(errorBody());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const store = (port: number): S3BlobStore =>
  new S3BlobStore({
    endpoint: new URL(`http://127.0.0.1:${port}`),
    bucket: "eyadex-medical-test",
    region: "us-east-1",
    accessKey: randomBytes(8).toString("hex"),
    secretKey: randomBytes(16).toString("hex"),
    timeoutMs: 5_000,
  });

const failure = async (operation: Promise<unknown>): Promise<Error> => {
  const error = await operation.then(
    () => new Error("expected a failure"),
    (caught: unknown) => caught as Error,
  );
  expect(error.message).not.toContain(KEY);
  expect(error.cause).toBeUndefined();
  return error;
};

describe("S3BlobStore answers", () => {
  it("a missing key is a not-found answer error, never 503", async () => {
    status = 404;
    const live = store((server.address() as AddressInfo).port);
    const error = await failure(live.get(KEY));
    expect(error).toBeInstanceOf(BlobStoreAnswerError);
    expect(error.message).toMatch(/download: not found/);
  });

  it("a refusal (403) is an answer error carrying the status only", async () => {
    status = 403;
    const live = store((server.address() as AddressInfo).port);
    expect(await failure(live.put(KEY, randomBytes(32)))).toBeInstanceOf(BlobStoreAnswerError);
    expect(await failure(live.get(KEY))).toBeInstanceOf(BlobStoreAnswerError);
  });

  it("a 5xx or an unreachable store is 503", async () => {
    status = 503;
    const live = store((server.address() as AddressInfo).port);
    expect(await failure(live.put(KEY, randomBytes(32)))).toBeInstanceOf(ServiceUnavailableError);
    expect(await failure(store(1).get(KEY))).toBeInstanceOf(ServiceUnavailableError);
  }, 20_000);
});
