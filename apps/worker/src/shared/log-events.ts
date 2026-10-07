// Every message the worker logs (CLAUDE.md §8). Anything else is replaced by "log message withheld".
export const WORKER_LOG_EVENTS = [
  "worker started",
  "worker failed to start",
  "worker shutdown started",
  "worker shutdown completed",
  "worker shutdown timed out",
  "worker shutdown failed",
  "outbox event handled",
  "outbox event failed",
  "outbox poll failed",
  "nest",
  "nest error",
  "nest warning",
] as const;
