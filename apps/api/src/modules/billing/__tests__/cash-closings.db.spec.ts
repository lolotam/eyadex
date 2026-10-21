import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { CLOCK, type Clock } from "../../tenancy/index.ts";
import {
  auditSince,
  financeClinic,
  namedPatient,
  previewClosing,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";
import {
  closingOf,
  closingSteps,
  onDay as onClockDay,
  type Closing,
  type Preview,
} from "./money-fixtures.ts";

// Finance F2 slice 5 (FIN-15, F2-Q9, F2-Q10, F2-Q11, spec §4.4, §4.6, §4.8, §8d R3-3): the daily cash
// closing of a branch — the period since the last closing, cash in − cash out, the count and its note,
// once a day, a preview that went stale, two closings with no cash between them, the audit row and the
// reads. A branch closes once a clinic day, so each test runs on its own day of the injected clock.
let h: Harness;
let C: FinanceClinic;
let clock: Clock;
let steps: ReturnType<typeof closingSteps>;

const PATIENT_NAME = "مراجع الصندوق";
const onDay = <T>(days: number, step: () => Promise<T>) => onClockDay(clock, days, step);
const preview = (branchId?: string) => steps.preview(branchId);
const closeWith = (...args: Parameters<ReturnType<typeof closingSteps>["closeWith"]>) =>
  steps.closeWith(...args);
const paid = (...args: Parameters<ReturnType<typeof closingSteps>["paid"]>) => steps.paid(...args);
const cashRefund = (...args: Parameters<ReturnType<typeof closingSteps>["cashRefund"]>) =>
  steps.cashRefund(...args);

let patient = "";

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  clock = h.app.get<Clock>(CLOCK);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
  steps = closingSteps(h, C);
  patient = await namedPatient(h, C, C.branchR, PATIENT_NAME);
});

afterAll(() => closeHarness(h));

let first: Closing;

describe("the first closing of a branch (spec §4.4, F2-Q10)", () => {
  it("previews nothing on a new drawer, then closes cash in − cash out of the period", async () => {
    const empty = await preview();
    expect(empty).toMatchObject({
      previousClosingId: null,
      fromCashSeq: "0",
      throughCashSeq: "0",
      cashInMinor: "0",
      cashOutMinor: "0",
      expectedMinor: "0",
      movements: [],
    });
    const cash = await paid(patient, "3000", "cash");
    await cashRefund(cash.invoice.id, cash.paymentId, "500");
    await paid(patient, "1000", "knet");
    const res = await previewClosing(h, C.admin.cookie, C.branchR);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain(PATIENT_NAME);
    const shown = res.json() as Preview;
    expect(shown).toMatchObject({
      fromCashSeq: "0",
      throughCashSeq: "2",
      cashInMinor: "3000",
      cashOutMinor: "500",
      expectedMinor: "2500",
    });
    expect(shown.movements.map((m) => [m.kind, m.cashSeq, m.amountMinor])).toEqual([
      ["payment", "1", "3000"],
      ["refund", "2", "500"],
    ]);
    expect(shown.methodTotals).toEqual([
      { method: "cash", inMinor: "3000", outMinor: "500" },
      { method: "knet", inMinor: "1000", outMinor: "0" },
      { method: "bank_transfer", inMinor: "0", outMinor: "0" },
      { method: "other", inMinor: "0", outMinor: "0" },
    ]);
    const since = new Date();
    const closed = await closeWith(shown, "2500");
    expect(closed.statusCode, closed.body).toBe(201);
    first = closingOf(closed);
    expect(first).toMatchObject({
      previousClosingId: null,
      fromCashSeq: "0",
      toCashSeq: "2",
      expectedMinor: "2500",
      countedMinor: "2500",
      differenceMinor: "0",
      note: null,
      businessDate: shown.businessDate,
    });
    expect(first.movements).toHaveLength(2);
    const [drawer] = await h.owner`SELECT last_closed_seq::text AS closed, last_closing_id
                                   FROM branch_cash_drawers
                                   WHERE clinic_id = ${C.clinicId} AND branch_id = ${C.branchR}`;
    expect(drawer).toEqual({ closed: "2", last_closing_id: first.id });
    // F2-Q19: an administrative row of the clinic log that the platform's view never shows.
    const rows = (await auditSince(h, C.clinicId, since)).filter(
      (row) => row["action"] === "cash_closing.closed",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: "administrative", entity_type: "cash_closing" });
    expect((rows[0]!["details"] as { after: unknown }).after).toEqual({
      businessDate: shown.businessDate,
      fromCashSeq: "0",
      toCashSeq: "2",
      expectedMinor: "2500",
      countedMinor: "2500",
      differenceMinor: "0",
      currency: "KWD",
      previousClosingId: null,
    });
    const platform = await h.owner`SELECT id FROM platform_clinic_admin_audit
                                   WHERE clinic_id = ${C.clinicId} AND entity_type = 'cash_closing'`;
    expect(platform).toHaveLength(0);
  });

  it("refuses a second closing of the same day (F2-Q9)", async () => {
    const again = await preview();
    expect(again).toMatchObject({
      previousClosingId: first.id,
      fromCashSeq: "2",
      throughCashSeq: "2",
    });
    const res = await closeWith(again, "0");
    expect([res.statusCode, code(res)]).toEqual([409, "cash_closing_exists"]);
  });
});

describe("two closings in a row with no cash between them (R3-3)", () => {
  it("closes an empty period on each of two days, chained one after the other", async () => {
    const second = await onDay(1, async () => {
      const shown = await preview();
      expect(shown).toMatchObject({ fromCashSeq: "2", throughCashSeq: "2", expectedMinor: "0" });
      const res = await closeWith(shown, "0");
      expect(res.statusCode, res.body).toBe(201);
      return closingOf(res);
    });
    expect(second).toMatchObject({ previousClosingId: first.id, fromCashSeq: "2", toCashSeq: "2" });
    const third = await onDay(2, async () => {
      const res = await closeWith(await preview(), "0");
      expect(res.statusCode, res.body).toBe(201);
      return closingOf(res);
    });
    expect(third).toMatchObject({ previousClosingId: second.id, fromCashSeq: "2", toCashSeq: "2" });
  });
});

describe("a count that differs from the expected amount (F2-Q11, R3-5)", () => {
  it("requires a note for a shortage and keeps the signed difference", async () => {
    await onDay(3, async () => {
      await paid(patient, "1000", "cash");
      const shown = await preview();
      expect(shown.expectedMinor).toBe("1000");
      const bare = await closeWith(shown, "900");
      expect([bare.statusCode, code(bare)]).toEqual([400, "closing_note_required"]);
      const blank = await closeWith(shown, "900", "   ");
      expect([blank.statusCode, code(blank)]).toEqual([400, "closing_note_required"]);
      const since = new Date();
      const noted = await closeWith(shown, "900", "short by one coin");
      expect(noted.statusCode, noted.body).toBe(201);
      const closing = closingOf(noted);
      expect(closing).toMatchObject({
        expectedMinor: "1000",
        countedMinor: "900",
        differenceMinor: "-100",
        note: "short by one coin",
      });
      const [row] = (await auditSince(h, C.clinicId, since)).filter(
        (entry) => entry["entity_id"] === closing.id,
      );
      const details = row!["details"] as { noteLength: number };
      expect(details.noteLength).toBe("short by one coin".length);
      expect(JSON.stringify(details)).not.toContain("short by one coin");
    });
  });

  it("closes a negative expected amount when more cash went out than came in", async () => {
    const earlier = await onDay(4, () => paid(patient, "2000", "knet"));
    await onDay(5, async () => {
      await cashRefund(earlier.invoice.id, earlier.paymentId, "700");
      const shown = await preview();
      expect(shown).toMatchObject({ cashInMinor: "0", cashOutMinor: "700", expectedMinor: "-700" });
      const res = await closeWith(shown, "0", "the refund came from the safe");
      expect(res.statusCode, res.body).toBe(201);
      expect(closingOf(res)).toMatchObject({ expectedMinor: "-700", differenceMinor: "700" });
    });
  });
});

describe("a preview that went stale (spec §4.4, R3-3)", () => {
  it("answers cash_drawer_changed when cash moved since, and closes the new preview", async () => {
    await onDay(6, async () => {
      const shown = await preview();
      await paid(patient, "400", "cash");
      const stale = await closeWith(shown, shown.expectedMinor);
      expect([stale.statusCode, code(stale)]).toEqual([409, "cash_drawer_changed"]);
      const fresh = await preview();
      expect(BigInt(fresh.throughCashSeq)).toBe(BigInt(shown.throughCashSeq) + 1n);
      const res = await closeWith(fresh, fresh.expectedMinor);
      expect(res.statusCode, res.body).toBe(201);
    });
  });

  it("answers cash_drawer_changed when another closing committed since", async () => {
    const shown = await onDay(7, () => preview(C.branchD));
    const firstOfD = await onDay(7, () => closeWith(shown, "0", undefined, C.branchD));
    expect(firstOfD.statusCode, firstOfD.body).toBe(201);
    const stale = await onDay(8, () => closeWith(shown, "0", undefined, C.branchD));
    expect([stale.statusCode, code(stale)]).toEqual([409, "cash_drawer_changed"]);
  });
});

describe("the idempotency of a closing (spec §4.4)", () => {
  it("replays the same key and body, and refuses the same key with another body", async () => {
    await onDay(9, async () => {
      const shown = await preview();
      const key = randomUUID();
      const closed = await closeWith(shown, shown.expectedMinor, undefined, C.branchR, key);
      expect(closed.statusCode, closed.body).toBe(201);
      const replay = await closeWith(shown, shown.expectedMinor, undefined, C.branchR, key);
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.json()).toEqual(closed.json());
      const conflict = await closeWith(shown, "1", "other", C.branchR, key);
      expect([conflict.statusCode, code(conflict)]).toEqual([409, "idempotency_conflict"]);
    });
  });
});

describe("reading the closings (spec §4.6)", () => {
  it("lists a branch's closings newest first and shows one with its movements, no names", async () => {
    const list = await send(h, C.admin.cookie, "GET", `/v1/cash-closings?branchId=${C.branchR}`);
    expect(list.statusCode, list.body).toBe(200);
    const page = list.json() as { items: Closing[]; total: number };
    expect(page.total).toBe(page.items.length);
    expect(page.items.length).toBeGreaterThanOrEqual(6);
    expect(page.items.at(-1)!.id).toBe(first.id);
    expect(page.items.every((item) => !("movements" in item))).toBe(true);
    const day = await send(
      h,
      C.admin.cookie,
      "GET",
      `/v1/cash-closings?branchId=${C.branchR}&from=${first.businessDate}&to=${first.businessDate}`,
    );
    expect((day.json() as { items: Closing[] }).items.map((item) => item.id)).toEqual([first.id]);
    const shown = await send(h, C.admin.cookie, "GET", `/v1/cash-closings/${first.id}`);
    expect(shown.statusCode, shown.body).toBe(200);
    expect(shown.body).not.toContain(PATIENT_NAME);
    expect(closingOf(shown).movements.map((m) => m.cashSeq)).toEqual(["1", "2"]);
    const unknown = await send(h, C.admin.cookie, "GET", `/v1/cash-closings/${randomUUID()}`);
    expect([unknown.statusCode, code(unknown)]).toEqual([404, "not_found"]);
  });
});
