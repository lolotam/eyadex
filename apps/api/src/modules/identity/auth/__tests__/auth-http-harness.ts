import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";

import { type EyadexAuth } from "@eyadex/auth";
import { systemUuidV7 } from "@eyadex/ids";
import { createLogger } from "@eyadex/observability";
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import postgres, { type Sql } from "postgres";

import { createApp } from "../../../../app.ts";
import { API_LOG_EVENTS } from "../../../../shared/log-events.ts";
import { AREA_AUTH, type AreaAuth } from "../area-auth.ts";
import { SessionGuard, type AuthenticatedRequest } from "../session.guard.ts";

// The same app wiring as auth-http.db.spec.ts, shared by the specs that need a mounted auth API.
const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set — see CI db job`);
  return value;
};

export const APP = "https://app.eyadex.test";
export const PLATFORM = "https://platform.eyadex.test";
export const password = randomBytes(18).toString("base64url");

@Controller("probe")
@UseGuards(SessionGuard)
class ProbeController {
  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return { area: request.areaSession.area, userId: request.areaSession.session.user.id };
  }
}

export interface Harness {
  readonly app: NestFastifyApplication;
  readonly areaAuth: AreaAuth;
  readonly owner: Sql;
}

/** Builds the API with auth mounted on a fresh secret; the caller closes it with `closeHarness`. */
export async function openHarness(env: Record<string, string> = {}): Promise<Harness> {
  Object.assign(process.env, {
    APP_URL: APP,
    PLATFORM_URL: PLATFORM,
    AUTH_DATABASE_URL: required("EYADEX_TEST_AUTH_URL"),
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    TRUST_PROXY_HOPS: "0",
    REDIS_URL: required("EYADEX_TEST_REDIS_URL"),
    ...env,
  });
  const owner = postgres(required("EYADEX_TEST_OWNER_URL"), {
    max: 2,
    onnotice: () => undefined,
  });
  const sink = new Writable({ write: (_c, _e, done) => done() });
  const app = await createApp(
    { mountAuth: true },
    {
      logger: createLogger("info", { destination: sink, events: API_LOG_EVENTS }),
      controllers: [ProbeController],
    },
  );
  await app.getHttpAdapter().getInstance().ready();
  return { app, areaAuth: app.get<AreaAuth>(AREA_AUTH), owner };
}

export async function closeHarness(h: Harness | undefined): Promise<void> {
  await h?.app.close();
  await h?.owner.end();
}

export interface Call {
  method?: "GET" | "POST";
  url: string;
  host: string;
  cookie?: string;
  body?: unknown;
  rawBody?: string;
  /** The socket address the request arrives from; the default is light-my-request's. */
  ip?: string;
  headers?: Record<string, string>;
}

export const call = (h: Harness, o: Call) =>
  h.app.inject({
    method: o.method ?? "POST",
    url: o.url,
    headers: {
      host: new URL(o.host).host,
      origin: o.host,
      "content-type": "application/json",
      ...(o.cookie === undefined ? {} : { cookie: o.cookie }),
      ...o.headers,
    },
    ...(o.ip === undefined ? {} : { remoteAddress: o.ip }),
    ...(o.method === "GET" ? {} : { payload: o.rawBody ?? JSON.stringify(o.body ?? {}) }),
  });

export const setCookies = (res: { headers: Record<string, unknown> }): string[] => {
  const raw = res.headers["set-cookie"];
  return raw === undefined ? [] : Array.isArray(raw) ? (raw as string[]) : [String(raw)];
};

export const jar = (lines: string[]) => lines.map((line) => line.split(";")[0]).join("; ");

/** Creates an account through the instance of its area and returns its id and stored email. */
export async function createUser(h: Harness, auth: EyadexAuth, label: string) {
  const email = `${label}-${systemUuidV7().newId()}@example.com`;
  const { userId } = await auth.createUserAccount({ email, name: label, password });
  return { userId, email };
}
