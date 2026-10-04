// Every message the API logs (CLAUDE.md §8). A message not in this list — or in BASE_LOG_EVENTS — is
// replaced by "log message withheld"; dynamic values belong in the log object's fields.
export const API_LOG_EVENTS = [
  "api started",
  "api failed to start",
  "api shutdown started",
  "api shutdown completed",
  "api shutdown timed out",
  "api shutdown failed",
  "nest",
  "nest error",
  "nest warning",
] as const;
