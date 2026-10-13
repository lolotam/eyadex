import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WHATSAPP_RISK_VERSION } from "@eyadex/contracts/whatsapp";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import {
  APP,
  call,
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { FakeEvolution } from "./whatsapp-fake-evolution.ts";

let h: Harness;
const evolution = new FakeEvolution();
beforeAll(async () => {
  h = await openHarness({}, true, { evolutionApi: evolution });
});
afterAll(async () => {
  await closeHarness(h);
});
const send = (cookie: string, method: "GET" | "POST", suffix: string, body?: unknown) =>
  call(h, {
    host: APP,
    cookie,
    method,
    url: `/v1/clinic/whatsapp${suffix}`,
    ...(body === undefined ? {} : { body }),
  });
const accept = { acceptRisk: true, riskVersion: WHATSAPP_RISK_VERSION };

describe("WhatsApp operations across the network gap", () => {
  it("refuses overlapping connects before they touch the shared instance and releases on failure", async () => {
    const A = await clinicWithMembers(h);
    const name = `eyadex-${A.admin.clinicId}`;
    const original = evolution.connect.bind(evolution);
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    evolution.connect = async (instance) => {
      if (instance === name) {
        entered();
        await barrier;
        throw new Error("fixture failure");
      }
      return original(instance);
    };
    const first = send(A.admin.cookie, "POST", "/connect", accept);
    try {
      await waiting;
      expect((await send(A.admin.cookie, "POST", "/connect", accept)).statusCode).toBe(503);
      expect(evolution.createdCount(name)).toBe(1);
    } finally {
      release();
      await first;
      evolution.connect = original;
    }
    expect((await send(A.admin.cookie, "POST", "/connect", accept)).statusCode).toBe(200);
  });

  it("a QR refresh in flight cannot restore a link after a concurrent disconnect", async () => {
    const A = await clinicWithMembers(h);
    const name = `eyadex-${A.admin.clinicId}`;
    await send(A.admin.cookie, "POST", "/connect", accept);
    evolution.scan(name);
    const original = evolution.ownerLast4.bind(evolution);
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    evolution.ownerLast4 = async (instance) => {
      if (instance === name) {
        entered();
        await barrier;
      }
      return original(instance);
    };
    const refresh = send(A.admin.cookie, "GET", "/qr");
    try {
      await waiting;
      expect((await send(A.admin.cookie, "POST", "/disconnect", {})).statusCode).toBe(503);
    } finally {
      release();
      await refresh;
      evolution.ownerLast4 = original;
    }
    expect((await send(A.admin.cookie, "POST", "/disconnect", {})).statusCode).toBe(200);
    expect((await send(A.admin.cookie, "GET", "")).json()).toMatchObject({
      status: "disconnected",
    });
  });
});
