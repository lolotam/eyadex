import type { AuthArea, EyadexAuth } from "@eyadex/auth";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { ApiError } from "../../../shared/errors.ts";
import { hasTwoFactor, toHeaders, type AreaAuth } from "./area-auth.ts";
import { ENABLE_TWO_FACTOR_PATH, findAuthRoute } from "./auth-routes.ts";

// Hop-by-hop or recomputed by the Fetch Request; forwarding them could desync the body.
const DROPPED = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive"]);

const fail = (reply: FastifyReply, error: ApiError) =>
  reply.code(error.status).send(error.toEnvelope());

/**
 * يبعت الطلب لـ Better Auth بالـ URL اللي المتصفح شايفه: الـ proxy شال `/api`، فبنرجّعه عشان يطابق
 * `basePath` (`/api/auth`) — ADR-0004.
 */
async function forward(
  instance: EyadexAuth,
  origin: string,
  request: FastifyRequest,
): Promise<Response> {
  const headers = toHeaders(request.headers);
  for (const name of DROPPED) headers.delete(name);
  const body = request.method === "GET" ? undefined : ((request.body as string | undefined) ?? "");
  return instance.auth.handler(
    new Request(new URL(`/api${request.url}`, origin), { method: request.method, headers, body }),
  );
}

async function write(reply: FastifyReply, response: Response): Promise<void> {
  void reply.code(response.status);
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie" && name !== "content-length") void reply.header(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) void reply.header("set-cookie", cookies);
  await reply.send(await response.text());
}

async function handle(areaAuth: AreaAuth, request: FastifyRequest, reply: FastifyReply) {
  const area: AuthArea | null = areaAuth.hosts.resolve(request.headers);
  if (area === null) return fail(reply, new ApiError("not_found"));
  const path = request.url.split("?")[0]!.slice("/auth".length);
  const route = findAuthRoute(request.method, path);
  if (route === undefined) return fail(reply, new ApiError("not_found"));

  const instance = areaAuth.of(area);
  const origin = areaAuth.hosts.origin(area);
  const needsSession = (area === "platform" && !route.beforeTwoFactor) || path === ENABLE_TWO_FACTOR_PATH;
  // Always the area-bound lookup (ADR-0003), never auth.api.getSession.
  const session = needsSession ? await instance.getSession(toHeaders(request.headers)) : null;

  // Mandatory TOTP on the platform host (PRD §4.10): an unenrolled session reaches enrollment only.
  if (area === "platform" && !route.beforeTwoFactor && session !== null && !hasTwoFactor(session)) {
    return fail(reply, new ApiError("two_factor_required"));
  }
  if (path === ENABLE_TWO_FACTOR_PATH && session !== null) {
    const locked = await instance.withEnrollmentLock(session.user.id, () =>
      forward(instance, origin, request),
    );
    if (!locked.acquired) return fail(reply, new ApiError("two_factor_busy"));
    return write(reply, locked.value);
  }
  // TODO(spec): Redis-backed rate limiting of sign-in and two-factor (PRD §4.10) belongs here.
  return write(reply, await forward(instance, origin, request));
}

/**
 * بيركّب `/auth/*` على Fastify خارج الـ prefix `/v1`، في scope خاص بيستقبل الـ body نص خام عشان
 * يتبعت لـ Better Auth زي ما هو.
 *
 * @param fastify الـ instance بتاع الـ adapter
 * @param areaAuth الـ instances والـ hosts
 * @returns بيخلص لما الـ plugin يتسجل
 */
export async function registerAuthRoutes(
  fastify: FastifyInstance,
  areaAuth: AreaAuth,
): Promise<void> {
  await fastify.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => {
      done(null, body);
    });
    scope.route({
      method: ["GET", "POST"],
      url: "/auth/*",
      handler: (request, reply) => handle(areaAuth, request, reply),
    });
  });
}
