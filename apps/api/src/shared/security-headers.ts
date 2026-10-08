import type { FastifyReply } from "fastify";

/**
 * Headers on every API answer (ADR-0021). The API serves JSON only, behind the same origin as the web
 * app (ADR-0004), so nothing it returns may be framed, sniffed into another type, cached by a shared
 * cache or leak its URL through a Referer. HSTS is left to the TLS terminator (Cloudflare).
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cache-control": "no-store",
};

/**
 * Puts the security headers on a reply before anything is written; a handler may still replace one.
 *
 * @param reply the Fastify reply
 */
export function applySecurityHeaders(reply: FastifyReply): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) void reply.header(name, value);
}
