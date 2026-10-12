// A variable name as the API and the worker spell them: upper case, digits, at least one underscore.
// Nothing else in a configuration message can reach the log, so a value pasted by mistake never does.
const VARIABLE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/**
 * A startup configuration problem. Its message is written by our own code and names variables only;
 * the log still prints just the variable names found in it (`errorDiagnostic`), so the operator sees
 * which setting to fix without the logger ever trusting a message.
 */
export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
  /** The variable names the message mentions, in order, without repeats. */
  readonly variables: readonly string[];

  /**
   * @param service whose configuration it is ("API" or "worker")
   * @param detail what is wrong, naming the variables and never a value
   */
  constructor(service: "API" | "worker", detail: string) {
    super(`Invalid ${service} configuration: ${detail} — see .env.example`);
    this.variables = [...new Set(detail.match(VARIABLE) ?? [])];
  }
}

/**
 * The variable names of a configuration error that are safe to log, each one re-checked.
 *
 * @param error a `ConfigurationError`
 * @returns the names that match the variable shape exactly
 */
export function configurationVariables(error: ConfigurationError): string[] {
  const exact = new RegExp(`^${VARIABLE.source}$`);
  return error.variables.filter((name) => typeof name === "string" && exact.test(name));
}
