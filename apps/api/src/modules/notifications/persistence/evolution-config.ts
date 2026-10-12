import { ConfigurationError } from "@eyadex/observability";

import type { EvolutionApi } from "../ports/evolution-api.ts";
import { HttpEvolutionApi, UnconfiguredEvolutionApi } from "./http-evolution-api.ts";

const URL_VAR = "EVOLUTION_API_URL";
const KEY_VAR = "EVOLUTION_API_KEY";

// Same wording as every other startup configuration error of the API: the variable, never its value.
const invalid = (variables: readonly string[], reason: string): Error =>
  new ConfigurationError("API", variables, reason);

// http is allowed because Evolution is reached on the internal Docker network only (N-7); a path, a
// query, a fragment or credentials in the URL would change where requests go or leak into logs.
const baseUrlFrom = (raw: string): URL => {
  const invalidUrl = () => invalid([URL_VAR], "must be an http or https origin");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalidUrl();
  }
  const web = url.protocol === "http:" || url.protocol === "https:";
  const plain = url.username === "" && url.password === "";
  if (!web || !plain || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw invalidUrl();
  }
  return url;
};

/**
 * Evolution API from `EVOLUTION_API_URL` and `EVOLUTION_API_KEY` (spec §7.1). Both unset = WhatsApp
 * unavailable (the API still starts); one without the other, or a malformed URL, stops the start and
 * names the variable.
 *
 * @param env the process environment
 * @returns the HTTP adapter, or the unconfigured one
 */
export function evolutionApiFromEnv(env: NodeJS.ProcessEnv): EvolutionApi {
  const url = env[URL_VAR] ?? "";
  const key = env[KEY_VAR] ?? "";
  if (url === "" && key === "") return new UnconfiguredEvolutionApi();
  if (url === "") throw invalid([URL_VAR], `must be set with ${KEY_VAR}`);
  if (key === "") throw invalid([KEY_VAR], `must be set with ${URL_VAR}`);
  return new HttpEvolutionApi({ baseUrl: baseUrlFrom(url), apiKey: key });
}
