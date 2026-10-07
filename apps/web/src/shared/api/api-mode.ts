/**
 * Which ApiClient the build uses, fixed at build time by VITE_API_MODE. Anything but "http" is the
 * in-memory mock, so the Lovable preview and every test keep the demo data.
 */
export type ApiMode = "mock" | "http";

export function apiModeOf(raw: unknown): ApiMode {
  return raw === "http" ? "http" : "mock";
}

export const API_MODE: ApiMode = apiModeOf(import.meta.env["VITE_API_MODE"]);
