import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";

/** Meta's status webhook: the one route whose signature covers the exact bytes Meta sent. */
export const META_HOOK_ROUTE = "/v1/hooks/meta";

// Fastify's own default body limit, enforced here because these bytes are read before Fastify's parser.
const MAX_BYTES = 1024 * 1024;

const rawBodies = new WeakMap<FastifyRequest, Buffer>();

// The status Fastify gives a body over its limit; the envelope filter answers it.
class PayloadTooLarge extends Error {
  readonly statusCode = 413;
}

/**
 * Keeps the raw bytes of `POST /v1/hooks/meta` for its HMAC check, and hands Fastify's JSON parser an empty
 * object in their place: the signature is checked (MetaWebhookGuard) before anything parses what Meta sent,
 * and the controller parses it only after. A content-type parser is instance-wide in Fastify (Nest
 * registers every route on the root instance), so this is a `preParsing` hook that every other route passes
 * through untouched.
 *
 * @param fastify the application's Fastify instance, before Nest registers its routes
 */
export function registerMetaWebhookBody(fastify: FastifyInstance): void {
  fastify.addHook("preParsing", async (request, _reply, payload) => {
    if (request.method !== "POST" || request.routeOptions.url !== META_HOOK_ROUTE) return payload;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of payload) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      size += bytes.length;
      if (size > MAX_BYTES) throw new PayloadTooLarge();
      chunks.push(bytes);
    }
    const raw = Buffer.concat(chunks);
    rawBodies.set(request, raw);
    // Fastify compares the bytes it received with Content-Length: the placeholder reports the real count.
    const placeholder = Readable.from([Buffer.from("{}")]) as Readable & {
      receivedEncodedLength?: number;
    };
    placeholder.receivedEncodedLength = raw.length;
    return placeholder;
  });
}

/**
 * The bytes Meta sent, exactly as received; empty when the request had no body.
 *
 * @param request the webhook request
 * @returns the raw body
 */
export function metaRawBody(request: FastifyRequest): Buffer {
  return rawBodies.get(request) ?? Buffer.alloc(0);
}
