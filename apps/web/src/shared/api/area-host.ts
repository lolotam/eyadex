/**
 * One build serves the marketing site, the clinic (`app.`) and the platform (`platform.`). The area
 * comes from the host name alone (ADR-0004: each area talks to the API on its own host). Local
 * development follows `.env.example`: `localhost` is the clinic, `platform.localhost` the platform.
 *
 * A deployment on other hosts (staging, ADR-0021) names both at build time with `VITE_APP_HOST` and
 * `VITE_PLATFORM_HOST`; then only those two hosts are areas, so a staging build never treats a
 * production host as its own. Unset, the production rules below apply unchanged.
 */
export type Area = "clinic" | "platform";

/** The two hosts a deployment serves its areas on, when they are configured at build time. */
export interface AreaHosts {
  readonly clinic: string;
  readonly platform: string;
}

const AREA_PREFIX = /^(app|platform|www)\./;
// A bare host name: lowercase labels joined by dots, no scheme, port, path or credentials.
const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

function isLocal(host: string): boolean {
  return host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

const setting = (raw: unknown): string | undefined =>
  typeof raw === "string" && raw.trim() !== "" ? raw.trim().toLowerCase() : undefined;

/**
 * Reads the build-time host pair. Both or neither; each a bare host name; never the same host.
 * A broken pair throws, so a misconfigured build fails on its first page instead of guessing.
 */
export function areaHostsFrom(appHost: unknown, platformHost: unknown): AreaHosts | null {
  const clinic = setting(appHost);
  const platform = setting(platformHost);
  if (clinic === undefined && platform === undefined) return null;
  if (
    clinic === undefined ||
    platform === undefined ||
    !HOST_NAME.test(clinic) ||
    !HOST_NAME.test(platform) ||
    clinic === platform
  ) {
    throw new Error("VITE_APP_HOST and VITE_PLATFORM_HOST must be two distinct bare host names");
  }
  return { clinic, platform };
}

/** This build's hosts: null in production and local development (the host-prefix rules apply). */
export const AREA_HOSTS: AreaHosts | null = areaHostsFrom(
  import.meta.env["VITE_APP_HOST"],
  import.meta.env["VITE_PLATFORM_HOST"],
);

/** null = the marketing host (or any other), where neither area runs. */
export function areaOfHost(hostname: string, hosts: AreaHosts | null = AREA_HOSTS): Area | null {
  const host = hostname.toLowerCase();
  if (hosts !== null) {
    if (host === hosts.clinic) return "clinic";
    return host === hosts.platform ? "platform" : null;
  }
  if (host.startsWith("platform.")) return "platform";
  if (host.startsWith("app.") || isLocal(host)) return "clinic";
  return null;
}

/** The origin an area lives on, derived from the current one (same scheme and port). */
export function areaOrigin(
  area: Area,
  location: Pick<Location, "protocol" | "hostname" | "port">,
  hosts: AreaHosts | null = AREA_HOSTS,
) {
  const port = location.port ? `:${location.port}` : "";
  if (hosts !== null) return `${location.protocol}//${hosts[area]}${port}`;
  const base = location.hostname.toLowerCase().replace(AREA_PREFIX, "");
  // A bare IP has no subdomains; local development serves the platform on `platform.localhost`.
  const platformBase = isLocal(base) ? "localhost" : base;
  const host =
    area === "platform" ? `platform.${platformBase}` : isLocal(base) ? base : `app.${base}`;
  return `${location.protocol}//${host}${port}`;
}
