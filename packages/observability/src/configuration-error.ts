// Only a complete variable name may reach the log; neither messages nor reasons are inspected.
// Unlike `$`, this end check cannot accept a trailing line break.
const VARIABLE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?![\s\S])/;

/**
 * Explicit variable names let the operator fix startup without trusting an error's message or reason.
 */
export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
  /** Explicit variable names, in order, without repeats. */
  readonly variables: readonly string[];

  /**
   * @param service whose configuration it is ("API" or "worker")
   * @param variables the settings to fix, never their values
   * @param reason optional explanation, excluded from diagnostics
   */
  constructor(service: "API" | "worker", variables: readonly string[], reason?: string) {
    const names = [...new Set(variables)];
    super(
      `Invalid ${service} configuration: ${names.join(", ")}${reason ? ` ${reason}` : ""} — see .env.example`,
    );
    this.variables = names;
  }
}

/**
 * The variable names of a configuration error that are safe to log, each one re-checked.
 *
 * @param error a `ConfigurationError`
 * @returns the names that match the variable shape exactly
 */
export function configurationVariables(error: ConfigurationError): string[] {
  return error.variables.filter((name) => typeof name === "string" && VARIABLE.test(name));
}
