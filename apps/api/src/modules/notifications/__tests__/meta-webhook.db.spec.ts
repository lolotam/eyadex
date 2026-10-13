import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { addPatient } from "../../appointments/__tests__/appointment-fixtures.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { notificationsOf } from "../persistence/pg-patient-notifications.ts";

// Spec §7.2 over HTTP and real RLS: Meta's signed status webhook, routed by its number through 0059's
// SECURITY DEFINER lookup, then applied inside the clinic's own context. Shaped placeholders only.
const META = {
  META_APP_ID: "1234567890",
  META_APP_SECRET: randomBytes(16).toString("hex"),
  META_WHATSAPP_CONFIG_ID: "9876543210",
  META_WEBHOOK_VERIFY_TOKEN: randomBytes(32).toString("hex"),
};
const number = () => `2${BigInt(`0x${randomBytes(8).toString("hex")}`)}`.slice(0, 18);
let h: Harness;

beforeAll(async () => {
  h = await openHarness(META, true);
  // A first clinic warms the harness's Redis connection: the public limiter fails closed (503) until it is up.
  await clinicWithMembers(h);
});
afterAll(async () => {
  await closeHarness(h);
  for (const name of Object.keys(META)) delete process.env[name];
});

const sign = (raw: string, secret = META.META_APP_SECRET) =>
  `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
// The exact bytes are signed: the payload goes as a string, never re-serialised by inject.
const post = (body: unknown, signature?: string | null) => {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return h.app.inject({
    method: "POST",
    url: "/v1/hooks/meta",
    headers: {
      "content-type": "application/json",
      ...(signature === null ? {} : { "x-hub-signature-256": signature ?? sign(raw) }),
    },
    payload: raw,
  });
};
const statuses = (phoneNumberId: string, items: unknown[]) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "0",
      changes: [
        {
          field: "messages",
          value: { metadata: { phone_number_id: phoneNumberId }, statuses: items },
        },
      ],
    },
  ],
});
const at = (iso: string) => String(Math.floor(new Date(iso).getTime() / 1000));

/** A clinic with a coexistence channel on its own number. */
const linkedClinic = async (transport: "coexistence" | "evolution" = "coexistence") => {
  const A = await clinicWithMembers(h);
  const clinicId = A.admin.clinicId;
  const phoneNumberId = number();
  await h.owner`INSERT INTO clinic_whatsapp_channels (clinic_id, id, transport, status, phone_number_id,
      instance_name, connected_at, created_at, updated_at)
    VALUES (${clinicId}, ${randomUUID()}, ${transport}, 'connected', ${phoneNumberId},
      ${transport === "evolution" ? `eyadex-${clinicId}` : null}, now(), now(), now())`;
  return { clinicId, branchId: A.doctor.branchId, phoneNumberId };
};
const sentRow = async (
  c: { clinicId: string; branchId: string },
  messageId: string,
  o: { route?: string; channel?: string } = {},
) => {
  const patientId = await addPatient(h, c.clinicId, c.branchId);
  const id = randomUUID();
  const subjectId = randomUUID();
  await h.owner`INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type,
      subject_id, subject_at, status, route, sent_at, provider_message_id, created_at, updated_at)
    VALUES (${c.clinicId}, ${id}, ${patientId}, 'booked', ${o.channel ?? "whatsapp"}, 'appointment',
      ${subjectId}, now(), 'sent', ${o.route ?? "coexistence"}, '2026-01-01T09:00:00Z', ${messageId},
      now(), now())`;
  return { id, subjectId };
};
const row = async (id: string) =>
  (
    await h.owner`SELECT status, route, sent_at, last_error, delivered_at, read_at, updated_at
                  FROM patient_notifications WHERE id = ${id}`
  )[0]!;
const history = async (clinicId: string, subjectId: string) => {
  const db = createDatabase({
    url: process.env["EYADEX_TEST_APP_URL"]!,
    role: "eyadex_app",
    ids: systemUuidV7(),
  });
  try {
    return await db.withTenant(clinicId, (tx) =>
      notificationsOf(tx, clinicId, "appointment", subjectId),
    );
  } finally {
    await db.close();
  }
};

describe("GET /v1/hooks/meta (subscription check)", () => {
  const check = (query: Record<string, string>) =>
    h.app.inject({ method: "GET", url: `/v1/hooks/meta?${new URLSearchParams(query).toString()}` });
  const good = {
    "hub.mode": "subscribe",
    "hub.verify_token": META.META_WEBHOOK_VERIFY_TOKEN,
    "hub.challenge": "1158201444",
  };

  it("answers the challenge as plain text with the token", async () => {
    const res = await check(good);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
    expect(res.body).toBe("1158201444");
  });

  it("answers 403 to a wrong token, mode or challenge", async () => {
    for (const override of [
      { "hub.verify_token": randomBytes(32).toString("hex") },
      { "hub.mode": "unsubscribe" },
      { "hub.challenge": "<b>" },
    ]) {
      const res = await check({ ...good, ...override });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("forbidden");
    }
  });
});

describe("POST /v1/hooks/meta (statuses)", () => {
  it("refuses a missing, wrong or stale signature with 401 before parsing the body", async () => {
    const body = statuses("12345", []);
    for (const signature of [null, sign(JSON.stringify(body), "other-secret"), sign("{}")]) {
      const res = await post(body, signature);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("unauthorized");
    }
    // Malformed JSON without a valid signature is still 401: nothing was parsed before the check.
    expect((await post("{not json", sign("{}"))).statusCode).toBe(401);
    // Signed but not JSON carries no status: ignored with 200.
    expect((await post("{not json")).statusCode).toBe(200);
  });

  it("moves sent → delivered → read with Meta's times, and the history shows them", async () => {
    const c = await linkedClinic();
    const messageId = `wamid.${randomUUID()}`;
    const { id, subjectId } = await sentRow(c, messageId);
    const delivered = statuses(c.phoneNumberId, [
      { id: messageId, status: "delivered", timestamp: at("2026-01-01T09:01:00Z") },
    ]);
    expect((await post(delivered)).statusCode).toBe(200);
    expect(await row(id)).toMatchObject({ status: "sent", read_at: null });
    expect((await row(id))["delivered_at"]).toEqual(new Date("2026-01-01T09:01:00Z"));
    const read = statuses(c.phoneNumberId, [
      { id: messageId, status: "read", timestamp: at("2026-01-01T09:05:00Z") },
    ]);
    expect((await post(read)).statusCode).toBe(200);
    const [item] = await history(c.clinicId, subjectId);
    expect(item).toMatchObject({
      status: "sent",
      route: "coexistence",
      deliveredAt: "2026-01-01T09:01:00.000Z",
      readAt: "2026-01-01T09:05:00.000Z",
      failureReason: null,
    });
    // Replays change nothing, not even updated_at.
    const before = await row(id);
    for (const body of [delivered, read]) expect((await post(body)).statusCode).toBe(200);
    expect(await row(id)).toEqual(before);
  });

  it("a read before its delivered sets both; the late delivered changes nothing", async () => {
    const c = await linkedClinic();
    const messageId = `wamid.${randomUUID()}`;
    const { id } = await sentRow(c, messageId);
    await post(
      statuses(c.phoneNumberId, [
        { id: messageId, status: "read", timestamp: at("2026-01-01T09:07:00Z") },
      ]),
    );
    const afterRead = await row(id);
    expect(afterRead["delivered_at"]).toEqual(new Date("2026-01-01T09:07:00Z"));
    expect(afterRead["read_at"]).toEqual(new Date("2026-01-01T09:07:00Z"));
    await post(
      statuses(c.phoneNumberId, [
        { id: messageId, status: "delivered", timestamp: at("2026-01-01T09:02:00Z") },
      ]),
    );
    expect(await row(id)).toEqual(afterRead);
  });

  it("failed keeps the route and acceptance time with a coarse reason, and replays are no-ops", async () => {
    const c = await linkedClinic();
    const messageId = `wamid.${randomUUID()}`;
    const { id, subjectId } = await sentRow(c, messageId);
    const failed = statuses(c.phoneNumberId, [
      { id: messageId, status: "failed", errors: [{ code: 131026, title: "fixture" }] },
    ]);
    expect((await post(failed)).statusCode).toBe(200);
    expect(await row(id)).toMatchObject({
      status: "failed",
      route: "coexistence",
      last_error: "coexistence:meta_not_on_whatsapp",
    });
    expect((await row(id))["sent_at"]).toEqual(new Date("2026-01-01T09:00:00Z"));
    const before = await row(id);
    await post(failed);
    await post(statuses(c.phoneNumberId, [{ id: messageId, status: "read" }]));
    expect(await row(id)).toEqual(before);
    expect((await history(c.clinicId, subjectId))[0]).toMatchObject({
      status: "failed",
      failureReason: "not_on_whatsapp",
      deliveredAt: null,
      readAt: null,
    });
  });

  it("touches only the routed clinic's WhatsApp coexistence rows", async () => {
    const c = await linkedClinic();
    const other = await linkedClinic();
    const evolutionClinic = await linkedClinic("evolution");
    const messageId = `wamid.${randomUUID()}`;
    const untouched = await Promise.all([
      sentRow(other, messageId),
      sentRow(c, messageId, { route: "evolution" }),
      sentRow(c, messageId, { channel: "email", route: "primary" }),
      sentRow(evolutionClinic, messageId, { route: "evolution" }),
    ]);
    const before = await Promise.all(untouched.map(({ id }) => row(id)));
    const body = (phoneNumberId: string) =>
      statuses(phoneNumberId, [{ id: messageId, status: "failed", errors: [{ code: 131047 }] }]);
    for (const phoneNumberId of [c.phoneNumberId, evolutionClinic.phoneNumberId, number()])
      expect((await post(body(phoneNumberId))).statusCode).toBe(200);
    expect(await Promise.all(untouched.map(({ id }) => row(id)))).toEqual(before);
  });

  it("ignores messages and unknown fields with 200, and never logs the body", async () => {
    const marker = randomBytes(24).toString("hex");
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: number() },
                messages: [{ text: { body: marker } }],
              },
            },
          ],
        },
      ],
    };
    expect((await post(body)).statusCode).toBe(200);
    expect(h.logs.join("\n")).not.toContain(marker);
  });

  it("refuses a body over the limit without a 2xx", async () => {
    const raw = JSON.stringify({ pad: "x".repeat(1024 * 1024) });
    const res = await post(raw);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});
