import { ConfigurationError } from "@eyadex/observability";

import type { EvolutionApi } from "../ports/evolution-api.ts";
import { HttpEvolutionApi, UnconfiguredEvolutionApi } from "./http-evolution-api.ts";

const URL_VAR = "EVOLUTION_API_URL";
const KEY_VAR = "EVOLUTION_API_KEY";
const WEBHOOK_URL_VAR = "EVOLUTION_WEBHOOK_URL";
const WEBHOOK_SECRET_VAR = "EVOLUTION_WEBHOOK_SECRET";

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
 * يهيئ Evolution والـ webhook معًا؛ غياب المجموعة يعطّل ربط QR فقط، وليس Meta.
 *
 * @param env بيئة العملية
 * @returns المنفذ المهيّأ أو المعطّل
 */
export function evolutionApiFromEnv(env: NodeJS.ProcessEnv): EvolutionApi {
  const url = env[URL_VAR] ?? "";
  const key = env[KEY_VAR] ?? "";
  if (url === "" && key === "") {
    for (const name of [WEBHOOK_URL_VAR, WEBHOOK_SECRET_VAR]) {
      if ((env[name] ?? "") !== "") throw invalid([name], "must be unset without Evolution");
    }
    return new UnconfiguredEvolutionApi();
  }
  if (url === "") throw invalid([URL_VAR], `must be set with ${KEY_VAR}`);
  if (key === "") throw invalid([KEY_VAR], `must be set with ${URL_VAR}`);
  const baseUrl = baseUrlFrom(url);
  const webhookUrl = env[WEBHOOK_URL_VAR] ?? "";
  const webhookSecret = env[WEBHOOK_SECRET_VAR] ?? "";
  if (webhookUrl === "") throw invalid([WEBHOOK_URL_VAR], "must be set with Evolution");
  if (webhookSecret.length < 32)
    throw invalid([WEBHOOK_SECRET_VAR], "must have at least 32 characters");
  let hook: URL;
  try {
    hook = new URL(webhookUrl);
  } catch {
    throw invalid([WEBHOOK_URL_VAR], "must be an http or https webhook URL");
  }
  if (
    !["http:", "https:"].includes(hook.protocol) ||
    hook.username !== "" ||
    hook.password !== "" ||
    hook.pathname !== "/v1/hooks/evolution" ||
    hook.search !== "" ||
    hook.hash !== ""
  )
    throw invalid([WEBHOOK_URL_VAR], "must be an http or https origin plus /v1/hooks/evolution");
  return new HttpEvolutionApi({ baseUrl, apiKey: key, webhookUrl, webhookSecret });
}
