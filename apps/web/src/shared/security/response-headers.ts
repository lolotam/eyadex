import { API_MODE, type ApiMode } from "@/shared/api/api-mode";
import { AREA_HOSTS, areaOfHost, type AreaHosts } from "@/shared/api/area-host";

/**
 * Headers the web server adds to every page it renders (ADR-0021).
 *
 * - Always: no MIME sniffing, and no full URL in the Referer sent to another origin.
 * - HTTP mode only: no framing. That is where real session cookies exist (clickjacking needs them),
 *   while the mock build is what the Lovable editor shows inside its own frame.
 * - Area hosts only: kept out of search engines. The marketing host stays indexable; `app.`,
 *   `platform.` and every staging host serve only signed-in screens (or a copy of the marketing page).
 *
 * Scripts are not restricted here: SSR hydration runs inline scripts, and a script policy needs nonces
 * the framework does not provide yet.
 */
export function securityHeadersFor(
  hostname: string,
  mode: ApiMode = API_MODE,
  hosts: AreaHosts | null = AREA_HOSTS,
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  if (mode === "http") {
    headers["x-frame-options"] = "DENY";
    headers["content-security-policy"] =
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";
  }
  if (areaOfHost(hostname, hosts) !== null) headers["x-robots-tag"] = "noindex, nofollow";
  return headers;
}

/**
 * A copy of the response with the security headers set. The copy is needed: a redirect's headers are
 * immutable, and the body stream is handed over, not read.
 */
export function withSecurityHeaders(
  request: Request,
  response: Response,
  mode: ApiMode = API_MODE,
  hosts: AreaHosts | null = AREA_HOSTS,
): Response {
  const out = new Response(response.body, response);
  const hostname = new URL(request.url).hostname;
  for (const [name, value] of Object.entries(securityHeadersFor(hostname, mode, hosts))) {
    out.headers.set(name, value);
  }
  return out;
}
