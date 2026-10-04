import type { LoggerService } from "@nestjs/common";
import type { Logger } from "@eyadex/observability";

// Nest's own messages go through the sanitising pino logger instead of Nest's console logger, which would
// print initialisation errors and their stacks raw. Framework info lines (route mapping, module init) keep
// their text; warnings and errors keep only their context — their text can be an exception message carrying
// something internal.
// Nest's error(message, stack) overload puts a stack where a context would be, and any string can look
// like a class name, so only Nest's own context labels are kept; anything else is discarded.
const NEST_CONTEXTS = new Set([
  "NestFactory",
  "NestApplication",
  "InstanceLoader",
  "RoutesResolver",
  "RouterExplorer",
  "ExceptionHandler",
  "ExceptionsHandler",
  "NestApplicationContext",
]);
const contextOf = (params: unknown[]): string | undefined => {
  const last = params.at(-1);
  return typeof last === "string" && NEST_CONTEXTS.has(last) ? last : undefined;
};

/**
 * A Nest `LoggerService` over the shared pino logger.
 */
export class PinoNestLogger implements LoggerService {
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  log(message: unknown, ...params: unknown[]): void {
    // Framework text is not a catalogued event, so the logger withholds it; only the context survives.
    void message;
    this.#logger.debug({ nest: contextOf(params) }, "nest");
  }

  warn(_message: unknown, ...params: unknown[]): void {
    this.#logger.warn({ nest: contextOf(params) }, "nest warning");
  }

  error(message: unknown, ...params: unknown[]): void {
    const err = message instanceof Error ? message : undefined;
    this.#logger.error({ nest: contextOf(params), ...(err ? { err } : {}) }, "nest error");
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.log(message, ...params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.log(message, ...params);
  }
}
