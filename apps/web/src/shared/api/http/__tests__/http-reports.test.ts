import { describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { CLINIC, USER, clientWith } from "./fetch-stub";

const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };

describe("the reports over HTTP", () => {
  it("calls GET /v1/finance-reports/<id> with the query and parses the answer", async () => {
    const urls: string[] = [];
    const h = clientWith((call) => {
      urls.push(call.url);
      return {
        body: {
          rows: [],
          totals: { inMinor: "0", outMinor: "0", netMinor: "0" },
          currency: "KWD",
          currencyExponent: 3,
        },
      };
    });
    const answer = await h.api.reports.dailyTakings(P, {
      from: "2026-10-01",
      to: "2026-10-24",
      groupBy: "month",
    });
    expect(answer.currency).toBe("KWD");
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]!, "http://x");
    expect(url.pathname).toBe("/api/v1/finance-reports/daily-takings");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-10-01",
      to: "2026-10-24",
      groupBy: "month",
    });
  });

  it("refuses an answer that is not the contract's", async () => {
    const h = clientWith(() => ({ body: { rows: "nope" } }));
    await expect(
      h.api.reports.ownSummary(P, { from: "2026-10-01", to: "2026-10-24" }),
    ).rejects.toBeDefined();
  });
});
