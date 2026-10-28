import { describe, expect, it, vi } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../../api-error";
import { createHttpReportExports } from "../http-report-exports";
import { createTransport } from "../http-transport";
import { CLINIC, NOW, USER, code } from "./fetch-stub";

// The F3 export routes over the real transport: a synthetic fetch answers, so the contract parse
// and the error envelope mapping run exactly as in production.
const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const EXPORT = "0190a000-0000-7000-8000-0000000000e1";
const NEXT = "0190a000-0000-7000-8000-0000000000e2";
const CREATED = "2026-10-27T09:00:00.000Z";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const row = (over: Record<string, unknown> = {}) => ({
  id: EXPORT,
  report: "daily_takings",
  format: "csv",
  status: "queued",
  createdAt: CREATED,
  expiresAt: null,
  byteSize: null,
  rowCount: null,
  ...over,
});

type Seen = { url: string; method: string; body: unknown; headers: Record<string, string> };
type Answer = { status?: number; body?: unknown; bytes?: Uint8Array<ArrayBuffer>; type?: string };

function exportsWith(answer: (seen: Seen) => Answer) {
  const seen: Seen[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Seen = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    seen.push(call);
    const a = answer(call);
    if (a.bytes) {
      return new Response(new Blob([a.bytes]), {
        status: a.status ?? 200,
        headers: { "content-type": a.type! },
      });
    }
    return new Response(a.body === undefined ? "" : JSON.stringify(a.body), {
      status: a.status ?? 200,
    });
  });
  const transport = createTransport(fetchImpl as unknown as typeof fetch);
  return { seen, api: createHttpReportExports({ transport, clinicId: CLINIC, now: () => NOW }) };
}

const refusal = (status: number, errorCode: string) => () => ({
  status,
  body: { code: errorCode, message_ar: "رفض", message_en: "Refused" },
});

const BODY = {
  report: "daily_takings",
  from: "2026-01-01",
  to: "2026-12-31",
  groupBy: "month",
  format: "xlsx",
  language: "ar",
} as const;

describe("requesting an export over HTTP", () => {
  it("POSTs the body as typed and reads the 202 envelope", async () => {
    const h = exportsWith(() => ({ status: 202, body: { export: row() } }));
    const answer = await h.api.requestExport(P, BODY);
    expect(answer).toStrictEqual({ export: row() });
    expect(h.seen).toHaveLength(1);
    expect(h.seen[0]!.url).toBe("/api/v1/finance-reports/exports");
    expect(h.seen[0]!.method).toBe("POST");
    expect(h.seen[0]!.body).toStrictEqual(BODY);
    expect(h.seen[0]!.headers["Idempotency-Key"]).toBeUndefined();
  });

  it("leaves a too-long range to the API instead of refusing it locally", async () => {
    const h = exportsWith(refusal(422, "report_range_too_long"));
    const long = { ...BODY, from: "2020-01-01", to: "2026-12-31" };
    expect(await code(h.api.requestExport(P, long))).toEqual({
      code: "report_range_too_long",
      details: {},
    });
    expect(h.seen).toHaveLength(1);
    expect(h.seen[0]!.body).toStrictEqual(long);
  });

  it.each([
    [429, "export_busy"],
    [422, "export_amount_too_large"],
    [403, "forbidden"],
    [422, "validation"],
  ])("rejects a %i with the API's own code %s", async (status, errorCode) => {
    const h = exportsWith(refusal(status, errorCode));
    expect((await code(h.api.requestExport(P, BODY))).code).toBe(errorCode);
  });
});

describe("the export history over HTTP", () => {
  it("sends limit and cursor and parses the list", async () => {
    const list = { items: [row({ status: "running" })], nextCursor: NEXT, total: 2 };
    const h = exportsWith(() => ({ body: list }));
    expect(await h.api.listExports(P, { limit: 5, cursor: EXPORT })).toStrictEqual(list);
    const url = new URL(h.seen[0]!.url, "http://x");
    expect(url.pathname).toBe("/api/v1/finance-reports/exports");
    expect(h.seen[0]!.method).toBe("GET");
    expect(Object.fromEntries(url.searchParams)).toStrictEqual({ limit: "5", cursor: EXPORT });
  });

  it("omits an absent cursor", async () => {
    const h = exportsWith(() => ({ body: { items: [], nextCursor: null, total: 0 } }));
    await h.api.listExports(P, { limit: 20 });
    expect(new URL(h.seen[0]!.url, "http://x").search).toBe("?limit=20");
  });

  it("refuses a list row with a field the contract does not have", async () => {
    const h = exportsWith(() => ({
      body: { items: [row({ storageKey: "x" })], nextCursor: null, total: 1 },
    }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await code(h.api.listExports(P, { limit: 20 }))).code).toBe("unknown");
    spy.mockRestore();
  });
});

describe("one export's status over HTTP", () => {
  it.each([
    ["queued", {}],
    ["running", {}],
    ["done", { expiresAt: "2026-10-28T09:00:00.000Z", byteSize: 120, rowCount: 3 }],
    ["failed", {}],
    ["expired", { rowCount: 3 }],
    ["purged", { rowCount: 3 }],
  ])("reads a %s export", async (status, over) => {
    const body = { export: row({ status, ...over }) };
    const h = exportsWith(() => ({ body }));
    expect(await h.api.getExport(P, EXPORT)).toStrictEqual(body);
    expect(h.seen[0]!.url).toBe(`/api/v1/finance-reports/exports/${EXPORT}`);
    expect(h.seen[0]!.method).toBe("GET");
  });

  it("encodes the id into the path", async () => {
    const h = exportsWith(refusal(404, "not_found"));
    expect((await code(h.api.getExport(P, "a/b?c"))).code).toBe("not_found");
    expect(h.seen[0]!.url).toBe("/api/v1/finance-reports/exports/a%2Fb%3Fc");
  });

  it.each([
    ["an extra field", { export: row({ params: {} }) }],
    ["an unknown status", { export: row({ status: "deleted" }) }],
    ["a missing envelope", row()],
  ])("refuses an answer with %s", async (_label, body) => {
    const h = exportsWith(() => ({ body }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = await h.api.getExport(P, EXPORT).catch((e: unknown) => e);
    spy.mockRestore();
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("unknown");
  });
});

describe("downloading an export over HTTP", () => {
  it.each([
    ["text/csv; charset=utf-8", new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x2c, 0x42])],
    [XLSX, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff])],
  ])("passes the %s bytes through as a Blob", async (type, bytes) => {
    const h = exportsWith(() => ({ bytes, type }));
    const blob = await h.api.downloadExport(P, EXPORT);
    expect(blob.type).toBe(type);
    expect(new Uint8Array(await blob.arrayBuffer())).toStrictEqual(bytes);
    expect(h.seen[0]!.url).toBe(`/api/v1/finance-reports/exports/${EXPORT}/download`);
    expect(h.seen[0]!.method).toBe("GET");
  });

  it.each([
    [403, "forbidden"],
    [404, "not_found"],
  ])("rejects a %i with %s and gives no file", async (status, errorCode) => {
    const h = exportsWith(refusal(status, errorCode));
    expect((await code(h.api.downloadExport(P, EXPORT))).code).toBe(errorCode);
  });
});
