import { CLIENT_IP_HEADER, type AuthArea, type EyadexAuth } from "@eyadex/auth";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { ApiError } from "../../../shared/errors.ts";
import { hasTwoFactor, toHeaders, type AreaAuth } from "./area-auth.ts";
import { authFailure } from "./auth-errors.ts";
import { rateRulesFor } from "./auth-rate-limits.ts";
import type { RateLimiter } from "./rate-limiter.ts";
import {
  ENABLE_TWO_FACTOR_PATH,
  findAuthRoute,
  TRUST_DEVICE_PATHS,
  VERIFY_TOTP_PATH,
} from "./auth-routes.ts";

// Hop-by-hop or recomputed by the Fetch Request; forwarding them could desync the body. The client IP
// header is always rewritten below, so whatever the client sent under that name is dropped first.
const DROPPED = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  CLIENT_IP_HEADER,
]);

const fail = (reply: FastifyReply, error: ApiError) =>
  reply.code(error.status).send(error.toEnvelope());

/**
 * يبعت الطلب لـ Better Auth بالـ URL اللي المتصفح شايفه: الـ proxy شال `/api`، فبنرجّعه عشان يطابق
 * `basePath` (`/api/auth`) — ADR-0004. عنوان العميل بيتحسب هنا بس (socket أو الـ proxies الموثوقة).
 */
async function forward(
  areaAuth: AreaAuth,
  area: AuthArea,
  request: FastifyRequest,
): Promise<Response> {
  const headers = toHeaders(request.headers);
  for (const name of DROPPED) headers.delete(name);
  const ip = areaAuth.hosts.clientIp(request.headers, request.socket.remoteAddress);
  if (ip !== undefined) headers.set(CLIENT_IP_HEADER, ip);
  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET") init.body = (request.body as string | undefined) ?? "";
  const url = new URL(`/api${request.url}`, areaAuth.hosts.origin(area));
  return areaAuth.of(area).auth.handler(new Request(url, init));
}

/** A failed Better Auth answer leaves as the API envelope; a successful one passes through as is. */
async function write(reply: FastifyReply, response: Response): Promise<void> {
  const body = await response.text();
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) void reply.header("set-cookie", cookies);
  if (response.status >= 400) return fail(reply, authFailure(response.status, body));
  void reply.code(response.status);
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie" && name !== "content-length") void reply.header(name, value);
  });
  await reply.send(body);
}

/** Platform verify routes refuse `trustDevice`: a remembered browser would skip mandatory TOTP. */
function asksToTrustDevice(body: unknown): boolean {
  if (typeof body !== "string" || body === "") return false;
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed !== "object" || parsed === null || "trustDevice" in parsed;
  } catch {
    // Not JSON: Better Auth would read it some other way; refuse rather than guess what it carries.
    return true;
  }
}

// Routes whose limits are keyed on the signed-in user: the handler looks the session up for them.
const USER_KEYED = new Set([
  "/change-password",
  "/two-factor/enable",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

type Limited = "allowed" | "refused" | "unavailable";

/** Counts the request before Better Auth sees it (ADR-0005); a Redis failure never lets it through. */
async function applyLimits(
  limiter: RateLimiter,
  areaAuth: AreaAuth,
  area: AuthArea,
  path: string,
  userId: string | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Limited> {
  const rules = rateRulesFor({
    area,
    path,
    ip: areaAuth.hosts.clientIp(request.headers, request.socket.remoteAddress),
    body: request.body,
    cookieHeader: typeof request.headers.cookie === "string" ? request.headers.cookie : undefined,
    userId,
  });
  if (rules.length === 0) return "allowed";
  try {
    const decision = await limiter.check(area, rules);
    if (decision.allowed) return "allowed";
    void reply.header("retry-after", String(decision.retryAfterSeconds));
    await fail(reply, new ApiError("rate_limited"));
    return "refused";
  } catch (exception) {
    request.log.error({ err: exception }, "rate limiter unavailable");
    await reply.code(503).send(new ApiError("unknown").toEnvelope());
    return "unavailable";
  }
}

async function handle(
  areaAuth: AreaAuth,
  limiter: RateLimiter,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const area: AuthArea | null = areaAuth.hosts.resolve(request.headers);
  if (area === null) return fail(reply, new ApiError("not_found"));
  const path = request.url.split("?")[0]!.slice("/auth".length);
  const route = findAuthRoute(request.method, path);
  if (route === undefined || (route.onlyArea !== undefined && route.onlyArea !== area)) {
    return fail(reply, new ApiError("not_found"));
  }

  const instance: EyadexAuth = areaAuth.of(area);
  // A session from the other area (a cookie renamed across hosts) is refused on EVERY auth route, not
  // only on /v1: Better Auth alone accepts it (same table, same secret), so change-password, enable or
  // sign-out would otherwise act on it (ADR-0003).
  if (await instance.isForeignSession(toHeaders(request.headers))) {
    return fail(reply, new ApiError("unauthorized"));
  }
  if (area === "platform" && TRUST_DEVICE_PATHS.has(path) && asksToTrustDevice(request.body)) {
    return fail(reply, new ApiError("validation"));
  }
  const needsSession =
    (area === "platform" && (!route.beforeTwoFactor || path === VERIFY_TOTP_PATH)) ||
    USER_KEYED.has(path);
  // Always the area-bound lookup (ADR-0003), never auth.api.getSession.
  const session = needsSession ? await instance.getSession(toHeaders(request.headers)) : null;

  // Mandatory TOTP on the platform host (PRD §4.10): an unenrolled session reaches enrollment only.
  if (area === "platform" && !route.beforeTwoFactor && session !== null && !hasTwoFactor(session)) {
    return fail(reply, new ApiError("two_factor_required"));
  }
  const limited = await applyLimits(
    limiter,
    areaAuth,
    area,
    path,
    session?.user.id,
    request,
    reply,
  );
  if (limited !== "allowed") return;
  if (path === ENABLE_TWO_FACTOR_PATH && session !== null) {
    const locked = await instance.withEnrollmentLock(session.user.id, () =>
      forward(areaAuth, area, request),
    );
    if (!locked.acquired) return fail(reply, new ApiError("two_factor_busy"));
    return write(reply, locked.value);
  }
  const response = await forward(areaAuth, area, request);
  // Platform enrollment just completed: sessions opened with the password alone before it must not
  // inherit full access now that the user's two-factor flag is on — only the new session stays.
  if (
    area === "platform" &&
    path === VERIFY_TOTP_PATH &&
    response.ok &&
    session !== null &&
    !hasTwoFactor(session)
  ) {
    const keep = new Headers({ cookie: cookiesOf(response) });
    await instance.revokeOtherSessions(session.user.id, keep);
  }
  return write(reply, response);
}

/** The `name=value` pairs a response sets, as a request `Cookie` header. */
function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
}

/**
 * بيركّب `/auth/*` على Fastify خارج الـ prefix `/v1`، في scope خاص بيستقبل الـ body نص خام عشان
 * يتبعت لـ Better Auth زي ما هو.
 *
 * @param fastify الـ instance بتاع الـ adapter
 * @param areaAuth الـ instances والـ hosts
 * @param limiter الـ rate limiter (ADR-0005)، بيتنده قبل Better Auth
 * @returns بيخلص لما الـ plugin يتسجل
 */
export async function registerAuthRoutes(
  fastify: FastifyInstance,
  areaAuth: AreaAuth,
  limiter: RateLimiter,
): Promise<void> {
  await fastify.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => {
      done(null, body);
    });
    scope.route({
      method: ["GET", "POST"],
      url: "/auth/*",
      // This route sits outside Nest, so EnvelopeExceptionFilter never sees its throws: a failure here
      // (database, lock, revocation) is logged sanitised and leaves as `unknown`, like the filter does.
      handler: async (request, reply) => {
        try {
          await handle(areaAuth, limiter, request, reply);
        } catch (exception) {
          request.log.error({ err: exception }, "unhandled error");
          if (!reply.sent) await fail(reply, new ApiError("unknown"));
        }
      },
    });
  });
}
