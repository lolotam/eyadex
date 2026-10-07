import type { z } from "zod";
import { ApiError } from "../api-error";
import { errorFromResponse } from "./http-errors";

/** Same origin only (ADR-0004): the proxy routes `/api` on each area's host to the API. */
const BASE = "/api";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type QueryValue = string | number | boolean | null | undefined;

export type RequestOptions<S extends z.ZodTypeAny> = {
  /** The API's response schema; every answer is checked against it before it is mapped. */
  schema: S;
  body?: unknown;
  query?: Record<string, QueryValue>;
  idempotencyKey?: string;
};

export type Transport = {
  send<S extends z.ZodTypeAny>(
    method: Method,
    path: string,
    options: RequestOptions<S>,
  ): Promise<z.infer<S>>;
  /** For answers with no body (204) or whose body is not needed. */
  sendEmpty(
    method: Method,
    path: string,
    options?: Omit<RequestOptions<z.ZodTypeAny>, "schema">,
  ): Promise<void>;
};

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** Called when the session is gone (a 401 on `/v1`, or no session at all). Returns unsubscribe. */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener();
}

const reportedDrift = new Set<string>();

/** Drift detector: one log per route, with field paths and issue codes only — never values. */
function reportDrift(label: string, error: z.ZodError): void {
  if (reportedDrift.has(label)) return;
  reportedDrift.add(label);
  const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}:${issue.code}`);
  console.error(`[api] response does not match the API schema: ${label}`, issues);
}

function urlOf(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `${BASE}${path}${search ? `?${search}` : ""}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function createTransport(fetchImpl: typeof fetch = (...args) => fetch(...args)): Transport {
  async function raw(
    method: Method,
    path: string,
    options: Omit<RequestOptions<z.ZodTypeAny>, "schema">,
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey !== undefined) headers["Idempotency-Key"] = options.idempotencyKey;
    let response: Response;
    try {
      response = await fetchImpl(urlOf(path, options.query), {
        method,
        headers,
        credentials: "same-origin",
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch {
      throw new ApiError("unknown");
    }
    const body = await readJson(response);
    if (!response.ok) {
      if (response.status === 401 && path.startsWith("/v1/")) notifyUnauthorized();
      throw errorFromResponse(response.status, body);
    }
    return body;
  }

  return {
    async send(method, path, options) {
      const body = await raw(method, path, options);
      const parsed = options.schema.safeParse(body);
      if (!parsed.success) {
        reportDrift(`${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, parsed.error);
        throw new ApiError("unknown");
      }
      return parsed.data;
    },
    async sendEmpty(method, path, options = {}) {
      await raw(method, path, options);
    },
  };
}

/** Every page of a cursor list, for option lists the UI needs whole (roles, branches). */
export async function collectPages<T>(
  load: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const page = await load(cursor);
    all.push(...page.items);
    if (!page.nextCursor) return all;
    cursor = page.nextCursor;
  }
  return all;
}
