import type { Area } from "@/shared/api/area-host";

/**
 * The sign-in card's text keys. The mock build is a demo with a persona picker, and says so; the real
 * (HTTP) build signs a person in with an account, so it must never call itself a demo or mention
 * personas. `area` is undefined while the host is still being read.
 */
export function signInCopy(http: { area: Area | null | undefined } | null | undefined) {
  if (!http) return { title: "app.name", body: "landing.body" } as const;
  return http.area === "platform"
    ? ({ title: "auth.platformTitle", body: "auth.platformBody" } as const)
    : ({ title: "auth.clinicTitle", body: "auth.clinicBody" } as const);
}
