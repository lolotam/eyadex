import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ServiceUnavailableError } from "../../../../shared/errors.ts";
import { BlobStoreAnswerError, OpeninaryBlobStore } from "../openinary-blob-store.ts";

// The Openinary adapter against a local fake of its documented API (never the real service): what it
// sends, and that anything but the documented success is an error.
const API_KEY = randomBytes(16).toString("hex");
const KEY = "clinic/01890000-0000-7000-8000-00000000000a/01890000-0000-7000-8000-000000000001";

interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
  form: FormData | null;
}

type Reply = (req: IncomingMessage, res: ServerResponse, seen: Seen) => void;

let server: Server;
let baseUrl: URL;
let seen: Seen[] = [];
let reply: Reply;

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const uploaded =
  (path: string): Reply =>
  (_q, res) =>
    json(res, 200, { success: true, files: [{ filename: "x", path, size: 1, url: `/t/${path}` }] });

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const type = req.headers["content-type"] ?? "";
      const parse = type.startsWith("multipart/form-data")
        ? new Response(body, { headers: { "content-type": type } }).formData()
        : Promise.resolve(null);
      void parse.then((form) => {
        const entry: Seen = {
          method: req.method ?? "",
          url: req.url ?? "",
          authorization: req.headers.authorization,
          form,
        };
        seen.push(entry);
        reply(req, res, entry);
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  seen = [];
});

const store = (folderPrefix: string | null = null, timeoutMs?: number) =>
  new OpeninaryBlobStore({
    baseUrl,
    apiKey: API_KEY,
    folderPrefix,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });

describe("put", () => {
  it("posts one `files` part with the folder and the name, and the key as a Bearer token", async () => {
    reply = uploaded(KEY);
    const bytes = randomBytes(300);
    await store().put(KEY, bytes);
    expect(seen).toHaveLength(1);
    const [req] = seen;
    expect([req!.method, req!.url, req!.authorization]).toEqual([
      "POST",
      "/upload",
      `Bearer ${API_KEY}`,
    ]);
    const files = req!.form!.getAll("files");
    expect(files).toHaveLength(1);
    const file = files[0] as File;
    expect(Buffer.from(await file.arrayBuffer()).equals(bytes)).toBe(true);
    expect(file.type).toBe("application/octet-stream");
    expect(req!.form!.get("folder")).toBe("clinic/01890000-0000-7000-8000-00000000000a");
    expect(req!.form!.get("names")).toBe("01890000-0000-7000-8000-000000000001");
  });

  it("puts the key under the folder prefix", async () => {
    reply = uploaded(`eyadex/medical/${KEY}`);
    await store("eyadex/medical").put(KEY, randomBytes(8));
    expect(seen[0]!.form!.get("folder")).toBe(
      "eyadex/medical/clinic/01890000-0000-7000-8000-00000000000a",
    );
  });

  it("NEGATIVE: a refusal, a partial success or a body that is not the stored path is an error", async () => {
    const answers: Reply[] = [
      (_q, res) =>
        json(res, 400, { error: "invalid_type", message: "File content does not match" }),
      (_q, res) => json(res, 207, { success: false, files: [], errors: [{ filename: "x" }] }),
      (_q, res) => json(res, 401, { error: "unauthorized", message: "no" }),
      uploaded("somewhere/else"),
      (_q, res) => json(res, 200, { success: false, files: [{ path: KEY }] }),
      (_q, res) => json(res, 200, { success: true, files: [{ path: KEY }, { path: KEY }] }),
      (_q, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      },
    ];
    for (const answer of answers) {
      reply = answer;
      await expect(store().put(KEY, randomBytes(8))).rejects.toBeInstanceOf(BlobStoreAnswerError);
    }
  });

  it("NEGATIVE: a 5xx, a redirect or an unreachable store is 503 and never followed", async () => {
    reply = (_q, res) => json(res, 502, { error: "bad_gateway" });
    await expect(store().put(KEY, randomBytes(8))).rejects.toBeInstanceOf(ServiceUnavailableError);
    reply = (_q, res) => {
      res.writeHead(307, { location: "http://127.0.0.1:9/upload" });
      res.end();
    };
    await expect(store().put(KEY, randomBytes(8))).rejects.toBeInstanceOf(ServiceUnavailableError);
    const closed = new OpeninaryBlobStore({
      baseUrl: new URL("http://127.0.0.1:9"),
      apiKey: API_KEY,
      folderPrefix: null,
    });
    await expect(closed.put(KEY, randomBytes(8))).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("NEGATIVE: an answer slower than the timeout is 503", async () => {
    reply = (_q, res) => setTimeout(() => json(res, 200, {}), 500);
    await expect(store(null, 50).put(KEY, randomBytes(8))).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });
});

describe("get", () => {
  it("downloads the stored path with the key and returns the bytes unchanged", async () => {
    const bytes = randomBytes(1000);
    reply = (_q, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(bytes);
    };
    const got = await store("p").get(KEY);
    expect(got.equals(bytes)).toBe(true);
    expect([seen[0]!.method, seen[0]!.url, seen[0]!.authorization]).toEqual([
      "GET",
      `/download/p/${KEY}`,
      `Bearer ${API_KEY}`,
    ]);
  });

  it("NEGATIVE: a missing file is an error, a 5xx is 503", async () => {
    reply = (_q, res) => json(res, 404, { error: "not_found" });
    await expect(store().get(KEY)).rejects.toBeInstanceOf(BlobStoreAnswerError);
    reply = (_q, res) => json(res, 500, { error: "x" });
    await expect(store().get(KEY)).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
