import "reflect-metadata";

import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type Type,
} from "@nestjs/common";
import { APP_GUARD, ModulesContainer, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { systemUuidV7, type IdGenerator } from "@eyadex/ids";
import {
  createLogger,
  enterRequestContext,
  withRequestContext,
  type Logger,
  type RequestContext,
} from "@eyadex/observability";
import { LogController, type FastifyReply, type FastifyRequest } from "fastify";

import {
  AccessGuard,
  AREA_AUTH,
  assertRouteAccess,
  AUTH_RATE_LIMIT,
  ClinicAccessModule,
  AuthModule,
  InvitationsModule,
  registerAuthRoutes,
  RolesModule,
  type AreaAuth,
  type AuthRateLimit,
} from "./modules/identity/index.ts";
import { PatientsModule } from "./modules/patients/index.ts";
import { AppointmentsModule } from "./modules/appointments/index.ts";
import { MedicalModule, registerAttachmentUploads } from "./modules/medical/index.ts";
import { BillingModule, registerLogoUploads } from "./modules/billing/index.ts";
import { ClinicAuditModule, PlatformAuditModule } from "./modules/audit/index.ts";
import { whatsappHooks, whatsappModule, type WhatsappDependencies } from "./app-whatsapp.ts";
import { PlatformModule } from "./modules/platform/index.ts";
import { SettingsModule } from "./modules/settings/index.ts";
import type { BlobStore } from "./shared/blob/blob-store.ts";
import { EnvelopeExceptionFilter } from "./shared/exception.filter.ts";
import { HealthController } from "./shared/health.controller.ts";
import { API_LOG_EVENTS } from "./shared/log-events.ts";
import { PinoNestLogger } from "./shared/nest-logger.ts";
import { ApiError, codeForStatus } from "./shared/errors.ts";
import { applySecurityHeaders } from "./shared/security-headers.ts";
import { LOGS, SHUTDOWN, ShutdownHook, UNCLEAN } from "./shared/shutdown.ts";

export { SHUTDOWN_WATCHDOG_MS, watchShutdown } from "./shared/shutdown.ts";

export interface AppDependencies extends WhatsappDependencies {
  /** UUID v7 for rows the use cases create; the system clock and Web Crypto unless a test injects its own. */
  readonly ids?: IdGenerator;
  /** Releases what main.ts opened. Runs on app.close() and on SIGTERM/SIGINT. */
  readonly onShutdown?: () => Promise<void>;
  /**
   * What a signal-triggered shutdown whose release failed or timed out does once it is logged. Nest swallows
   * an error thrown from onApplicationShutdown and then exits 0 (useProcessExit), so the hook cannot throw
   * its way to a non-zero exit: production exits 1 here, a test records the call.
   */
  readonly onUncleanShutdown?: (signal: string) => void;
  /**
   * Mounts Better Auth at `/auth/*` and provides `SessionGuard` (ADR-0004). Reads APP_URL, PLATFORM_URL,
   * AUTH_DATABASE_URL, BETTER_AUTH_SECRET and TRUST_PROXY_HOPS from the environment.
   */
  readonly mountAuth?: boolean;
  /**
   * Mounts the platform area (`POST /v1/platform/clinics`, ADR-0006; `GET /v1/platform/audit`, ADR-0019). Needs auth mounted too, plus
   * DATABASE_URL, PLATFORM_DATABASE_URL and OUTBOX_SEAL_KEY.
   */
  readonly mountPlatform?: boolean;
  /** Mounts `POST /v1/invitations/{inspect,accept}` (ADR-0008). Needs auth mounted and DATABASE_URL. */
  readonly mountInvitations?: boolean;
  /**
   * Mounts the clinic request context behind the global access guard and `GET /v1/me`, `/v1/roles`,
   * `/v1/permissions/catalogue`, `/v1/branches`, `/v1/users`, `/v1/invitations`, `/v1/clinic/mail-provider`,
   * `/v1/patients`, `/v1/clinic/audit`, `/v1/services`, `/v1/schedules`, and finance F1's `/v1/prices`
   * (ADR-0009, 0011, 0012, 0014, 0018, 0019, 0026; docs/specs/finance-design.md). Needs auth mounted,
   * DATABASE_URL, REDIS_URL, OUTBOX_SEAL_KEY,
   * MAIL_PROVIDER_SEAL_KEY, MEDICAL_MASTER_KEY_V<MEDICAL_KEY_VERSION> and MEDICAL_INDEX_KEY (ADR-0028,
   * docs/specs/medical-keys-runbook.md). Attachments also read MEDICAL_BLOB_S3_ENDPOINT,
   * MEDICAL_BLOB_S3_BUCKET, MEDICAL_BLOB_S3_ACCESS_KEY, MEDICAL_BLOB_S3_SECRET_KEY and the optional
   * MEDICAL_BLOB_S3_REGION (docs/specs/medical-blob-runbook.md); without them the API still starts and
   * only an upload or a download answers 503.
   */
  readonly mountClinic?: boolean;
  /** Test-only: the private bucket (attachments, the clinic logo) instead of the environment's. */
  readonly blobStore?: BlobStore;
}

export interface AppOptions {
  /** The shared sanitising logger — main.ts builds it from the validated LOG_LEVEL; tests pass a sink. */
  readonly logger?: Logger;
  /** Test-only: extra controllers mounted beside the real ones. */
  readonly controllers?: readonly Type<unknown>[];
}

// An incoming id is kept only when it is a canonical UUID (any version): an arbitrary token could be a
// credential a client put in the wrong header, and it would then be printed on every line of the request.
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Each request's own log context, looked up by the request so a callback running elsewhere can restore it.
const contexts = new WeakMap<FastifyRequest, RequestContext>();

// One line per request with safe, structural fields only: the route PATTERN, never the raw URL, whose path
// segments and query string can carry tokens, civil IDs or phone numbers.
function logCompleted(request: FastifyRequest, reply: FastifyReply): void {
  const write = () =>
    request.log.info(
      {
        http: {
          method: request.method,
          route: request.routeOptions.url ?? "[unmatched]",
          status: reply.statusCode,
          ms: Math.round(reply.elapsedTime),
        },
      },
      "request completed",
    );
  const context = contexts.get(request);
  if (context === undefined) write();
  else withRequestContext(context, write);
}

@Module({})
class ApiModule {}

/** The Nest module this API serves: `/v1/health` plus whatever a test mounts beside it. */
export function apiModule(
  deps: AppDependencies,
  logger: Logger,
  controllers: readonly Type<unknown>[] = [],
): DynamicModule {
  return {
    module: ApiModule,
    imports: [
      ...(deps.mountAuth === true ? [AuthModule] : []),
      ...(deps.mountPlatform === true ? [PlatformModule, PlatformAuditModule] : []),
      ...(deps.mountInvitations === true ? [InvitationsModule] : []),
      ...(deps.mountClinic === true
        ? [
            ClinicAccessModule,
            SettingsModule,
            RolesModule,
            PatientsModule,
            AppointmentsModule,
            MedicalModule.forRoot(deps.blobStore),
            BillingModule.forRoot(deps.blobStore),
            whatsappModule(deps),
            ClinicAuditModule,
          ]
        : []),
    ],
    controllers: [HealthController, ...controllers],
    providers: [
      { provide: SHUTDOWN, useValue: deps.onShutdown ?? (async () => undefined) },
      { provide: UNCLEAN, useValue: deps.onUncleanShutdown ?? (() => process.exit(1)) },
      { provide: LOGS, useValue: logger },
      ShutdownHook,
      // Every route, mounted or test-only, passes through it first (RBAC-04, ADR-0009).
      { provide: APP_GUARD, useClass: AccessGuard },
    ],
  };
}

/**
 * The logger Fastify itself holds. Fastify announces every address it bound with a bare string
 * ("Server listening at http://…") — one line per interface, and text that is not a catalogued event, so
 * the sanitiser would print each of them as a placeholder that says nothing. Only a bare string is dropped
 * here: every line this codebase writes passes a log object first, and a per-request logger is a real pino
 * child of the shared logger, so request lines are untouched.
 *
 * @param logger the shared sanitising logger
 * @returns the logger to hand Fastify as its `loggerInstance`
 */
function frameworkLogger(logger: Logger): Logger {
  // A child, not the root: `info` is replaced on this one object only. A per-request logger Fastify derives
  // from it inherits the override, so `this` is honoured — that logger's bindings stay on the line.
  const framework = logger.child({});
  const original = framework.info;
  framework.info = function info(this: Logger, object: unknown, message?: string) {
    if (typeof object !== "string") original.call(this, object, message);
  };
  return framework;
}

/**
 * Fastify with the shared sanitising logger, one request id per request, and the envelope for the errors
 * Fastify raises before Nest ever sees the request.
 *
 * @param logger the sanitising logger
 * @param ids    the UUID v7 generator behind a missing or forged request id
 * @returns the adapter, before any route is registered
 */
export function apiAdapter(logger: Logger, ids: IdGenerator): FastifyAdapter {
  const adapter = new FastifyAdapter({
    loggerInstance: frameworkLogger(logger),
    // A caller's X-Request-Id is kept when it is a plain token (so a trace spans the web app and the API);
    // anything else — too long, or with characters that could forge a log line — is replaced with a UUID v7.
    genReqId: (request: { headers: Record<string, string | string[] | undefined> }) => {
      const given = request.headers["x-request-id"];
      return typeof given === "string" && REQUEST_ID.test(given) ? given : ids.newId();
    },
    // Fastify's own request log serialises the raw URL; we log one safe line per request instead (below).
    // Its per-request error lines go too — the envelope filter logs unhandled errors through the sanitiser.
    // One id per line, under the field name the request context uses (CLAUDE.md §8): Fastify's own default
    // label would print it a second time, under a second name, on every line of that request.
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: "request_id",
    }),
    // A malformed URL (e.g. `/%ZZ`) is rejected by Fastify's router before Nest runs; answer with the
    // envelope instead of Fastify's default body, which echoes the malformed input.
    frameworkErrors: (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      const status = (error as { statusCode?: unknown }).statusCode;
      // A missing status (a malformed URL) is a bad request; a server-side failure stays a 500.
      const apiError = new ApiError(
        typeof status === "number" ? codeForStatus(status) : "validation",
      );
      // The router rejected this request before any hook ran: give it its id and its log lines here.
      const context = enterRequestContext(request.id);
      contexts.set(request, context);
      void reply.header("x-request-id", request.id);
      applySecurityHeaders(reply);
      if (apiError.code === "unknown") request.log.error({ err: error }, "unhandled error");
      void reply.code(apiError.status).send(apiError.toEnvelope());
      logCompleted(request, reply);
    },
  });
  // Every log line of the request carries its id. The context is kept on the request: with HTTP pipelining,
  // Node flushes a finished response from ANOTHER request's completion, so onResponse must log inside this
  // request's own context, never whatever is current.
  adapter.getInstance().addHook("onRequest", async (request, reply) => {
    contexts.set(request, enterRequestContext(request.id));
    void reply.header("x-request-id", request.id);
    applySecurityHeaders(reply);
  });
  adapter.getInstance().addHook("onResponse", async (request, reply) => {
    logCompleted(request, reply);
  });
  return adapter;
}

/**
 * The wiring every entry point shares: everything under `/v1`, and the envelope for every error.
 *
 * @param app the application Nest created, on any adapter
 * @returns the initialised application, not yet listening
 */
export async function startApi(
  app: NestFastifyApplication,
  mountAuth = false,
): Promise<NestFastifyApplication> {
  // Outside the /v1 prefix: the proxy maps the browser's same-origin /api/auth/* here (ADR-0004).
  if (mountAuth) {
    await registerAuthRoutes(
      app.getHttpAdapter().getInstance(),
      app.get<AreaAuth>(AREA_AUTH),
      app.get<AuthRateLimit>(AUTH_RATE_LIMIT).limiter,
    );
  }
  // The attachment upload is the only multipart route; every other route keeps refusing the type.
  await registerAttachmentUploads(app.getHttpAdapter().getInstance());
  registerLogoUploads(app.getHttpAdapter().getInstance());
  whatsappHooks(app.getHttpAdapter().getInstance());
  // A route without exactly one access declaration fails the boot, not just its requests (RBAC-04).
  assertRouteAccess(app.get(ModulesContainer));
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new EnvelopeExceptionFilter());
  await app.init();
  return app;
}

/**
 * Builds the API: NestJS on Fastify, the shared sanitising logger, one request id per request echoed in the
 * response, the error envelope for every error — including the ones Fastify raises before Nest sees the
 * request — and `/v1/health` as the only route.
 *
 * @param deps    what the app needs; ports arrive with later slices
 * @param options the sanitising logger, plus test hooks that are never set in production
 * @returns an initialised application, not yet listening
 */
export async function createApp(
  deps: AppDependencies,
  options: AppOptions = {},
): Promise<NestFastifyApplication> {
  const logger = options.logger ?? createLogger("info", { events: API_LOG_EVENTS });
  const app = await NestFactory.create<NestFastifyApplication>(
    apiModule(deps, logger, options.controllers ?? []),
    apiAdapter(logger, deps.ids ?? systemUuidV7()),
    // abortOnError: false — an initialisation error is thrown to the caller (main.ts logs it sanitised and
    // exits) instead of Nest exiting the process itself.
    { logger: new PinoNestLogger(logger), abortOnError: false },
  );
  return startApi(app, deps.mountAuth === true);
}
