import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who and what one request is about, for its log lines (CLAUDE.md §8). The request id is known when the request
 * arrives; the clinic and user only after the guards verified them, so they are filled in later.
 */
export interface RequestContext {
  readonly requestId: string;
  clinicId?: string;
  branchId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Starts the context for the rest of the current async execution — called once per request, first thing. The
 * returned object is the request's own context: keep it on the request, because a callback that runs for this
 * request later (a response flushed by another request on the same connection) may run in someone else's context.
 *
 * @param requestId the request's id
 * @returns the context object the guards will fill in
 */
export function enterRequestContext(requestId: string): RequestContext {
  const context: RequestContext = { requestId };
  storage.enterWith(context);
  return context;
}

/**
 * Runs fn in exactly this request's context, whatever context the caller happens to be in.
 *
 * @param context the request's own context, from enterRequestContext
 * @param fn      the work to run — typically one log line
 * @returns what fn returns
 */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Adds what the guards verified to the current request's context. Outside a request it does nothing.
 *
 * @param fields the verified clinic, branch or user
 */
export function updateRequestContext(fields: Partial<Omit<RequestContext, "requestId">>): void {
  const current = storage.getStore();
  if (current === undefined) return;
  for (const [key, value] of Object.entries(fields) as [
    keyof typeof fields,
    string | undefined,
  ][]) {
    if (value !== undefined) current[key] = value;
  }
}

/**
 * The context as log fields — snake_case, present only when known. pino adds these to every line.
 *
 * @returns request_id, and clinic_id / branch_id / user_id when verified
 */
export function requestContextFields(): Record<string, string> {
  const current = storage.getStore();
  if (current === undefined) return {};
  return {
    request_id: current.requestId,
    ...(current.clinicId === undefined ? {} : { clinic_id: current.clinicId }),
    ...(current.branchId === undefined ? {} : { branch_id: current.branchId }),
    ...(current.userId === undefined ? {} : { user_id: current.userId }),
  };
}
