import { afterEach, describe, expect, it, vi } from "vitest";
import { branchDetailSchema } from "@eyadex/contracts/branches";
import { ApiError } from "../../api-error";
import { flattenDetails, errorFromResponse } from "../http-errors";
import { createTransport, onUnauthorized } from "../http-transport";
import { branchDetail, stubFetch } from "./fetch-stub";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ApiError ? { code: e.code, details: e.details } : { code: "not-api" };
  }
  return { code: "resolved" };
};

afterEach(() => vi.restoreAllMocks());

describe("error envelope", () => {
  it("keeps a known code and flattens the validation list", () => {
    const error = errorFromResponse(400, {
      code: "validation",
      message_ar: "x",
      message_en: "x",
      details: [{ path: ["admin", "email"], code: "invalid_string" }],
    });
    expect(error.code).toBe("validation");
    expect(error.details).toEqual({ "admin.email": "invalid_string" });
  });
  it("carries numeric details such as count, never nested lists", () => {
    expect(flattenDetails({ count: 2, members: [{ id: "x", fullName: "y" }] })).toEqual({ count: 2 });
  });
  it("turns an unknown code into unknown", () => {
    expect(errorFromResponse(418, { code: "teapot", message_ar: "x", message_en: "x" }).code).toBe(
      "unknown",
    );
  });
});

describe("transport", () => {
  it("uses the relative /api base with same-origin credentials", async () => {
    const { calls, fetchImpl } = stubFetch(() => ({ body: branchDetail }));
    await createTransport(fetchImpl).send("GET", "/v1/branches/x", { schema: branchDetailSchema });
    expect(calls[0]?.url).toBe("/api/v1/branches/x");
    expect(calls[0]?.credentials).toBe("same-origin");
  });
  it("turns a response that drifted from the API schema into unknown and logs no values", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fetchImpl } = stubFetch(() => ({ body: { ...branchDetail, isActive: "secret-value" } }));
    const t = createTransport(fetchImpl);
    expect((await code(t.send("GET", "/v1/drift", { schema: branchDetailSchema }))).code).toBe("unknown");
    await code(t.send("GET", "/v1/drift", { schema: branchDetailSchema }));
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-value");
  });
  it("a 401 on /v1 clears the session (notifies the guard)", async () => {
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    const { fetchImpl } = stubFetch(() => ({ status: 401, body: { code: "unauthorized", message_ar: "x", message_en: "x" } }));
    expect((await code(createTransport(fetchImpl).sendEmpty("GET", "/v1/me"))).code).toBe("unauthorized");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
  it("a 403 does not end the session", async () => {
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    const { fetchImpl } = stubFetch(() => ({ status: 403, body: { code: "forbidden", message_ar: "x", message_en: "x" } }));
    expect((await code(createTransport(fetchImpl).sendEmpty("GET", "/v1/me"))).code).toBe("forbidden");
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});

export { code };
