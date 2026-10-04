import pino, { type Bindings, type DestinationStream, type Logger, type LoggerOptions } from "pino";

import { REDACTED, sanitize } from "./redaction.ts";
import { requestContextFields } from "./request-context.ts";
import { errorDiagnostic, requestDiagnostic, responseDiagnostic } from "./serializers.ts";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// A message is an event NAME from a finite catalogue — these base events plus the ones each process
// registers. Any other message, however harmless it looks, is replaced: a message is free text, and no
// pattern can tell "a clinic PIN" or an error's message from a real event name. Dynamic data goes in
// fields, where the sanitiser can see it. The lint rule in @eyadex/config/eslint also rejects built-up
// messages.
export const BASE_LOG_EVENTS = ["error", "log", "request completed", "unhandled error"] as const;
export const WITHHELD_MESSAGE = "log message withheld";

// Fastify logs its own lines with req/res/err. They are reduced to safe diagnostics BEFORE the
// sanitiser walks anything: a Fastify request is large and keeps routeOptions on its prototype.
// Everything here runs BEFORE the sanitiser's fail-closed walk, so every step is guarded: a throwing getter
// (top-level or nested inside req/res), or a Proxy whose ownKeys trap throws, must not turn a log call into
// an exception. A step that throws yields REDACTED.
const guarded = <T>(read: () => T): T | typeof REDACTED => {
  try {
    return read();
  } catch {
    return REDACTED;
  }
};

function guardedCopy(object: object): Record<string, unknown> {
  const keys = guarded(() => Object.keys(object));
  if (keys === REDACTED) return { fields: REDACTED };
  const copy: Record<string, unknown> = {};
  for (const key of keys) copy[key] = guarded(() => (object as Record<string, unknown>)[key]);
  return copy;
}

function reduce(object: object): object {
  const reduced = guardedCopy(object);
  const { req, res } = reduced;
  if (req !== undefined) reduced["req"] = guarded(() => requestDiagnostic(req as object));
  if (res !== undefined) reduced["res"] = guarded(() => responseDiagnostic(res as object));
  if ("err" in reduced) {
    const err = reduced["err"];
    reduced["err"] = guarded(() => errorDiagnostic(err));
  }
  return reduced;
}

// pino writes these itself; a caller's value under the same key would be printed too (as a duplicate key).
const RESERVED_KEYS: ReadonlySet<string> = new Set(["msg", "level", "time", "pid", "hostname"]);

// The one preparation every object pino prints goes through — log objects AND bindings: reduce req/res/err,
// sanitise at any depth, drop pino's reserved keys.
function prepare(object: object): Record<string, unknown> {
  const prepared = asLogObject(sanitize(reduce(object)));
  return Object.fromEntries(Object.entries(prepared).filter(([key]) => !RESERVED_KEYS.has(key)));
}

// sanitize fails closed with a STRING; pino given a string as the log object prints it character by
// character ({"0":"[","1":"R",…}). Anything that is not a plain object becomes one inert field.
function asLogObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { fields: REDACTED };
}

function normalizer(events: ReadonlySet<string>): (args: unknown[]) => [object, string] {
  const message = (value: unknown, fallback: string): string =>
    typeof value !== "string" ? fallback : events.has(value) ? value : WITHHELD_MESSAGE;
  // One object and one message per call. An Error (or any thrown value under `err`) becomes its
  // diagnostic BEFORE pino sees it — pino would copy `err.message` into `msg`. Extra arguments are
  // dropped: pino would interpolate them into `msg` (`log.info('user %s', token)`).
  return (args) => {
    const [first, second] = args;
    if (first instanceof Error) return [{ err: errorDiagnostic(first) }, message(second, "error")];
    if (typeof first === "string") return [{}, message(first, "log")];
    const object = first !== null && typeof first === "object" ? prepare(first) : {};
    return [object, message(second, "log")];
  };
}

// A second, idempotent pass on the final object — belt and braces for anything that reached pino
// without going through the normaliser.
const formatLog = (object: Record<string, unknown>): Record<string, unknown> =>
  asLogObject(sanitize(object));

// Bindings are serialised by pino outside formatters.log, so they are sanitised here. The wrappers call
// pino's ORIGINAL prototype methods with the real receiver: a pino child is created with the parent as its
// prototype, so it inherits these unbound wrappers and each child keeps its own bindings — a wrapper bound
// to the root would make child.setBindings() change the root and leak context between requests.
function harden(root: Logger): Logger {
  const proto = Object.getPrototypeOf(root) as Logger;
  const originalChild = proto.child;
  const originalSetBindings = proto.setBindings;
  // Child OPTIONS are never forwarded: msgPrefix would be prepended after the message is checked, and
  // serializer or formatter overrides would bypass the sanitiser. Nothing here needs them.
  root.child = function child(this: Logger, bindings: Bindings) {
    return originalChild.call(this, prepare(bindings) as Bindings);
  } as Logger["child"];
  root.setBindings = function setBindings(this: Logger, bindings: Bindings) {
    originalSetBindings.call(this, prepare(bindings) as Bindings);
  };
  return root;
}

// The request id reaches a line from two sides: the request context (this mixin) and the binding Fastify
// puts on its per-request child logger (`requestIdLogLabel`, which the API sets to the same field name). A
// logger that already carries it keeps it — the mixin adds only what is missing — so request_id is printed
// exactly once per line, whichever logger wrote it.
const requestMixin = (_object: unknown, _level: number, logger: Logger): Record<string, string> => {
  const fields = requestContextFields();
  return logger.bindings()["request_id"] === undefined
    ? fields
    : Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "request_id"));
};

/**
 * The one pino configuration for api and worker. Every argument is reduced and sanitised before pino
 * reads it, every message must be a catalogued event, every line is sanitised again before it is
 * written. The level is validated by the caller's config — this never reads the environment.
 *
 * @param level  a validated log level
 * @param events the event names this process may log, added to BASE_LOG_EVENTS
 * @returns pino options
 */
export function loggerOptions(level: LogLevel, events: Iterable<string> = []): LoggerOptions {
  const normalizeArgs = normalizer(new Set<string>([...BASE_LOG_EVENTS, ...events]));
  return {
    level,
    base: null,
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: { log: formatLog },
    // request_id, clinic_id, branch_id, user_id on every line of a request (CLAUDE.md §8).
    mixin: requestMixin,
    hooks: {
      logMethod(args, method) {
        method.apply(this, normalizeArgs(args) as Parameters<typeof method>);
      },
    },
  };
}

/**
 * A pino logger built from `loggerOptions`, with sanitised bindings on it and on every child. Fastify
 * takes it as `loggerInstance`, so request logs and application logs share one configuration.
 *
 * @param level   a validated log level
 * @param options the event names this process logs, and (tests) where lines are written
 * @returns the logger
 */
export function createLogger(
  level: LogLevel,
  options: { events?: Iterable<string>; destination?: DestinationStream } = {},
): Logger {
  const settings = loggerOptions(level, options.events);
  return harden(
    options.destination === undefined ? pino(settings) : pino(settings, options.destination),
  );
}
