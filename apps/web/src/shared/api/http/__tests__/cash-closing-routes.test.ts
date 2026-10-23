import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { BRANCH, CLINIC, TS, USER, clientWith, code, me, type Call } from "./fetch-stub";

// Finance F2 card 2b over HTTP: method, path, header, body and schema of every closing call.
const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const CLOSING = "0190a000-0000-7000-8000-0000000000c1";
const totals = [{ method: "cash", inMinor: "500", outMinor: "0" }];
const preview = {
  branchId: BRANCH,
  businessDate: "2026-01-01",
  previousClosingId: null,
  fromCashSeq: "0",
  throughCashSeq: "1",
  cashInMinor: "500",
  cashOutMinor: "0",
  expectedMinor: "500",
  methodTotals: totals,
  movements: [],
  currency: "KWD",
  currencyExponent: 3,
};
const closing = {
  id: CLOSING,
  branchId: BRANCH,
  businessDate: "2026-01-01",
  previousClosingId: null,
  fromCashSeq: "0",
  toCashSeq: "1",
  expectedMinor: "500",
  countedMinor: "400",
  differenceMinor: "-100",
  methodTotals: totals,
  note: "عجز",
  currency: "KWD",
  currencyExponent: 3,
  closedBy: USER,
  closedAt: TS,
};

let broken = false;
function answer(call: Call) {
  const path = call.url.replace(/\?.*$/, "");
  if (path === "/api/v1/me") return { body: me };
  if (broken) return { body: { nope: true } };
  if (path === "/api/v1/cash-closings/preview") return { body: preview };
  if (path === "/api/v1/cash-closings" && call.method === "POST") {
    return { status: 201, body: { cashClosing: { ...closing, movements: [] } } };
  }
  if (path === "/api/v1/cash-closings") return { body: { items: [closing], nextCursor: null, total: 1 } };
  if (path === `/api/v1/cash-closings/${CLOSING}`) {
    return { body: { cashClosing: { ...closing, movements: [] } } };
  }
  return { status: 404, body: {} };
}

let h: ReturnType<typeof clientWith>;
beforeEach(() => {
  broken = false;
  h = clientWith(answer);
});
const last = () => h.calls.at(-1)!;

describe("cash closings over HTTP", () => {
  it("previews a branch drawer and closes it with the Idempotency-Key", async () => {
    expect(await h.api.cashClosings.preview(P, BRANCH)).toEqual(preview);
    expect(last().url).toBe(`/api/v1/cash-closings/preview?branchId=${BRANCH}`);
    const body = {
      branchId: BRANCH,
      previousClosingId: null,
      throughCashSeq: "1",
      countedMinor: "400",
      note: "عجز",
    };
    expect((await h.api.cashClosings.close(P, body, "key-c")).id).toBe(CLOSING);
    expect(last()).toMatchObject({ method: "POST", url: "/api/v1/cash-closings", body });
    expect(last().headers["Idempotency-Key"]).toBe("key-c");
  });

  it("lists closings with the query and reads one", async () => {
    await h.api.cashClosings.list(P, { limit: 20, branchId: BRANCH, from: "2026-01-01" });
    expect(last().url).toBe(`/api/v1/cash-closings?limit=20&branchId=${BRANCH}&from=2026-01-01`);
    expect((await h.api.cashClosings.get(P, CLOSING)).note).toBe("عجز");
    expect(last().url).toBe(`/api/v1/cash-closings/${CLOSING}`);
  });

  it("refuses closing answers outside their contract", async () => {
    broken = true;
    expect((await code(h.api.cashClosings.preview(P, BRANCH))).code).toBe("unknown");
    expect((await code(h.api.cashClosings.list(P, {}))).code).toBe("unknown");
    expect((await code(h.api.cashClosings.get(P, CLOSING))).code).toBe("unknown");
  });
});
