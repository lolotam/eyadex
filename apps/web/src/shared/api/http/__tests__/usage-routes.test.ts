import { describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { CLINIC, USER, branchDetail, clientWith, me, page } from "./fetch-stub";

const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };

describe("usage counters", () => {
  it("read their own routes with a bodyless same-origin GET", async () => {
    const h = clientWith((call) => {
      const path = call.url.replace(/\?.*$/, "");
      if (path === "/api/v1/me") return { body: me };
      if (path === "/api/v1/branches/usage") return { body: { active: 2, limit: 3 } };
      if (path === "/api/v1/users/usage") return { body: { used: 4, limit: 10 } };
      return { body: page([branchDetail]) };
    });
    const branches = await h.api.branches.list(P, {
      cursor: null,
      limit: 10,
      search: "",
      status: null,
    });
    expect(branches.usage).toEqual({ active: 2, limit: 3 });
    expect(await h.api.users.usage(P)).toEqual({ used: 4, limit: 10 });
    const usage = h.calls.filter((c) => c.url.endsWith("/usage"));
    expect(usage.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/v1/branches/usage",
      "GET /api/v1/users/usage",
    ]);
    for (const c of usage) {
      expect(c.credentials).toBe("same-origin");
      expect(c.body).toBeUndefined();
    }
  });
});
