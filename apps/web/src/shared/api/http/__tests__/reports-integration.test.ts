import { expect, it, vi } from "vitest";
import type { ApiClient } from "../../api-client";
import type { Persona } from "@eyadex/contracts/session";
import { createHttpApiClient } from "../http-adapter";
import { CLINIC, USER, NOW, code } from "./fetch-stub";

const actor: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const ID = "0190a000-0000-7000-8000-0000000000e1";
const BASE = "/api/v1/finance-reports/exports";
const body = {
  report: "daily_takings",
  from: "2024-01-01",
  to: "2026-12-31",
  format: "xlsx",
  language: "ar",
  groupBy: "month",
} as const;
const row = {
  id: ID,
  report: "daily_takings",
  format: "xlsx",
  status: "queued",
  createdAt: NOW.toISOString(),
  expiresAt: null,
  byteSize: null,
  rowCount: null,
};

function client(answer: (url: string, init?: RequestInit) => Response) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    answer(String(input), init),
  );
  const api: ApiClient = createHttpApiClient(fetchImpl, () => NOW);
  return { api, fetchImpl };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

it("root HTTP reports namespace sends all four real routes with typed filters and same-origin cookies", async () => {
  const h = client((url, init) => {
    if (init?.method === "POST") return json({ export: row }, 202);
    if (url.includes("?")) return json({ items: [row], nextCursor: ID, total: 2 });
    return json({ export: row });
  });
  expect(await h.api.reports.requestExport(actor, body)).toStrictEqual({ export: row });
  expect(await h.api.reports.listExports(actor, { limit: 7, cursor: ID })).toStrictEqual({
    items: [row],
    nextCursor: ID,
    total: 2,
  });
  expect(await h.api.reports.getExport(actor, ID)).toStrictEqual({ export: row });
  const [post, list, get] = h.fetchImpl.mock.calls;
  if (!post || !list || !get) throw new Error("Missing HTTP calls");
  expect(String(post[0])).toBe(BASE);
  expect(post[1]?.method).toBe("POST");
  expect(JSON.parse(String(post[1]?.body))).toStrictEqual(body);
  expect(new Headers(post[1]?.headers).get("Content-Type")).toBe("application/json");
  expect(new Headers(post[1]?.headers).has("Idempotency-Key")).toBe(false);
  expect(String(list[0])).toBe(`${BASE}?limit=7&cursor=${ID}`);
  expect(list[1]?.method).toBe("GET");
  expect(String(get[0])).toBe(`${BASE}/${ID}`);
  expect(get[1]?.method).toBe("GET");
  expect(h.fetchImpl.mock.calls.every(([, init]) => init?.credentials === "same-origin")).toBe(
    true,
  );
});

it.each([
  ["text/csv; charset=utf-8", [239, 187, 191, 65, 44, 66, 13, 10]],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", [80, 75, 3, 4, 0, 255]],
] as const)(
  "root HTTP download preserves exact %s bytes/MIME and encodes path",
  async (type, values) => {
    const bytes = new Uint8Array(values);
    const h = client(() => new Response(bytes, { headers: { "content-type": type } }));
    const blob = await h.api.reports.downloadExport(actor, "a/b?c");
    expect(blob.type).toBe(type);
    // Native response Blobs have arrayBuffer; jsdom uses the local FileReader fallback only.
    const result =
      typeof blob.arrayBuffer === "function"
        ? await blob.arrayBuffer()
        : await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => {
              if (reader.result === null || typeof reader.result === "string")
                return reject(new Error("Missing bytes"));
              resolve(reader.result);
            };
            reader.readAsArrayBuffer(blob);
          });
    expect([...new Uint8Array(result)]).toStrictEqual([...bytes]);
    expect(h.fetchImpl.mock.calls[0]?.[0]).toBe(`${BASE}/a%2Fb%3Fc/download`);
    expect(h.fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      credentials: "same-origin",
    });
  },
);

it.each(["request", "list", "get"])(
  "root HTTP %s rejects extra JSON fields via strict contract parse",
  async (method) => {
    const h = client(() =>
      json(
        method === "list"
          ? { items: [{ ...row, params: {} }], nextCursor: null, total: 1 }
          : { export: { ...row, params: {} } },
      ),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const call =
        method === "request"
          ? h.api.reports.requestExport(actor, body)
          : method === "list"
            ? h.api.reports.listExports(actor, {})
            : h.api.reports.getExport(actor, ID);
      expect((await code(call)).code).toBe("unknown");
    } finally {
      spy.mockRestore();
    }
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  },
);

it.each([
  [429, "export_busy"],
  [403, "forbidden"],
] as const)(
  "root HTTP keeps server %s/%s as own code without raw messages",
  async (status, errorCode) => {
    const h = client(() =>
      json(
        { code: errorCode, message_ar: "رفض صناعي", message_en: "synthetic-private-message" },
        status,
      ),
    );
    expect(await code(h.api.reports.requestExport(actor, body))).toStrictEqual({
      code: errorCode,
      details: {},
    });
    const error = await h.api.reports.downloadExport(actor, ID).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: errorCode });
    expect(String(error)).not.toContain("synthetic-private-message");
  },
);

it("root HTTP keeps the existing daily takings route and forwards long filters for server validation", async () => {
  const report = { rows: [], currency: "KWD", currencyExponent: 3 };
  const h = client(() => json(report));
  expect(
    await h.api.reports.dailyTakings(actor, {
      from: body.from,
      to: body.to,
      groupBy: "month",
      language: "en",
    }),
  ).toStrictEqual(report);
  const call = h.fetchImpl.mock.calls[0];
  if (!call) throw new Error("Missing report call");
  expect(String(call[0])).toBe(
    "/api/v1/finance-reports/daily-takings?from=2024-01-01&to=2026-12-31&groupBy=month&language=en",
  );
  expect(call[1]).toMatchObject({ method: "GET", credentials: "same-origin" });
});
