/**
 * One build serves the marketing site, the clinic (`app.`) and the platform (`platform.`). The area
 * comes from the host name alone (ADR-0004: each area talks to the API on its own host). Local
 * development follows `.env.example`: `localhost` is the clinic, `platform.localhost` the platform.
 */
export type Area = "clinic" | "platform";

const AREA_PREFIX = /^(app|platform|www)\./;

function isLocal(host: string): boolean {
  return host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** null = the marketing host (or any other), where neither area runs. */
export function areaOfHost(hostname: string): Area | null {
  const host = hostname.toLowerCase();
  if (host.startsWith("platform.")) return "platform";
  if (host.startsWith("app.") || isLocal(host)) return "clinic";
  return null;
}

/** The origin an area lives on, derived from the current one (same scheme and port). */
export function areaOrigin(area: Area, location: Pick<Location, "protocol" | "hostname" | "port">) {
  const base = location.hostname.toLowerCase().replace(AREA_PREFIX, "");
  const host = area === "platform" ? `platform.${base}` : isLocal(base) ? base : `app.${base}`;
  return `${location.protocol}//${host}${location.port ? `:${location.port}` : ""}`;
}
