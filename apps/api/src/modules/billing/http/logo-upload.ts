import type { FastifyInstance } from "fastify";

import { LOGO_MAX_BYTES } from "../domain/logo.ts";

/** The one route that reads an image body (spec §3.3). */
const LOGO_ROUTE = "/v1/clinic/logo";
const IMAGE_TYPES = ["image/png", "image/jpeg"];

// The status Fastify gives a body type a route does not parse; the envelope filter answers `validation`.
class UnsupportedMediaType extends Error {
  readonly statusCode = 415;
}

/**
 * Teaches Fastify a raw PNG or JPEG body, up to the logo's size, for the logo upload only. A content-type
 * parser is instance-wide (Nest registers every route on the root instance), so a hook refuses an image
 * body on any other route, exactly as before the parser existed. Over the size, Fastify answers 413.
 *
 * @param fastify the application's Fastify instance, before Nest registers its routes
 */
export function registerLogoUploads(fastify: FastifyInstance): void {
  fastify.addContentTypeParser(
    IMAGE_TYPES,
    { parseAs: "buffer", bodyLimit: LOGO_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );
  fastify.addHook("preValidation", async (request) => {
    const type = (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    const upload = request.method === "PUT" && request.routeOptions.url === LOGO_ROUTE;
    if (IMAGE_TYPES.includes(type) && !upload) throw new UnsupportedMediaType();
  });
}
